// Throwaway smoke test for the {{Set list}} wikitext parser: fetches ONE known Yugipedia
// set page and checks the parser extracts sane rows, without running the full category
// crawl (keeps this cheap to re-run and polite to Yugipedia's API).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractSetListBlocks, parseSetListBlock, deriveSetName } from "./03-fetch-yugipedia-prints.mjs";

const API = "https://yugipedia.com/api.php";
const USER_AGENT = "ocg-inventory-app-data-pipeline/1.0 (personal project; local card inventory app)";
const title = "Set Card Lists:Supreme Darkness (OCG-JP)";

const url = new URL(API);
url.searchParams.set("format", "json");
url.searchParams.set("action", "query");
url.searchParams.set("prop", "revisions");
url.searchParams.set("rvprop", "content");
url.searchParams.set("titles", title);

const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
const data = await res.json();
const page = Object.values(data.query.pages)[0];
const wikitext = page.revisions[0]["*"];

const setName = deriveSetName(page.title);
console.log("setName:", setName);

const blocks = extractSetListBlocks(wikitext);
console.log(`blocks found: ${blocks.length}`);

const rows = blocks.flatMap((b) => parseSetListBlock(b, setName));
console.log(`rows parsed: ${rows.length}`);
console.log(rows.slice(0, 8));
console.log("...");
console.log(rows.slice(-3));

const workDir = path.join(process.cwd(), "work");
mkdirSync(workDir, { recursive: true });
writeFileSync(path.join(workDir, "prints.json"), JSON.stringify(rows));
console.log(`(smoke test) wrote ${rows.length} rows -> work/prints.json for a build-script dry run`);
