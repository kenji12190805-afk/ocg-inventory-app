import type { SQLiteDBConnection } from '@capacitor-community/sqlite';
import { findCardByExactName } from './datasetRepo';
import type { Card } from './types';

const HEADER_KEYWORDS = ['メインデッキ', 'エクストラデッキ', 'サイドデッキ', 'main deck', 'extra deck', 'side deck', 'monster', 'spell', 'trap'];

// "3 カード名" / "3x カード名" / "3× カード名"
const LEADING_QTY = /^([1-9])\s*[x×*]?\s+(.+)$/;
// "カード名 x3" / "カード名×3" / "カード名*3" / "カード名 3"
const TRAILING_QTY = /^(.+?)\s*[x×*]\s*([1-9])$|^(.+?)\s+([1-9])$/;

function stripLine(raw: string): { name: string; quantity: number | null } {
  let line = raw.trim();
  line = line.replace(/^[-・*]\s*/, ''); // leading bullet markers
  if (!line) return { name: '', quantity: null };

  const leading = line.match(LEADING_QTY);
  if (leading) return { name: leading[2].trim(), quantity: Number(leading[1]) };

  const trailing = line.match(TRAILING_QTY);
  if (trailing) {
    const name = (trailing[1] ?? trailing[3]).trim();
    const qty = Number(trailing[2] ?? trailing[4]);
    if (name) return { name, quantity: qty };
  }

  return { name: line, quantity: null };
}

export interface DeckImportResult {
  matched: { card: Card; quantity: number }[];
  unmatched: string[];
}

/** Parses a pasted deck list (one card per line, optionally "3 x" / "x3" prefix/suffix, or
 *  the same name repeated on separate lines to indicate copies) and resolves each name
 *  against the synced card dataset. Lines that look like section headers are skipped. */
export async function importDeckText(conn: SQLiteDBConnection, text: string): Promise<DeckImportResult> {
  const counts = new Map<string, number>(); // display name -> accumulated quantity
  const cache = new Map<string, Card | null>();

  for (const rawLine of text.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (/^\d+$/.test(trimmed)) continue; // bare count line (e.g. deck total)
    if (HEADER_KEYWORDS.some((kw) => trimmed.toLowerCase() === kw.toLowerCase())) continue;

    const { name, quantity } = stripLine(trimmed);
    if (!name) continue;

    counts.set(name, (counts.get(name) ?? 0) + (quantity ?? 1));
  }

  const matched: { card: Card; quantity: number }[] = [];
  const unmatched: string[] = [];

  for (const [name, quantity] of counts) {
    if (!cache.has(name)) {
      cache.set(name, await findCardByExactName(conn, name));
    }
    const card = cache.get(name)!;
    if (card) {
      matched.push({ card, quantity: Math.min(3, quantity) });
    } else {
      unmatched.push(name);
    }
  }

  return { matched, unmatched };
}
