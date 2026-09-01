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

/** Just the Japanese name/text out of a parsed {{CardTable2}} field map -- all that's
 *  needed for a card BabelCDB already has (correct mechanics) but ja_texts_merged.cdb
 *  doesn't have text for yet. Returns null if there's no usable ja_name. */
function extractJaText(fields) {
  const jaNameRaw = fields.ja_name;
  if (!jaNameRaw) return null;
  const nameJa = stripRubyMarkup(jaNameRaw).trim();
  if (!nameJa) return null;
  const descJa = fields.ja_text ? stripRubyMarkup(fields.ja_text).trim() : "";
  return { nameJa, descJa };
}

/** Builds a synthetic BabelCDB-shaped card from a parsed {{CardTable2}} field map, or
 *  returns { skip: reason } if the page isn't a normal playable card / has data we can't
 *  confidently map. Only used for cards BabelCDB doesn't have at all -- needs a real
 *  Konami passcode (`password`) to assign a stable id, so tokens (which don't have one)
 *  can only ever be filled in via extractJaText against an id BabelCDB already assigned. */
function buildCardFromFields(fields, pageTitle) {
  const password = (fields.password || "").replace(/\D/g, "");
  if (!password) return { skip: "no password/passcode field" };
  const id = Number(password);
  if (!Number.isFinite(id) || id <= 0) return { skip: `invalid password "${fields.password}"` };

  const ja = extractJaText(fields);
  if (!ja) return { skip: "no ja_name field" };
  const { nameJa, descJa } = ja;

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
  } else if (fields.card_type === "Token" || fields.attribute || fields.types) {
    cardType |= OcgType.MONSTER;
    if (fields.card_type === "Token") cardType |= OcgType.TOKEN;

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
  const jaTextsPath = path.join(WORK_DIR, "ja_texts_merged.cdb");
  if (!existsSync(printsPath)) throw new Error(`Missing ${printsPath} -- run fetch:yugipedia first.`);
  if (!existsSync(babelPath)) throw new Error(`Missing ${babelPath} -- run fetch:babelcdb first.`);
  if (!existsSync(jaTextsPath)) throw new Error(`Missing ${jaTextsPath} -- run fetch:ja-texts first.`);

  const printRows = JSON.parse(readFileSync(printsPath, "utf8"));

  const babel = new Database(babelPath, { readOnly: true });
  const idsByKey = new Map();
  const nameById = new Map();
  for (const row of babel.all("SELECT id, name FROM texts")) {
    const id = Number(row.id);
    nameById.set(id, row.name ?? "");
    const key = normalizeEnglishName(row.name ?? "");
    if (!key) continue;
    if (!idsByKey.has(key)) idsByKey.set(key, []);
    idsByKey.get(key).push(id);
  }
  const aliasById = new Map();
  for (const row of babel.all("SELECT id, alias FROM datas")) {
    aliasById.set(Number(row.id), Number(row.alias));
  }
  babel.close();

  // A BabelCDB id can be mechanically complete but still have no Japanese name/text yet --
  // ja_texts_merged.cdb (the community JA patch) lags new sets independently of BabelCDB
  // itself. Those cards need a Yugipedia fetch too: not for mechanics (BabelCDB already has
  // the real thing), just to fill in ja_name/ja_text instead of falling back to the raw
  // English name -- see how 04-build-dataset.mjs's yugipediaJaById is used as a fallback
  // layer UNDER ja_texts_merged.cdb, never overriding it. An id whose `alias` (BabelCDB's
  // own alt-art/errata pointer) already has ja_text is covered by 04's alias fallback for
  // free, without a network fetch -- see hasJaTextOrAliasCovers.
  const jaDb = new Database(jaTextsPath, { readOnly: true });
  const idsWithJaText = new Set(jaDb.all("SELECT id FROM texts").map((r) => Number(r.id)));
  jaDb.close();

  function hasJaTextOrAliasCovers(id) {
    if (idsWithJaText.has(id)) return true;
    const alias = aliasById.get(id) || 0;
    return alias !== 0 && idsWithJaText.has(alias);
  }

  // Combined candidate map, keyed by normalized name (so a name reachable both via a print
  // row and via the BabelCDB sweep below is only ever fetched once). needsFullCard means
  // "not in BabelCDB at all -- extract id from the page's own password"; targetIds means
  // "already has this BabelCDB id -- just needs ja_name/ja_text for it".
  const candidates = new Map();
  function addCandidate(title, needsFullCard, targetId) {
    const key = normalizeEnglishName(title);
    if (!key) return;
    let c = candidates.get(key);
    if (!c) {
      c = { title, needsFullCard: false, targetIds: new Set() };
      candidates.set(key, c);
    }
    if (needsFullCard) c.needsFullCard = true;
    if (targetId) c.targetIds.add(targetId);
  }

  // Cards a collector would actually encounter: every Set Card Lists print row.
  let missingCardCount = 0;
  let missingJaFromPrintsCount = 0;
  for (const row of printRows) {
    const key = normalizeEnglishName(row.cardNameEn);
    if (!key) continue;
    const ids = idsByKey.get(key);
    if (!ids) {
      if (!candidates.has(key)) missingCardCount++;
      addCandidate(row.cardNameEn, true, null);
    } else {
      for (const id of ids) {
        if (!hasJaTextOrAliasCovers(id)) {
          if (!candidates.has(key)) missingJaFromPrintsCount++;
          addCandidate(row.cardNameEn, false, id);
        }
      }
    }
  }

  // Every remaining BabelCDB card missing ja_text regardless of whether it showed up in a
  // crawled print row -- tokens in particular usually aren't in a product's own Set Card
  // Lists the way real printed cards are.
  let missingJaDirectCount = 0;
  for (const [id, name] of nameById) {
    if (!name || hasJaTextOrAliasCovers(id)) continue;
    const key = normalizeEnglishName(name);
    if (candidates.get(key)?.targetIds.has(id)) continue; // already added above
    missingJaDirectCount++;
    addCandidate(name, false, id);
  }

  console.log(
    `${candidates.size} distinct card names need a Yugipedia fetch (${missingCardCount} not in BabelCDB at all, ` +
      `${missingJaFromPrintsCount} in BabelCDB but missing ja_text (from prints), ` +
      `${missingJaDirectCount} more missing ja_text found by sweeping all of BabelCDB) -- fetching...`,
  );

  const titles = [...candidates.values()].map((c) => c.title);
  const batches = chunk(titles, TITLES_PER_BATCH);
  const cards = [];
  const jaOnlyEntries = [];
  const skipReasons = new Map();
  let noContent = 0;

  function recordSkip(reason) {
    skipReasons.set(reason, (skipReasons.get(reason) ?? 0) + 1);
  }

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
      const info = candidates.get(normalizeEnglishName(page.title));
      if (!info) continue; // shouldn't happen -- defensive only
      const blocks = extractTemplateBlocks(wikitext, "{{CardTable2");
      if (blocks.length === 0) {
        recordSkip("no {{CardTable2}} template");
        continue;
      }
      const fields = parseTemplateFields(blocks[0]);

      if (info.needsFullCard) {
        const result = buildCardFromFields(fields, page.title);
        if (result.skip) recordSkip(result.skip);
        else cards.push(result.card);
      }
      if (info.targetIds.size > 0) {
        const ja = extractJaText(fields);
        if (!ja) recordSkip("no ja_name field (ja-text-only target)");
        else for (const id of info.targetIds) jaOnlyEntries.push({ id, nameJa: ja.nameJa, descJa: ja.descJa });
      }
    }
    if ((i + 1) % 10 === 0 || i === batches.length - 1) {
      console.log(
        `  fetched ${Math.min((i + 1) * TITLES_PER_BATCH, titles.length)}/${titles.length} candidate pages, ` +
          `${cards.length} new cards + ${jaOnlyEntries.length} ja-text fills so far`,
      );
    }
    await sleep(REQUEST_DELAY_MS);
  }

  // Dedupe by id (rare: two different candidate names resolving to the same card page).
  const cardsById = new Map();
  for (const c of cards) cardsById.set(c.id, c);
  const jaOnlyById = new Map();
  for (const e of jaOnlyEntries) jaOnlyById.set(e.id, e);

  writeFileSync(
    OUT_PATH,
    JSON.stringify({ cards: [...cardsById.values()], jaOnly: [...jaOnlyById.values()] }, null, 0),
  );
  console.log(
    `Built ${cardsById.size} new cards + ${jaOnlyById.size} ja-text-only fills -> ${OUT_PATH}`,
  );
  console.log(`${noContent} candidate pages had no content (missing/redirect).`);
  const topSkips = [...skipReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log("Top skip reasons:", topSkips);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
