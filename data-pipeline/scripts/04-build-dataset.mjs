// Combines BabelCDB (mechanics + English names for matching), the merged JA texts, and
// Yugipedia's prints.json into dist/dataset.sqlite, matching schema.sql.
//
// Decode logic (setcode -> archetype tags, type/level bit-packing) mirrors
// yugioh-duel-engine/play.mjs's loadCards() and yuugiou's CardDatabase.kt.loadCards() --
// see data-pipeline/SCHEMA.md.
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import pkg from "node-sqlite3-wasm";
import { normalizeForSearch } from "./lib/normalize.mjs";

const { Database } = pkg;

const WORK_DIR = path.join(process.cwd(), "work");
const DIST_DIR = path.join(process.cwd(), "dist");
const SCHEMA_PATH = path.join(process.cwd(), "schema.sql");
const OUT_PATH = path.join(DIST_DIR, "dataset.sqlite");

const babelPath = path.join(WORK_DIR, "BabelCDB", "cards.cdb");
const jaTextsPath = path.join(WORK_DIR, "ja_texts_merged.cdb");
const printsPath = path.join(WORK_DIR, "prints.json");

for (const p of [babelPath, jaTextsPath, printsPath]) {
  if (!existsSync(p)) throw new Error(`Missing pipeline input: ${p} -- run the fetch steps first.`);
}

// ---- load BabelCDB mechanics + English names (English names are a join key only, not stored) ----

const babel = new Database(babelPath, { readOnly: true });

const cardsById = new Map();
for (const row of babel.all("SELECT id, alias, setcode, type, atk, def, level, race, attribute FROM datas")) {
  const id = Number(row.id);
  const type = Number(row.type);
  const isLink = (type & 0x4000000) !== 0; // OcgType.LINK
  const levelRaw = Number(row.level);
  const defRaw = Number(row.def);
  const setcodeRaw = BigInt(row.setcode);
  const archetypeSetcodes = [0, 1, 2, 3]
    .map((i) => Number((setcodeRaw >> BigInt(i * 16)) & 0xffffn))
    .filter((code) => code !== 0);

  cardsById.set(id, {
    id,
    alias: Number(row.alias),
    cardType: type,
    race: Number(row.race),
    attribute: Number(row.attribute),
    atk: Number(row.atk),
    def: isLink ? 0 : defRaw,
    level: levelRaw & 0xff,
    lscale: (levelRaw >> 24) & 0xff,
    rscale: (levelRaw >> 16) & 0xff,
    linkMarker: isLink ? defRaw : 0,
    archetypeSetcodes,
  });
}

const englishNameById = new Map();
const idsByEnglishNameLower = new Map();
for (const row of babel.all("SELECT id, name FROM texts")) {
  const id = Number(row.id);
  const name = row.name ?? "";
  englishNameById.set(id, name);
  const key = name.trim().toLowerCase();
  if (key && !idsByEnglishNameLower.has(key)) idsByEnglishNameLower.set(key, []);
  if (key) idsByEnglishNameLower.get(key).push(id);
}
babel.close();

// ---- load JA texts ----

const jaDb = new Database(jaTextsPath, { readOnly: true });
const jaTextById = new Map();
for (const row of jaDb.all("SELECT id, name, desc FROM texts")) {
  jaTextById.set(Number(row.id), { name: row.name ?? "", desc: row.desc ?? "" });
}
jaDb.close();

// ---- load Yugipedia prints, match to card ids by English name ----

const printRows = JSON.parse(readFileSync(printsPath, "utf8"));
let matchedCount = 0;
let ambiguousCount = 0;
let unmatchedCount = 0;
const unmatchedNames = new Set();
const resolvedPrints = [];

for (const row of printRows) {
  const key = row.cardNameEn.trim().toLowerCase();
  const ids = idsByEnglishNameLower.get(key);
  if (!ids || ids.length === 0) {
    unmatchedCount++;
    unmatchedNames.add(row.cardNameEn);
    continue;
  }
  if (ids.length > 1) ambiguousCount++; // still usable -- take the first id, just logged
  matchedCount++;
  resolvedPrints.push({
    cardId: ids[0],
    setCode: row.setCode,
    setName: row.setName,
    rarity: row.rarity ?? "",
    releaseDate: row.releaseDate,
  });
}

console.log(
  `Print matching: ${matchedCount} matched (${ambiguousCount} ambiguous, took first), ${unmatchedCount} unmatched (${unmatchedNames.size} distinct names).`,
);
if (unmatchedNames.size > 0) {
  console.log("First unmatched names:", [...unmatchedNames].slice(0, 20));
}

// ---- build output db ----

mkdirSync(DIST_DIR, { recursive: true });
rmSync(OUT_PATH, { force: true });
const out = new Database(OUT_PATH);
out.exec(readFileSync(SCHEMA_PATH, "utf8"));

out.exec("BEGIN");
const insertCard = out.prepare(
  `INSERT INTO cards (id, alias, name_ja, name_ja_normalized, desc_ja, desc_ja_normalized,
    card_type, race, attribute, atk, def, level, lscale, rscale, link_marker, archetype_setcodes)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
let cardCount = 0;
for (const card of cardsById.values()) {
  const ja = jaTextById.get(card.id);
  const nameJa = ja?.name || englishNameById.get(card.id) || `カード<${card.id}>`;
  const descJa = ja?.desc || "";
  insertCard.run([
    card.id,
    card.alias,
    nameJa,
    normalizeForSearch(nameJa),
    descJa,
    normalizeForSearch(descJa),
    card.cardType,
    card.race,
    card.attribute,
    card.atk,
    card.def,
    card.level,
    card.lscale,
    card.rscale,
    card.linkMarker,
    JSON.stringify(card.archetypeSetcodes),
  ]);
  cardCount++;
}
insertCard.finalize();

const insertPrint = out.prepare(
  "INSERT OR IGNORE INTO card_prints (card_id, set_code, set_name, rarity, release_date) VALUES (?, ?, ?, ?, ?)",
);
for (const p of resolvedPrints) {
  insertPrint.run([p.cardId, p.setCode, p.setName, p.rarity, p.releaseDate]);
}
insertPrint.finalize();
out.exec("COMMIT");

const builtAt = new Date().toISOString();
const babelCommit = existsSync(path.join(WORK_DIR, "babelcdb.commit.txt"))
  ? readFileSync(path.join(WORK_DIR, "babelcdb.commit.txt"), "utf8").trim()
  : "unknown";
const jaCommit = existsSync(path.join(WORK_DIR, "ja_texts.commit.txt"))
  ? readFileSync(path.join(WORK_DIR, "ja_texts.commit.txt"), "utf8").trim()
  : "unknown";

const insertMeta = out.prepare("INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)");
insertMeta.run(["dataset_version", builtAt]);
insertMeta.run(["built_at", builtAt]);
insertMeta.run(["babelcdb_commit", babelCommit]);
insertMeta.run(["ja_source_commit", jaCommit]);
insertMeta.run(["yugipedia_fetched_at", builtAt]);
insertMeta.finalize();

out.close();

console.log(`Dataset built: ${cardCount} cards, ${resolvedPrints.length} prints -> ${OUT_PATH}`);
