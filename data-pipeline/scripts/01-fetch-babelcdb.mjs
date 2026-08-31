// Shallow-clones (or updates) ProjectIgnis/BabelCDB into work/BabelCDB.
//
// The upstream repo also publishes a "delta" companion repo (ProjectIgnis/DeltaBagooska,
// see BabelCDB's own .github/workflows/commit-delta-puppet-repo.yml) for consumers that
// keep a persistent local checkout and want to pull just the changed rows each time. This
// pipeline runs fresh in CI every week instead, so a shallow clone of current master is
// simpler and just as cheap -- no benefit to the delta mechanism here.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const WORK_DIR = path.join(process.cwd(), "work");
const REPO_DIR = path.join(WORK_DIR, "BabelCDB");
const REMOTE = "https://github.com/ProjectIgnis/BabelCDB.git";

mkdirSync(WORK_DIR, { recursive: true });

if (existsSync(path.join(REPO_DIR, ".git"))) {
  console.log("BabelCDB: updating existing checkout...");
  execFileSync("git", ["fetch", "--depth", "1", "origin", "master"], { cwd: REPO_DIR, stdio: "inherit" });
  execFileSync("git", ["reset", "--hard", "origin/master"], { cwd: REPO_DIR, stdio: "inherit" });
} else {
  console.log("BabelCDB: cloning...");
  execFileSync("git", ["clone", "--depth", "1", REMOTE, REPO_DIR], { stdio: "inherit" });
}

const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_DIR }).toString().trim();
writeFileSync(path.join(WORK_DIR, "babelcdb.commit.txt"), commit);
console.log(`BabelCDB @ ${commit} -> ${path.join(REPO_DIR, "cards.cdb")}`);
