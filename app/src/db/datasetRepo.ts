import type { SQLiteDBConnection } from '@capacitor-community/sqlite';
import { normalizeForSearch } from './normalize';
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
}

export async function searchCards(
  conn: SQLiteDBConnection,
  filters: SearchFilters,
  limit = 100,
): Promise<Card[]> {
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

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await conn.query(
    `SELECT * FROM cards ${where} ORDER BY name_ja_normalized LIMIT ?`,
    [...params, limit],
  );
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

export async function getSyncMeta(conn: SQLiteDBConnection): Promise<SyncMeta> {
  const result = await conn.query('SELECT key, value FROM sync_meta');
  const meta: SyncMeta = {};
  for (const row of result.values ?? []) {
    (meta as Record<string, string>)[row.key] = row.value;
  }
  return meta;
}
