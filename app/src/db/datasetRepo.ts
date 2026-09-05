import type { SQLiteDBConnection } from '@capacitor-community/sqlite';
import { normalizeForSearch } from './normalize';
import { SPELL_SUBTYPE_BITS, TRAP_SUBTYPE_BITS } from '../gameConstants';
import { hammingDistanceHex } from '../imageHash';
import type { Card, CardPrice, CardPrint, SyncMeta } from './types';

function rowToCard(row: any): Card {
  return {
    id: row.id,
    alias: row.alias,
    name_ja: row.name_ja,
    desc_ja: row.desc_ja,
    card_type: row.card_type,
    race: row.race,
    attribute: row.attribute,
    atk: row.atk,
    def: row.def,
    level: row.level,
    lscale: row.lscale,
    rscale: row.rscale,
    link_marker: row.link_marker,
    archetype_setcodes: JSON.parse(row.archetype_setcodes ?? '[]'),
  };
}

export interface SearchFilters {
  text?: string;
  attributeMask?: number; // OR of selected ATTRIBUTES values, 0/undefined = no filter
  raceMask?: number; // OR of selected RACES values
  supertypeMask?: number; // OR of selected SUPERTYPES values
  // Spell/trap subtype (see SPELL_TYPES/TRAP_TYPES in gameConstants.ts): undefined = no
  // filter, 0 = the "normal" sentinel (none of the subtype bits set), else that bit.
  spellSubtype?: number;
  trapSubtype?: number;
}

export async function searchCards(conn: SQLiteDBConnection, filters: SearchFilters): Promise<Card[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.text?.trim()) {
    const q = `%${normalizeForSearch(filters.text.trim())}%`;
    clauses.push('(name_ja_normalized LIKE ? OR desc_ja_normalized LIKE ?)');
    params.push(q, q);
  }
  if (filters.attributeMask) {
    clauses.push('(attribute & ?) != 0');
    params.push(filters.attributeMask);
  }
  if (filters.raceMask) {
    clauses.push('(race & ?) != 0');
    params.push(filters.raceMask);
  }
  if (filters.supertypeMask) {
    clauses.push('(card_type & ?) != 0');
    params.push(filters.supertypeMask);
  }
  if (filters.spellSubtype !== undefined) {
    if (filters.spellSubtype === 0) {
      clauses.push('(card_type & ?) = 0');
      params.push(SPELL_SUBTYPE_BITS);
    } else {
      clauses.push('(card_type & ?) != 0');
      params.push(filters.spellSubtype);
    }
  }
  if (filters.trapSubtype !== undefined) {
    if (filters.trapSubtype === 0) {
      clauses.push('(card_type & ?) = 0');
      params.push(TRAP_SUBTYPE_BITS);
    } else {
      clauses.push('(card_type & ?) != 0');
      params.push(filters.trapSubtype);
    }
  }

  // No LIMIT: the dataset is ~15k cards and any real filter narrows it far below what's
  // comfortable to scroll, so cap-at-100 was hiding legitimate results (feature request #5).
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await conn.query(`SELECT * FROM cards ${where} ORDER BY name_ja_normalized`, params);
  return (result.values ?? []).map(rowToCard);
}

export async function getCard(conn: SQLiteDBConnection, id: number): Promise<Card | null> {
  const result = await conn.query('SELECT * FROM cards WHERE id = ?', [id]);
  const row = result.values?.[0];
  return row ? rowToCard(row) : null;
}

export async function getPrintsForCard(
  conn: SQLiteDBConnection,
  cardId: number,
): Promise<CardPrint[]> {
  const result = await conn.query(
    'SELECT * FROM card_prints WHERE card_id = ? ORDER BY release_date IS NULL, release_date, set_code',
    [cardId],
  );
  return (result.values ?? []) as CardPrint[];
}

/** Overseas (TCG) reference price for a card, if the dataset has one -- null for cards
 *  YGOPRODeck doesn't carry (OCG-only prints), that simply have no listed price yet, or
 *  (best-effort try/catch) a dataset synced before this table existed at all -- the app
 *  shouldn't crash the whole card detail screen just because the cached dataset predates
 *  this feature; it'll show reference prices again next time it re-syncs. */
export async function getCardPrice(conn: SQLiteDBConnection, cardId: number): Promise<CardPrice | null> {
  try {
    const result = await conn.query('SELECT * FROM card_prices WHERE card_id = ?', [cardId]);
    return (result.values?.[0] as CardPrice) ?? null;
  } catch {
    return null;
  }
}

export async function getPrint(conn: SQLiteDBConnection, printId: number): Promise<CardPrint | null> {
  const result = await conn.query('SELECT * FROM card_prints WHERE id = ?', [printId]);
  return (result.values?.[0] as CardPrint) ?? null;
}

/** Print ids grouped by card id -- feeds localRepo's getOwnedCountByCardIds so search
 *  results can show how many of each card are already in inventory (across all its
 *  prints). Bulk version of getPrintsForCard, for a whole page of search results at once. */
export async function getPrintIdsForCards(
  conn: SQLiteDBConnection,
  cardIds: number[],
): Promise<Map<number, number[]>> {
  const map = new Map<number, number[]>();
  if (cardIds.length === 0) return map;
  const placeholders = cardIds.map(() => '?').join(',');
  const result = await conn.query(
    `SELECT id, card_id FROM card_prints WHERE card_id IN (${placeholders})`,
    cardIds,
  );
  for (const row of result.values ?? []) {
    const list = map.get(row.card_id);
    if (list) list.push(row.id);
    else map.set(row.card_id, [row.id]);
  }
  return map;
}

/** Exact (post-normalization) name match -- used by deck-list text import. Multiple cards
 *  can share a name (alt art / errata reprints under a different BabelCDB id); the caller
 *  picks one (lowest id) as canonical. */
export async function findCardByExactName(conn: SQLiteDBConnection, name: string): Promise<Card | null> {
  const key = normalizeForSearch(name.trim());
  if (!key) return null;
  const result = await conn.query(
    'SELECT * FROM cards WHERE name_ja_normalized = ? ORDER BY id LIMIT 1',
    [key],
  );
  const row = result.values?.[0];
  return row ? rowToCard(row) : null;
}

export async function getCardsByIds(conn: SQLiteDBConnection, ids: number[]): Promise<Map<number, Card>> {
  const map = new Map<number, Card>();
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => '?').join(',');
  const result = await conn.query(`SELECT * FROM cards WHERE id IN (${placeholders})`, ids);
  for (const row of result.values ?? []) map.set(row.id, rowToCard(row));
  return map;
}

// Longest common contiguous substring, used by camera OCR matching (score = LCS length /
// candidate name length). Single-row DP to keep memory flat over ~15k comparisons.
export function longestCommonSubstringLength(a: string, b: string): number {
  if (!a || !b) return 0;
  let prevRow = new Array(b.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= a.length; i++) {
    const currRow = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        currRow[j] = prevRow[j - 1] + 1;
        if (currRow[j] > best) best = currRow[j];
      }
    }
    prevRow = currRow;
  }
  return best;
}

export interface OcrCandidate {
  card: Card;
  score: number; // 0..1
}

/** Scores every card's name against OCR'd text via longest-common-substring overlap and
 *  returns the top N. Best-effort only -- OCR text from a card photo is noisy, this just
 *  narrows down candidates for the user to pick from, not an exact identification. */
export async function matchCardsByOcrText(
  conn: SQLiteDBConnection,
  ocrText: string,
  topN = 5,
): Promise<OcrCandidate[]> {
  // Tesseract's Japanese model frequently inserts a space between every single glyph it
  // isolates as its own "word" (e.g. reading "救の合縁" as "救 の 合 縁") -- real card names
  // never have inter-character spaces, so that gap alone was enough to break the LCS
  // contiguous-match below into single-character fragments, even when every individual
  // character was read correctly. Stripping whitespace from the OCR side only (never from
  // the dataset's own normalized names, which do use real spaces in the rare cases that
  // matter) restores the actual multi-character run this is supposed to find.
  const haystack = normalizeForSearch(ocrText).replace(/\s+/g, '').slice(0, 500);
  if (!haystack) return [];
  const result = await conn.query('SELECT id, name_ja, name_ja_normalized FROM cards');
  const scored: OcrCandidate[] = [];
  for (const row of result.values ?? []) {
    const needle: string = row.name_ja_normalized;
    if (!needle || needle.length < 2) continue;
    const lcs = longestCommonSubstringLength(needle, haystack);
    const score = lcs / needle.length;
    if (score >= 0.5) {
      scored.push({ card: { id: row.id, name_ja: row.name_ja } as Card, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, topN);
  const full = await getCardsByIds(conn, top.map((t) => t.card.id));
  return top.map((t) => ({ card: full.get(t.card.id) ?? t.card, score: t.score }));
}

export async function getPrintsByIds(conn: SQLiteDBConnection, ids: number[]): Promise<Map<number, CardPrint>> {
  const map = new Map<number, CardPrint>();
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => '?').join(',');
  const result = await conn.query(`SELECT * FROM card_prints WHERE id IN (${placeholders})`, ids);
  for (const row of (result.values ?? []) as CardPrint[]) map.set(row.id, row);
  return map;
}

/** Total number of known prints for each of the given set names (for collection-%
 *  completion in the stats screen). Only queried for sets the user actually owns
 *  something in, not every set in history. */
export async function getPrintCountsBySetNames(
  conn: SQLiteDBConnection,
  setNames: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (setNames.length === 0) return counts;
  const placeholders = setNames.map(() => '?').join(',');
  const result = await conn.query(
    `SELECT set_name, COUNT(*) AS n FROM card_prints WHERE set_name IN (${placeholders}) GROUP BY set_name`,
    setNames,
  );
  for (const row of result.values ?? []) counts.set(row.set_name, row.n);
  return counts;
}

export interface PrintSearchResult {
  print: CardPrint;
  card: Card;
}

/** Prints whose set_code contains the given (case-insensitive) substring, joined with
 *  their card. Powers the 型番検索 tab and the set-code camera-scan flow -- unlike name
 *  search, a set_code (e.g. "SUB1-JP001") pins down an exact print (set + rarity), not
 *  just a card, so a match here can register inventory directly without a disambiguation
 *  step. */
export async function searchPrintsBySetCode(
  conn: SQLiteDBConnection,
  query: string,
  limit = 30,
): Promise<PrintSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const result = await conn.query(
    'SELECT * FROM card_prints WHERE UPPER(set_code) LIKE UPPER(?) ORDER BY set_code LIMIT ?',
    [`%${trimmed}%`, limit],
  );
  const prints = (result.values ?? []) as CardPrint[];
  const cards = await getCardsByIds(conn, [...new Set(prints.map((p) => p.card_id))]);
  return prints
    .map((print) => ({ print, card: cards.get(print.card_id) }))
    .filter((r): r is PrintSearchResult => Boolean(r.card));
}

/** Distinct set_code values starting with the given prefix, for the 型番検索 tab's
 *  autocomplete dropdown (feature request: プルダウンで表示し入力したら候補を出す). */
export async function suggestSetCodes(
  conn: SQLiteDBConnection,
  prefix: string,
  limit = 12,
): Promise<string[]> {
  const trimmed = prefix.trim();
  if (!trimmed) return [];
  const result = await conn.query(
    'SELECT DISTINCT set_code FROM card_prints WHERE UPPER(set_code) LIKE UPPER(?) ORDER BY set_code LIMIT ?',
    [`${trimmed}%`, limit],
  );
  return (result.values ?? []).map((row) => row.set_code as string);
}

// Recognizable set-code shape printed on real cards, e.g. "SUB1-JP001", "LOB-001",
// "20AP-JP001" -- used to pull candidate codes out of noisy camera OCR text (English/digit
// recognition, not the Japanese name OCR used by matchCardsByOcrText).
const SET_CODE_PATTERN = /\b[A-Z0-9]{2,6}-[A-Z]{0,3}\d{2,4}\b/g;

export function extractSetCodeCandidates(ocrText: string): string[] {
  const cleaned = ocrText.toUpperCase().replace(/[^A-Z0-9\n -]/g, ' ');
  return [...new Set(cleaned.match(SET_CODE_PATTERN) ?? [])];
}

/** Scans OCR'd text for set-code-shaped substrings and looks each one up against
 *  card_prints. Unlike matchCardsByOcrText (card name -> possibly-ambiguous card, still
 *  needs a print/rarity picked by hand), a matched set_code pins the exact print directly,
 *  so results here can be registered into inventory with one tap. */
export async function matchPrintsByOcrText(
  conn: SQLiteDBConnection,
  ocrText: string,
  limit = 10,
): Promise<PrintSearchResult[]> {
  const candidates = extractSetCodeCandidates(ocrText);
  const seen = new Set<number>();
  const out: PrintSearchResult[] = [];
  for (const code of candidates) {
    const matches = await searchPrintsBySetCode(conn, code, limit);
    for (const m of matches) {
      if (seen.has(m.print.id)) continue;
      seen.add(m.print.id);
      out.push(m);
      if (out.length >= limit) return out;
    }
  }
  // The regex above only fires on OCR text shaped exactly like a set code (with a
  // hyphen in the right place); the stencil-style font OCG set codes use trips up
  // Tesseract's default English model often enough that the raw text rarely looks that
  // clean. Rather than give up with zero candidates, fall back to fuzzy (edit-distance)
  // matching against every known set_code so a few wrong characters still surface the
  // right print.
  if (out.length === 0) return fuzzyMatchSetCode(conn, ocrText, limit);
  return out;
}

function normalizeForCodeMatch(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Classic edit-distance DP -- number of single-character insert/delete/substitute
 *  operations to turn `a` into `b`. Single-row (not full-matrix) to keep memory flat. */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prevRow = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const currRow = [i];
    for (let j = 1; j <= b.length; j += 1) {
      currRow[j] = a[i - 1] === b[j - 1]
        ? prevRow[j - 1]
        : 1 + Math.min(prevRow[j - 1], prevRow[j], currRow[j - 1]);
    }
    prevRow = currRow;
  }
  return prevRow[b.length];
}

/** Fallback for when OCR text doesn't contain anything shaped like a real set_code (very
 *  common -- the stencil-style font OCG codes are printed in trips up Tesseract's default
 *  English model, e.g. "DBPR-JP043" misread as "EPILIT04"). Compares the OCR text against
 *  every known set_code by edit distance (punctuation/whitespace ignored on both sides) and
 *  returns the closest ones, so a handful of wrong characters still surfaces the right
 *  print instead of zero results. */
export async function fuzzyMatchSetCode(
  conn: SQLiteDBConnection,
  ocrText: string,
  limit = 10,
): Promise<PrintSearchResult[]> {
  const needle = normalizeForCodeMatch(ocrText).slice(0, 40);
  if (needle.length < 4) return [];

  const result = await conn.query('SELECT DISTINCT set_code FROM card_prints');
  const codes = (result.values ?? []).map((row) => row.set_code as string);

  const maxDistance = Math.max(3, Math.ceil(needle.length * 0.6));
  const scored = codes
    .map((code) => ({ code, dist: levenshteinDistance(needle, normalizeForCodeMatch(code)) }))
    .filter((s) => s.dist <= maxDistance)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit);

  const out: PrintSearchResult[] = [];
  const seen = new Set<number>();
  for (const { code } of scored) {
    const matches = await searchPrintsBySetCode(conn, code, limit);
    for (const m of matches) {
      if (m.print.set_code !== code || seen.has(m.print.id)) continue;
      seen.add(m.print.id);
      out.push(m);
    }
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

export interface ArtCandidate {
  card: Card;
  distance: number; // Hamming distance, 0..64 -- lower is a closer artwork match.
}

/** Matches a photographed card's illustration against every known card's reference
 *  dHash (see data-pipeline/scripts/lib/dhash.mjs / app/src/imageHash.ts) by Hamming
 *  distance. This identifies the CARD only (same as name-OCR) -- reprints of a card share
 *  its artwork and therefore its hash, so the specific print/rarity still has to be picked
 *  afterward from that card's card_prints, same as every other identification path here. */
export async function matchCardsByArtHash(
  conn: SQLiteDBConnection,
  queryHash: string,
  topN = 5,
): Promise<ArtCandidate[]> {
  // No distance cutoff here (unlike the OCR text matchers, which at least got a clean crop
  // of real text) -- a handheld photo's lighting/angle/framing can easily push even the
  // correct card's distance well past what would be a "good" match for two clean reference
  // images. Always surface the closest topN with their score and let the user's eyes make
  // the call, same as the OCR candidate lists never gate on confidence either.
  const result = await conn.query('SELECT card_id, dhash FROM card_hashes');
  const scored: { cardId: number; distance: number }[] = [];
  for (const row of result.values ?? []) {
    scored.push({ cardId: row.card_id, distance: hammingDistanceHex(queryHash, row.dhash) });
  }
  scored.sort((a, b) => a.distance - b.distance);
  const top = scored.slice(0, topN);
  const cards = await getCardsByIds(conn, top.map((t) => t.cardId));
  return top
    .map((t) => ({ card: cards.get(t.cardId), distance: t.distance }))
    .filter((r): r is ArtCandidate => Boolean(r.card));
}

export async function getSyncMeta(conn: SQLiteDBConnection): Promise<SyncMeta> {
  const result = await conn.query('SELECT key, value FROM sync_meta');
  const meta: SyncMeta = {};
  for (const row of result.values ?? []) {
    (meta as Record<string, string>)[row.key] = row.value;
  }
  return meta;
}
