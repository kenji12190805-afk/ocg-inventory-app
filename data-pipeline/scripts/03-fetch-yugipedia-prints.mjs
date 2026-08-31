// Crawls Yugipedia's MediaWiki API for every OCG "Set Card Lists" page (Set Card Lists
// namespace, id 3006, category "Japanese Set Card Lists") and parses each page's
// {{Set list|region=JP|...}} template into (set_code, set_name, card_name_en, rarity[])
// rows. Output: work/prints.json -- an intermediate artifact so the (slow, rate-limited)
// network crawl is decoupled from the fast, offline dataset build step.
//
// License note: Set Card Lists content is Yugipedia's own (CC BY-SA) -- see BRIEF.md /
// SCHEMA.md for why this source was picked over db.yugioh-card.com.
//
// Known gap: release_date is not populated yet (always null here). Getting it reliably
// would mean a second fetch per set's *main* page (not just its Set Card Lists page) to
// read the infobox, roughly doubling the request count -- left for a follow-up rather than
// blocking the first working pipeline. card_prints.release_date is nullable for this reason.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const WORK_DIR = path.join(process.cwd(), "work");
const OUT_PATH = path.join(WORK_DIR, "prints.json");
const API = "https://yugipedia.com/api.php";
const USER_AGENT = "ocg-inventory-app-data-pipeline/1.0 (personal project; local card inventory app)";
const CATEGORY = "Category:Japanese Set Card Lists";
const REQUEST_DELAY_MS = 200;
const TITLES_PER_BATCH = 20;

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

async function fetchAllSetListTitles() {
  const titles = [];
  let cmcontinue;
  do {
    const data = await apiGet({
      action: "query",
      list: "categorymembers",
      cmtitle: CATEGORY,
      cmlimit: "500",
      cmnamespace: "3006",
      ...(cmcontinue ? { cmcontinue } : {}),
    });
    for (const m of data.query?.categorymembers ?? []) titles.push(m.title);
    cmcontinue = data.continue?.cmcontinue;
    await sleep(REQUEST_DELAY_MS);
  } while (cmcontinue);
  return titles;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function stripWikiLink(text) {
  // [[Card Name]] -> Card Name ; [[Actual Page|Displayed Text]] -> Displayed Text
  return text.replace(/\[\[([^|\]]*)\|?([^\]]*)\]\]/g, (_, target, display) => display || target).trim();
}

export function deriveSetName(pageTitle) {
  return pageTitle.replace(/^Set Card Lists:/, "").replace(/\s*\(OCG-JP\)\s*$/, "").trim();
}

// Extracts every {{Set list|region=JP|...}} block from a page's wikitext, depth-counting
// braces so nested templates inside a line (rare, but card names sometimes use them) don't
// truncate the block early.
export function extractSetListBlocks(wikitext) {
  const blocks = [];
  const marker = "{{Set list";
  let searchFrom = 0;
  while (true) {
    const start = wikitext.indexOf(marker, searchFrom);
    if (start === -1) break;
    let depth = 0;
    let i = start;
    let end = -1;
    while (i < wikitext.length) {
      if (wikitext.startsWith("{{", i)) {
        depth++;
        i += 2;
      } else if (wikitext.startsWith("}}", i)) {
        depth--;
        i += 2;
        if (depth === 0) {
          end = i;
          break;
        }
      } else {
        i++;
      }
    }
    if (end === -1) break;
    blocks.push(wikitext.slice(start + 2, end - 2)); // strip outer {{ }}
    searchFrom = end;
  }
  return blocks;
}

export function parseSetListBlock(block, setName) {
  const lines = block.split("\n");
  const header = lines[0]; // "Set list|region=JP|rarities=Common|" (first line, may have trailing '|')
  const headerParams = header.split("|").slice(1);
  let region = null;
  let defaultRarity = null;
  for (const p of headerParams) {
    const [k, v] = p.split("=").map((s) => s?.trim());
    if (k === "region") region = v;
    if (k === "rarities") defaultRarity = v;
  }
  if (region !== "JP") return [];

  const rows = [];
  for (const rawLine of lines.slice(1)) {
    const line = rawLine.trim().replace(/^\|/, "").trim();
    if (!line || line === "}}") continue;
    const fields = line.split(";").map((s) => s.trim());
    const setCode = fields[0];
    if (!setCode || !/^[A-Za-z0-9]/.test(setCode)) continue; // skip stray param/comment lines
    const cardNameEn = stripWikiLink(fields[1] ?? "");
    if (!cardNameEn) continue;
    const rarityField = fields[2];
    const rarities = rarityField
      ? rarityField.split(",").map((s) => s.trim()).filter(Boolean)
      : defaultRarity
        ? [defaultRarity]
        : [];
    for (const rarity of rarities.length ? rarities : [null]) {
      rows.push({ setCode, setName, cardNameEn, rarity, releaseDate: null });
    }
  }
  return rows;
}

async function main() {
  console.log(`Listing pages in "${CATEGORY}"...`);
  const titles = await fetchAllSetListTitles();
  console.log(`${titles.length} set list pages found.`);

  const allRows = [];
  const batches = chunk(titles, TITLES_PER_BATCH);
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const data = await apiGet({
      action: "query",
      prop: "revisions",
      rvprop: "content",
      titles: batch.join("|"),
    });
    const pages = Object.values(data.query?.pages ?? {});
    for (const page of pages) {
      const wikitext = page.revisions?.[0]?.["*"];
      if (!wikitext) continue;
      const setName = deriveSetName(page.title);
      for (const blockText of extractSetListBlocks(wikitext)) {
        allRows.push(...parseSetListBlock(blockText, setName));
      }
    }
    if ((i + 1) % 10 === 0 || i === batches.length - 1) {
      console.log(`  fetched ${Math.min((i + 1) * TITLES_PER_BATCH, titles.length)}/${titles.length} pages, ${allRows.length} rows so far`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  writeFileSync(OUT_PATH, JSON.stringify(allRows, null, 0));
  console.log(`Yugipedia prints: ${allRows.length} rows -> ${OUT_PATH}`);
}

const isMain = import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
