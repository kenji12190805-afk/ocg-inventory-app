// Pulls yukisaba/EDOPro_japanese (per-set incremental Japanese card text .cdb files) and
// merges them into a single work/ja_texts_merged.cdb with one `texts` table.
//
// Ports the merge algorithm already implemented and working in
// AndroidStudioProjects/yuugiou's CardDatabase.kt (buildMergedJapaneseDb, ~line 149):
// sort files oldest-first by the YYYYMMDD embedded in the filename (files with no date --
// the big base file -- sort first), then INSERT OR REPLACE INTO texts from each file in
// turn, so a later set's data (including errata fixes) wins over the base for the same
// card id.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import pkg from "node-sqlite3-wasm";

const { Database } = pkg;

const WORK_DIR = path.join(process.cwd(), "work");
const REPO_DIR = path.join(WORK_DIR, "EDOPro_japanese");
const REMOTE = "https://github.com/yukisaba/EDOPro_japanese.git";
const MERGED_PATH = path.join(WORK_DIR, "ja_texts_merged.cdb");

mkdirSync(WORK_DIR, { recursive: true });

if (existsSync(path.join(REPO_DIR, ".git"))) {
  console.log("EDOPro_japanese: updating existing checkout...");
  execFileSync("git", ["fetch", "--depth", "1", "origin", "HEAD"], { cwd: REPO_DIR, stdio: "inherit" });
  execFileSync("git", ["reset", "--hard", "FETCH_HEAD"], { cwd: REPO_DIR, stdio: "inherit" });
} else {
  console.log("EDOPro_japanese: cloning...");
  execFileSync("git", ["clone", "--depth", "1", REMOTE, REPO_DIR], { stdio: "inherit" });
}

function dateKeyOf(name) {
  const m = name.match(/\d{8}/);
  return m ? m[0] : "00000000";
}

const sourceFiles = readdirSync(REPO_DIR)
  .filter((f) => f.endsWith(".cdb"))
  .sort((a, b) => {
    const da = dateKeyOf(a);
    const db_ = dateKeyOf(b);
    return da === db_ ? a.localeCompare(b) : da.localeCompare(db_);
  });

if (sourceFiles.length === 0) {
  throw new Error("No .cdb files found in EDOPro_japanese checkout -- repo layout may have changed.");
}

console.log(`Merging ${sourceFiles.length} JA text files (oldest -> newest):`);
for (const f of sourceFiles) console.log(`  ${f} (date key ${dateKeyOf(f)})`);

rmSync(MERGED_PATH, { force: true });
const merged = new Database(MERGED_PATH);
merged.exec(
  "CREATE TABLE texts (id INTEGER PRIMARY KEY, name TEXT, desc TEXT, " +
    Array.from({ length: 16 }, (_, i) => `str${i + 1} TEXT`).join(", ") +
    ")",
);

for (const f of sourceFiles) {
  const srcPath = path.join(REPO_DIR, f).replace(/'/g, "''");
  merged.exec(`ATTACH DATABASE '${srcPath}' AS src`);
  try {
    merged.exec("INSERT OR REPLACE INTO texts SELECT * FROM src.texts");
  } finally {
    merged.exec("DETACH DATABASE src");
  }
}

const count = merged.get("SELECT COUNT(*) AS n FROM texts").n;
merged.close();

const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_DIR }).toString().trim();
writeFileSync(path.join(WORK_DIR, "ja_texts.commit.txt"), commit);
console.log(`JA texts merged: ${count} rows -> ${MERGED_PATH} (source @ ${commit})`);
