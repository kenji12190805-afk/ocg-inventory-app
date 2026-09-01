// Fallback for cards BabelCDB doesn't have yet: for every Yugipedia print row whose English
// name doesn't match a BabelCDB card, fetch that card's own Yugipedia page (its
// `{{CardTable2}}` infobox has everything BabelCDB would: Japanese name/text, attribute,
// race, level/rank, ATK/DEF, and -- crucially -- the official Konami passcode, which we use
// as the card's id so it lines up with BabelCDB's own id scheme once BabelCDB catches up).
//
// Best-effort: a card whose page has no CardTable2 (not a real card page -- Rush Duel
// variants, anime-mechanic pages, rarity-word parsing artifacts, etc.) or an unrecognized
// field value is just skipped and logged, not treated as fatal.
//
// Known gap vs. a real BabelCDB row: archetype_setcodes is always empty here -- that's
// BabelCDB/ygopro's own internal numeric archetype-grouping scheme, which Yugipedia has no
// equivalent of. Archetype-based features (if any) simply won't recognize these cards as
// part of their archetype until BabelCDB adds them for real.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import pkg from "node-sqlite3-wasm";
import { extractTemplateBlocks, parseTemplateFields, stripRubyMarkup } from "./lib/wikitext.mjs";
import { normalizeEnglishName } from "./lib/name-matching.mjs";
import {
  OcgType,
  ATTRIBUTE_BY_NAME,
  RACE_BY_NAME,
  MONSTER_TYPE_TOKEN_BITS,
  SPELL_PROPERTY_BITS,
  TRAP_PROPERTY_BITS,
  LINK_ARROW_BITS,
} from "./lib/yugipedia-card-mapping.mjs";

const { Database } = pkg;

const WORK_DIR = path.join(process.cwd(), "work");
const OUT_PATH = path.join(WORK_DIR, "yugipedia_cards.json");
const API = "https://yugipedia.com/api.php";
const USER_AGENT = "ocg-inventory-app-data-pipeline/1.0 (personal project; local card inventory app)";
const REQUEST_DELAY_MS = 200;
const TITLES_PER_BATCH = 40;

mkdirSync(WORK_DIR, { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiGet(params) {
  const url = new URL(API);
  for (const [k, v] of Object.entries({ format: "json", ...params })) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Yugipedia API HTTP ${res.status} for ${url}`);
  return res.json();
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Builds a synthetic BabelCDB-shaped card from a parsed {{CardTable2}} field map, or
 *  returns { skip: reason } if the page isn't a normal playable card / has data we can't
 *  confidently map. */
function buildCardFromFields(fields, pageTitle) {
  const password = (fields.password || "").replace(/\D/g, "");
  if (!password) return { skip: "no password/passcode field" };
  const id = Number(password);
  if (!Number.isFinite(id) || id <= 0) return { skip: `invalid password "${fields.password}"` };

  const jaNameRaw = fields.ja_name;
  if (!jaNameRaw) return { skip: "no ja_name field" };
  const nameJa = stripRubyMarkup(jaNameRaw).trim();
  if (!nameJa) return { skip: "empty ja_name after cleanup" };
  const descJa = fields.ja_text ? stripRubyMarkup(fields.ja_text).trim() : "";

  let cardType = 0;
  let race = 0;
  let attribute = 0;
  let atk = 0;
  let def = 0;
  let level = 0;
  let lscale = 0;
  let rscale = 0;
  let linkMarker = 0;

  if (fields.card_type === "Spell" || fields.card_type === "Trap") {
    cardType |= fields.card_type === "Spell" ? OcgType.SPELL : OcgType.TRAP;
    const propMap = fields.card_type === "Spell" ? SPELL_PROPERTY_BITS : TRAP_PROPERTY_BITS;
    const prop = (fields.property || "Normal").trim();
    if (prop !== "Normal") {
      const bit = propMap[prop];
      if (bit === undefined) return { skip: `unknown ${fields.card_type} property "${prop}"` };
      cardType |= bit;
    }
  } else if (fields.attribute || fields.types) {
    cardType |= OcgType.MONSTER;

    const attrName = (fields.attribute || "").trim().toUpperCase();
    if (attrName) {
      const attrBit = ATTRIBUTE_BY_NAME[attrName];
      if (attrBit === undefined) return { skip: `unknown attribute "${fields.attribute}"` };
      attribute = attrBit;
    }

    const typeTokens = (fields.types || "").split("/").map((s) => s.trim()).filter(Boolean);
    let raceFound = false;
    for (const token of typeTokens) {
      if (RACE_BY_NAME[token] !== undefined) {
        race = RACE_BY_NAME[token];
        raceFound = true;
        continue;
      }
      const bit = MONSTER_TYPE_TOKEN_BITS[token];
      if (bit === undefined) return { skip: `unknown monster type token "${token}" (types="${fields.types}")` };
      cardType |= bit;
    }
    if (!raceFound) return { skip: `no recognized race in types="${fields.types}"` };
    if (!(cardType & OcgType.EFFECT) && !(cardType & OcgType.NORMAL)) {
      // Some pages list e.g. just "Warrior / Xyz" without an explicit Normal/Effect token.
      cardType |= fields.text || fields.ja_text ? OcgType.EFFECT : OcgType.NORMAL;
    }

    const isLink = Boolean(cardType & OcgType.LINK);
    atk = fields.atk === "?" || fields.atk === undefined ? 0 : Number(fields.atk) || 0;
    if (isLink) {
      const arrowNames = (fields.link_arrows || "").split(",").map((s) => s.trim()).filter(Boolean);
      for (const a of arrowNames) linkMarker |= LINK_ARROW_BITS[a] ?? 0;
    } else {
      def = fields.def === "?" || fields.def === undefined ? 0 : Number(fields.def) || 0;
    }

    if (cardType & OcgType.XYZ) level = Number(fields.rank) || 0;
    else if (!isLink) level = Number(fields.level) || 0;

    if (cardType & OcgType.PENDULUM) {
      const scale = Number(fields.pendulum_scale) || 0;
      lscale = scale;
      rscale = scale;
    }
  } else {
    return { skip: "neither card_type (spell/trap) nor attribute/types (monster) present -- not a card page" };
  }

  return {
    card: {
      id,
      nameEn: pageTitle,
      nameJa,
      descJa,
      cardType,
      race,
      attribute,
      atk,
      def,
      level,
      lscale,
      rscale,
      linkMarker,
    },
  };
}

async function main() {
  const printsPath = path.join(WORK_DIR, "prints.json");
  const babelPath = path.join(WORK_DIR, "BabelCDB", "cards.cdb");
  if (!existsSync(printsPath)) throw new Error(`Missing ${printsPath} -- run fetch:yugipedia first.`);
  if (!existsSync(babelPath)) throw new Error(`Missing ${babelPath} -- run fetch:babelcdb first.`);

  const printRows = JSON.parse(readFileSync(printsPath, "utf8"));

  const babel = new Database(babelPath, { readOnly: true });
  const matchedKeys = new Set();
  for (const row of babel.all("SELECT name FROM texts")) {
    const key = normalizeEnglishName(row.name ?? "");
    if (key) matchedKeys.add(key);
  }
  babel.close();

  const candidateNames = new Set();
  for (const row of printRows) {
    const key = normalizeEnglishName(row.cardNameEn);
    if (key && !matchedKeys.has(key)) candidateNames.add(row.cardNameEn);
  }
  console.log(`${candidateNames.size} distinct card names not in BabelCDB -- fetching their Yugipedia pages...`);

  const titles = [...candidateNames];
  const batches = chunk(titles, TITLES_PER_BATCH);
  const cards = [];
  const skipReasons = new Map();
  let noContent = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const data = await apiGet({ action: "query", prop: "revisions", rvprop: "content", titles: batch.join("|") });
    const pages = Object.values(data.query?.pages ?? {});
    for (const page of pages) {
      const wikitext = page.revisions?.[0]?.["*"];
      if (!wikitext) {
        noContent++;
        continue;
      }
      const blocks = extractTemplateBlocks(wikitext, "{{CardTable2");
      if (blocks.length === 0) {
        skipReasons.set("no {{CardTable2}} template", (skipReasons.get("no {{CardTable2}} template") ?? 0) + 1);
        continue;
      }
      const fields = parseTemplateFields(blocks[0]);
      const result = buildCardFromFields(fields, page.title);
      if (result.skip) {
        skipReasons.set(result.skip, (skipReasons.get(result.skip) ?? 0) + 1);
        continue;
      }
      cards.push(result.card);
    }
    if ((i + 1) % 10 === 0 || i === batches.length - 1) {
      console.log(`  fetched ${Math.min((i + 1) * TITLES_PER_BATCH, titles.length)}/${titles.length} candidate pages, ${cards.length} cards built so far`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  // Dedupe by id (rare: two different print-row names resolving to the same card page).
  const byId = new Map();
  for (const c of cards) byId.set(c.id, c);
  const uniqueCards = [...byId.values()];

  writeFileSync(OUT_PATH, JSON.stringify(uniqueCards, null, 0));
  console.log(`Built ${uniqueCards.length} Yugipedia-fallback cards -> ${OUT_PATH}`);
  console.log(`${noContent} candidate pages had no content (missing/redirect).`);
  const topSkips = [...skipReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log("Top skip reasons:", topSkips);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
