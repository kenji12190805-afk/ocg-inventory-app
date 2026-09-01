import type { SQLiteDBConnection } from '@capacitor-community/sqlite';
import { normalizeForSearch } from './normalize';
import { SPELL_SUBTYPE_BITS, TRAP_SUBTYPE_BITS } from '../gameConstants';
import type { Card, CardPrint, SyncMeta } from './types';

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

export async function getPrint(conn: SQLiteDBConnection, printId: number): Promise<CardPrint | null> {
  const result = await conn.query('SELECT * FROM card_prints WHERE id = ?', [printId]);
  return (result.values?.[0] as CardPrint) ?? null;
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
  const haystack = normalizeForSearch(ocrText).slice(0, 500);
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

export async function getSyncMeta(conn: SQLiteDBConnection): Promise<SyncMeta> {
  const result = await conn.query('SELECT key, value FROM sync_meta');
  const meta: SyncMeta = {};
  for (const row of result.values ?? []) {
    (meta as Record<string, string>)[row.key] = row.value;
  }
  return meta;
}
