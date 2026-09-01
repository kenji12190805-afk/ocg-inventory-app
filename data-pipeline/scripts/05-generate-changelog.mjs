// Diffs the just-built dist/dataset.db against whatever is *currently* live at
// dataset-latest (fetched fresh here, before this run's "Publish dataset as a release"
// step overwrites it) to produce dist/changelog.json -- what the app's changelog screen
// shows after a sync ("新着カード"). Must run after 04-build-dataset.mjs and before the
// release-publish step in build-dataset.yml.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import pkg from "node-sqlite3-wasm";

const { Database } = pkg;

const DIST_DIR = path.join(process.cwd(), "dist");
const NEW_DB_PATH = path.join(DIST_DIR, "dataset.db");
const PREV_DB_PATH = path.join(DIST_DIR, "previous_dataset.db");
const CHANGELOG_PATH = path.join(DIST_DIR, "changelog.json");
const PREV_DATASET_URL =
  "https://github.com/kenji12190805-afk/ocg-inventory-app/releases/download/dataset-latest/dataset.db";
// Cap how many individual new cards ship in the JSON -- a first-ever run (no previous
// release) or an unusually large week would otherwise balloon this file. The screen shows
// "+N more" beyond this using newCardCount, which is never capped.
const MAX_NEW_CARDS_LISTED = 500;

async function main() {
  if (!existsSync(NEW_DB_PATH)) throw new Error(`Missing ${NEW_DB_PATH} -- run the build step first.`);

  const prevCardIds = new Set();
  const prevSetNames = new Set();
  let previousBuiltAt = null;

  console.log(`Fetching current live dataset from ${PREV_DATASET_URL} to diff against...`);
  try {
    const res = await fetch(PREV_DATASET_URL);
    if (res.ok) {
      writeFileSync(PREV_DB_PATH, Buffer.from(await res.arrayBuffer()));
      const prevDb = new Database(PREV_DB_PATH, { readOnly: true });
      for (const row of prevDb.all("SELECT id FROM cards")) prevCardIds.add(Number(row.id));
      for (const row of prevDb.all("SELECT DISTINCT set_name FROM card_prints")) prevSetNames.add(row.set_name);
      previousBuiltAt = prevDb.all("SELECT value FROM sync_meta WHERE key = 'built_at'")[0]?.value ?? null;
      prevDb.close();
      console.log(`Previous dataset: ${prevCardIds.size} cards, ${prevSetNames.size} sets, built_at=${previousBuiltAt}`);
    } else {
      console.log(`No previous dataset live (HTTP ${res.status}) -- treating this as the first build, no diff.`);
    }
  } catch (err) {
    console.log(`Could not fetch previous dataset for diffing (${err.message}) -- changelog will be empty.`);
  }

  const db = new Database(NEW_DB_PATH, { readOnly: true });
  const builtAt = db.all("SELECT value FROM sync_meta WHERE key = 'built_at'")[0]?.value ?? null;

  // Only cards with at least one known print -- a card with no print row isn't something a
  // collector could actually have just found in a new pack, so it doesn't belong in "what's
  // newly collectible this week" even if it's technically a new row in `cards`.
  const newCards = [];
  for (const row of db.all(
    "SELECT DISTINCT c.id, c.name_ja, c.card_type FROM cards c JOIN card_prints p ON p.card_id = c.id",
  )) {
    const id = Number(row.id);
    if (!prevCardIds.has(id)) newCards.push({ id, nameJa: row.name_ja, cardType: Number(row.card_type) });
  }

  const newSets = [];
  for (const row of db.all("SELECT DISTINCT set_name FROM card_prints")) {
    if (prevSetNames.has(row.set_name)) continue;
    const countRow = db.all(
      "SELECT COUNT(DISTINCT card_id) n FROM card_prints WHERE set_name = ?",
      [row.set_name],
    )[0];
    newSets.push({ setName: row.set_name, cardCount: countRow?.n ?? 0 });
  }
  newSets.sort((a, b) => b.cardCount - a.cardCount);
  db.close();

  const changelog = {
    builtAt,
    previousBuiltAt,
    newCardCount: newCards.length,
    newCards: newCards.slice(0, MAX_NEW_CARDS_LISTED),
    newSets,
  };
  writeFileSync(CHANGELOG_PATH, JSON.stringify(changelog));
  console.log(`Changelog: ${newCards.length} new cards, ${newSets.length} new sets -> ${CHANGELOG_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
