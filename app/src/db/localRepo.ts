import type { SQLiteDBConnection } from '@capacitor-community/sqlite';
import type { InventoryRow, StorageLocation } from './types';

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
