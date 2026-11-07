// Stable card_prints.id across builds.
//
// The app's `inventory.print_id` (and price_log.print_id) point at card_prints.id. That id
// used to be a plain AUTOINCREMENT assigned in crawl order, i.e. alphabetical by Yugipedia
// page title -- so every time a new set appeared (or a row was dropped/added anywhere), every
// print after it shifted. Measured between the 2026-09-05 and 2026-10-25 builds: 33,728 of
// 37,105 prints (91%) ended up with a different id. After a sync, a user's inventory then
// silently pointed at other cards.
//
// Fix: carry ids forward. Each build reads the dataset that is currently live, keeps the id
// of every (set_code, card_id, rarity) it already knew, and only *new* prints get fresh ids
// above a persisted high-water mark (so an id is never reused for a different print, even if
// the print that owned it later disappears).
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import pkg from "node-sqlite3-wasm";
import { downloadWithRetry } from "./http.mjs";

const { Database } = pkg;

export const LIVE_DATASET_URL =
  "https://github.com/kenji12190805-afk/ocg-inventory-app/releases/download/dataset-latest/dataset.db";

export function printKey(setCode, cardId, rarity) {
  return `${setCode}\u0001${cardId}\u0001${rarity}`;
}

/**
 * @returns {Promise<{ idByKey: Map<string, number>, highWater: number, source: string }>}
 *
 * Source precedence: $PREV_DATASET_PATH (local testing) -> the live release. If the live
 * release genuinely doesn't exist yet (HTTP 404) this is a first build and numbering starts
 * at 1. Any *other* failure throws: publishing a freshly-renumbered dataset because a
 * download hiccuped is exactly the data-loss bug this module exists to prevent.
 */
export async function loadPreviousPrintIds(workDir) {
  let dbPath = process.env.PREV_DATASET_PATH;
  let source = dbPath ? `PREV_DATASET_PATH=${dbPath}` : LIVE_DATASET_URL;

  if (!dbPath) {
    mkdirSync(workDir, { recursive: true });
    dbPath = path.join(workDir, "previous_dataset.db");
    const res = await downloadWithRetry(LIVE_DATASET_URL, dbPath);
    if (res.status === 404) {
      console.log("No previous dataset is live (HTTP 404) -- first build, print ids start at 1.");
      return { idByKey: new Map(), highWater: 0, source: "none (first build)" };
    }
  } else if (!existsSync(dbPath)) {
    throw new Error(`PREV_DATASET_PATH points at a missing file: ${dbPath}`);
  }

  const db = new Database(dbPath, { readOnly: true });
  try {
    const idByKey = new Map();
    let maxId = 0;
    for (const row of db.all("SELECT id, set_code, card_id, rarity FROM card_prints")) {
      const id = Number(row.id);
      idByKey.set(printKey(row.set_code, Number(row.card_id), row.rarity), id);
      if (id > maxId) maxId = id;
    }
    let storedHighWater = 0;
    try {
      const hw = db.all("SELECT value FROM sync_meta WHERE key = 'print_id_high_water'")[0]?.value;
      storedHighWater = Number(hw) || 0;
    } catch {
      /* older datasets have no such key -- max(id) is the best we can know */
    }
    if (idByKey.size === 0) throw new Error(`previous dataset (${source}) has no card_prints rows -- refusing to renumber from scratch`);
    return { idByKey, highWater: Math.max(maxId, storedHighWater), source };
  } finally {
    db.close();
  }
}
