import type { SQLiteDBConnection } from '@capacitor-community/sqlite';
import type { Deck, DeckCard, InventoryRow, PriceLogEntry, StorageLocation } from './types';

export async function listStorageLocations(conn: SQLiteDBConnection): Promise<StorageLocation[]> {
  const result = await conn.query('SELECT * FROM storage_locations ORDER BY sort_order, name');
  return (result.values ?? []) as StorageLocation[];
}

export async function addStorageLocation(conn: SQLiteDBConnection, name: string): Promise<number> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('storage location name is empty');
  const existing = await conn.query('SELECT id FROM storage_locations WHERE name = ?', [trimmed]);
  if (existing.values?.length) return existing.values[0].id;

  const maxRow = await conn.query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM storage_locations');
  const nextOrder = maxRow.values?.[0]?.next ?? 0;
  await conn.run('INSERT INTO storage_locations (name, sort_order) VALUES (?, ?)', [trimmed, nextOrder]);
  const inserted = await conn.query('SELECT id FROM storage_locations WHERE name = ?', [trimmed]);
  return inserted.values![0].id;
}

export async function renameStorageLocation(
  conn: SQLiteDBConnection,
  id: number,
  name: string,
): Promise<void> {
  await conn.run('UPDATE storage_locations SET name = ? WHERE id = ?', [name.trim(), id]);
}

export async function deleteStorageLocation(conn: SQLiteDBConnection, id: number): Promise<void> {
  await conn.run('DELETE FROM storage_locations WHERE id = ?', [id]);
}

export async function getInventoryForPrints(
  conn: SQLiteDBConnection,
  printIds: number[],
): Promise<Map<number, InventoryRow>> {
  const map = new Map<number, InventoryRow>();
  if (printIds.length === 0) return map;
  const placeholders = printIds.map(() => '?').join(',');
  const result = await conn.query(
    `SELECT * FROM inventory WHERE print_id IN (${placeholders})`,
    printIds,
  );
  for (const row of (result.values ?? []) as InventoryRow[]) {
    map.set(row.print_id, row);
  }
  return map;
}

export async function listInventory(conn: SQLiteDBConnection): Promise<InventoryRow[]> {
  const result = await conn.query('SELECT * FROM inventory WHERE quantity > 0 ORDER BY updated_at DESC');
  return (result.values ?? []) as InventoryRow[];
}

/** +1 (or +delta) to a print's owned quantity; creates the inventory row if it doesn't exist yet. */
export async function incrementInventory(
  conn: SQLiteDBConnection,
  printId: number,
  delta: number,
  storageLocationId: number | null = null,
): Promise<void> {
  const now = new Date().toISOString();
  await conn.run(
    `INSERT INTO inventory (print_id, quantity, storage_location_id, updated_at)
     VALUES (?, MAX(0, ?), ?, ?)
     ON CONFLICT(print_id) DO UPDATE SET
       quantity = MAX(0, quantity + ?),
       storage_location_id = COALESCE(?, storage_location_id),
       updated_at = ?`,
    [printId, delta, storageLocationId, now, delta, storageLocationId, now],
  );
}

export async function setInventoryQuantity(
  conn: SQLiteDBConnection,
  printId: number,
  quantity: number,
): Promise<void> {
  const now = new Date().toISOString();
  await conn.run(
    `INSERT INTO inventory (print_id, quantity, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(print_id) DO UPDATE SET quantity = ?, updated_at = ?`,
    [printId, Math.max(0, quantity), now, Math.max(0, quantity), now],
  );
}

export async function setInventoryStorageLocation(
  conn: SQLiteDBConnection,
  printId: number,
  storageLocationId: number | null,
): Promise<void> {
  await conn.run('UPDATE inventory SET storage_location_id = ? WHERE print_id = ?', [
    storageLocationId,
    printId,
  ]);
}

// ---- price log (user-observed real-world JP prices, see app-local-schema.sql) ----

export async function getPriceLogForPrints(
  conn: SQLiteDBConnection,
  printIds: number[],
): Promise<Map<number, PriceLogEntry[]>> {
  const map = new Map<number, PriceLogEntry[]>();
  if (printIds.length === 0) return map;
  const placeholders = printIds.map(() => '?').join(',');
  const result = await conn.query(
    `SELECT * FROM price_log WHERE print_id IN (${placeholders}) ORDER BY observed_at DESC`,
    printIds,
  );
  for (const row of (result.values ?? []) as PriceLogEntry[]) {
    const list = map.get(row.print_id) ?? [];
    list.push(row);
    map.set(row.print_id, list);
  }
  return map;
}

export async function addPriceLogEntry(
  conn: SQLiteDBConnection,
  printId: number,
  priceJpy: number,
  source: string,
  note: string,
): Promise<void> {
  await conn.run(
    'INSERT INTO price_log (print_id, price_jpy, source, note, observed_at) VALUES (?, ?, ?, ?, ?)',
    [printId, Math.max(0, Math.round(priceJpy)), source.trim(), note.trim(), new Date().toISOString()],
  );
}

export async function deletePriceLogEntry(conn: SQLiteDBConnection, id: number): Promise<void> {
  await conn.run('DELETE FROM price_log WHERE id = ?', [id]);
}

// ---- decks ----

export async function listDecks(conn: SQLiteDBConnection): Promise<Deck[]> {
  const result = await conn.query('SELECT * FROM decks ORDER BY created_at DESC');
  return (result.values ?? []) as Deck[];
}

export async function createDeck(
  conn: SQLiteDBConnection,
  name: string,
  cards: { cardId: number; quantity: number }[],
): Promise<number> {
  const now = new Date().toISOString();
  const result = await conn.run('INSERT INTO decks (name, created_at) VALUES (?, ?)', [name.trim() || '無題のデッキ', now]);
  const deckId = result.changes!.lastId!;
  for (const c of cards) {
    await conn.run('INSERT OR REPLACE INTO deck_cards (deck_id, card_id, quantity) VALUES (?, ?, ?)', [
      deckId,
      c.cardId,
      Math.min(3, Math.max(1, c.quantity)),
    ]);
  }
  return deckId;
}

export async function deleteDeck(conn: SQLiteDBConnection, deckId: number): Promise<void> {
  await conn.run('DELETE FROM decks WHERE id = ?', [deckId]);
}

export async function getDeck(conn: SQLiteDBConnection, deckId: number): Promise<Deck | null> {
  const result = await conn.query('SELECT * FROM decks WHERE id = ?', [deckId]);
  return (result.values?.[0] as Deck) ?? null;
}

export async function getDeckCards(conn: SQLiteDBConnection, deckId: number): Promise<DeckCard[]> {
  const result = await conn.query('SELECT * FROM deck_cards WHERE deck_id = ? ORDER BY card_id', [deckId]);
  return (result.values ?? []) as DeckCard[];
}

export async function setDeckCardQuantity(
  conn: SQLiteDBConnection,
  deckId: number,
  cardId: number,
  quantity: number,
): Promise<void> {
  if (quantity <= 0) {
    await conn.run('DELETE FROM deck_cards WHERE deck_id = ? AND card_id = ?', [deckId, cardId]);
  } else {
    await conn.run('INSERT OR REPLACE INTO deck_cards (deck_id, card_id, quantity) VALUES (?, ?, ?)', [
      deckId,
      cardId,
      Math.min(3, quantity),
    ]);
  }
}

/** Total owned copies of a card, summed across every print (set+rarity) of it. */
export async function getOwnedCountByCardIds(
  conn: SQLiteDBConnection,
  printIdsByCard: Map<number, number[]>,
): Promise<Map<number, number>> {
  const allPrintIds = [...printIdsByCard.values()].flat();
  const owned = new Map<number, number>();
  if (allPrintIds.length === 0) return owned;
  const inventory = await getInventoryForPrints(conn, allPrintIds);
  for (const [cardId, printIds] of printIdsByCard) {
    const total = printIds.reduce((sum, pid) => sum + (inventory.get(pid)?.quantity ?? 0), 0);
    owned.set(cardId, total);
  }
  return owned;
}
