// Downloads overseas (English TCG) reference prices from YGOPRODeck's free public API --
// no API key, 20 req/sec rate limit, and the whole card database comes back in one
// paginated bulk call (unlike 03c's per-card image fetches). These are NOT Japanese OCG
// secondhand prices -- see schema.sql's card_prices comment for why the two markets
// diverge -- the app labels this clearly as a reference-only figure.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const WORK_DIR = path.join(process.cwd(), "work");
const OUT_PATH = path.join(WORK_DIR, "card_prices.json");
const API_BASE = "https://db.ygoprodeck.com/api/v7/cardinfo.php";
const MAX_RETRIES = 3;

mkdirSync(WORK_DIR, { recursive: true });

async function fetchPage(offset) {
  const url = `${API_BASE}?num=2000&offset=${offset}`;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt === MAX_RETRIES) throw e;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

const prices = {};
let offset = 0;
let total = null;

while (total === null || offset < total) {
  const page = await fetchPage(offset);
  total = page.meta?.total_rows ?? page.data.length;
  for (const card of page.data) {
    const p = card.card_prices?.[0];
    if (!p) continue;
    prices[card.id] = {
      cardmarket_eur: Number(p.cardmarket_price) || null,
      tcgplayer_usd: Number(p.tcgplayer_price) || null,
      ebay_usd: Number(p.ebay_price) || null,
      amazon_usd: Number(p.amazon_price) || null,
      coolstuffinc_usd: Number(p.coolstuffinc_price) || null,
    };
  }
  console.log(`  ${Math.min(offset + page.data.length, total)}/${total}`);
  offset += page.data.length;
  if (page.data.length === 0) break; // safety net against an infinite loop on an API surprise
}

writeFileSync(OUT_PATH, JSON.stringify(prices));
console.log(`Done: ${Object.keys(prices).length} cards with a price -> ${OUT_PATH}`);
