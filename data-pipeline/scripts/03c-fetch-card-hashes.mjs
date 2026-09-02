// Downloads each card's artwork thumbnail and computes a difference-hash (dHash) of it,
// for the app's イラストで識別 camera mode -- matching a photographed card's illustration
// against every known card by Hamming distance, no text OCR involved. Source images are
// keyed by BabelCDB id (== the official passcode for non-alt-art cards), same CDN the app
// already uses for search-result thumbnails (see app/src/screens/SearchScreen.tsx).
//
// Resumable: existing entries in work/card_hashes.json are kept and skipped, so a re-run
// (weekly, or after adding new cards) only fetches ids it doesn't have a hash for yet
// instead of re-downloading everything every time.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import pkg from "node-sqlite3-wasm";
import { dHashFromBuffer } from "./lib/dhash.mjs";

const { Database } = pkg;

const WORK_DIR = path.join(process.cwd(), "work");
const OUT_PATH = path.join(WORK_DIR, "card_hashes.json");
const IMAGE_BASE = "https://images.ygoprodeck.com/images/cards_small/";
const CONCURRENCY = 12;
const MAX_RETRIES = 2;

mkdirSync(WORK_DIR, { recursive: true });

// ---- collect every card id the built dataset will have (BabelCDB + Yugipedia fallback) ----

const babelPath = path.join(WORK_DIR, "BabelCDB", "cards.cdb");
if (!existsSync(babelPath)) throw new Error(`Missing ${babelPath} -- run fetch:babelcdb first.`);

const ids = new Set();
const babel = new Database(babelPath, { readOnly: true });
for (const row of babel.all("SELECT id FROM datas")) ids.add(Number(row.id));
babel.close();

const yugipediaCardsPath = path.join(WORK_DIR, "yugipedia_cards.json");
if (existsSync(yugipediaCardsPath)) {
  const { cards } = JSON.parse(readFileSync(yugipediaCardsPath, "utf8"));
  for (const c of cards) ids.add(c.id);
}

console.log(`${ids.size} card ids to hash.`);

// ---- resume from existing cache ----

const hashes = existsSync(OUT_PATH) ? JSON.parse(readFileSync(OUT_PATH, "utf8")) : {};
const alreadyDone = new Set(Object.keys(hashes).map(Number));
const todo = [...ids].filter((id) => !alreadyDone.has(id));
console.log(`${alreadyDone.size} already cached, ${todo.length} to fetch.`);

let fetched = 0;
let failed = 0;
const failedIds = [];

async function fetchOne(id) {
  const url = `${IMAGE_BASE}${id}.jpg`;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const hash = await dHashFromBuffer(buffer);
      hashes[id] = hash;
      fetched++;
      return;
    } catch (e) {
      if (attempt === MAX_RETRIES) {
        failed++;
        failedIds.push(id);
        return;
      }
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
}

let cursor = 0;
async function worker() {
  while (cursor < todo.length) {
    const id = todo[cursor++];
    await fetchOne(id);
    const done = fetched + failed;
    if (done % 500 === 0) {
      console.log(`  ${done}/${todo.length} (fetched ${fetched}, failed ${failed})`);
      writeFileSync(OUT_PATH, JSON.stringify(hashes));
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

writeFileSync(OUT_PATH, JSON.stringify(hashes));
console.log(`Done: ${fetched} fetched, ${failed} failed (no image / network), ${Object.keys(hashes).length} total cached -> ${OUT_PATH}`);
if (failedIds.length > 0) console.log("Failed ids (sample):", failedIds.slice(0, 20));
