import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { SQLiteDBConnection } from '@capacitor-community/sqlite';
import { getCardsByIds, getPrintsByIds } from './db/datasetRepo';
import { listInventory, listStorageLocations, listDecks, getDeckCards } from './db/localRepo';

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function writeAndShare(filename: string, content: string, title: string): Promise<void> {
  await Filesystem.writeFile({
    path: filename,
    data: content,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
  await Share.share({ title, files: [uri], dialogTitle: title });
}

/** CSV of the current inventory (card name, set, rarity, quantity, storage location). */
export async function exportInventoryCsv(
  dataset: SQLiteDBConnection,
  local: SQLiteDBConnection,
): Promise<void> {
  const inventory = await listInventory(local);
  const prints = await getPrintsByIds(dataset, inventory.map((r) => r.print_id));
  const cards = await getCardsByIds(dataset, [...prints.values()].map((p) => p.card_id));
  const locations = await listStorageLocations(local);
  const locationName = new Map(locations.map((l) => [l.id, l.name]));

  const header = ['カード名', '収録弾', '型番', 'レアリティ', '枚数', '保管場所', '更新日時'];
  const rows = inventory.map((row) => {
    const print = prints.get(row.print_id);
    const card = print ? cards.get(print.card_id) : undefined;
    return [
      card?.name_ja ?? '',
      print?.set_name ?? '',
      print?.set_code ?? '',
      print?.rarity ?? '',
      row.quantity,
      row.storage_location_id ? (locationName.get(row.storage_location_id) ?? '') : '',
      row.updated_at,
    ];
  });

  const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
  // BOM so Excel opens the UTF-8 CSV without mangling the Japanese text.
  await writeAndShare(`ocg_inventory_${Date.now()}.csv`, '﻿' + csv, '在庫をエクスポート');
}

interface BackupData {
  version: 1;
  exportedAt: string;
  storageLocations: Awaited<ReturnType<typeof listStorageLocations>>;
  inventory: Awaited<ReturnType<typeof listInventory>>;
  decks: Awaited<ReturnType<typeof listDecks>>;
  deckCards: Awaited<ReturnType<typeof getDeckCards>>;
}

/** Full local-data backup (everything except the synced read-only card dataset, which is
 *  re-downloadable) as JSON, so it can be restored later via importBackupJson. */
export async function exportFullBackupJson(local: SQLiteDBConnection): Promise<void> {
  const decks = await listDecks(local);
  const deckCards = (await Promise.all(decks.map((d) => getDeckCards(local, d.id)))).flat();

  const data: BackupData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    storageLocations: await listStorageLocations(local),
    inventory: await listInventory(local),
    decks,
    deckCards,
  };
  await writeAndShare(`ocg_backup_${Date.now()}.json`, JSON.stringify(data, null, 2), 'バックアップを保存');
}

/** Restores a JSON backup produced by exportFullBackupJson. Existing local data with the
 *  same ids is overwritten; nothing else is cleared first, so restoring is additive/safe
 *  to re-run. */
export async function importBackupJson(local: SQLiteDBConnection, jsonText: string): Promise<void> {
  const data = JSON.parse(jsonText) as BackupData;
  if (data.version !== 1) throw new Error(`unsupported backup version: ${data.version}`);

  // Use the connection's dedicated transaction methods, not raw "BEGIN"/"COMMIT" SQL --
  // .execute()/.run() each wrap themselves in their own transaction by default (a 4th
  // `transaction` param, true unless passed false), which conflicts with a manually
  // BEGUN one and throws "no current transaction". Passing false per-call here defers to
  // the explicit transaction instead.
  await local.beginTransaction();
  try {
    for (const loc of data.storageLocations) {
      await local.run(
        'INSERT OR REPLACE INTO storage_locations (id, name, sort_order) VALUES (?, ?, ?)',
        [loc.id, loc.name, loc.sort_order],
        false,
      );
    }
    for (const row of data.inventory) {
      await local.run(
        'INSERT OR REPLACE INTO inventory (id, print_id, quantity, storage_location_id, note, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [row.id, row.print_id, row.quantity, row.storage_location_id, row.note, row.updated_at],
        false,
      );
    }
    for (const deck of data.decks) {
      await local.run(
        'INSERT OR REPLACE INTO decks (id, name, created_at) VALUES (?, ?, ?)',
        [deck.id, deck.name, deck.created_at],
        false,
      );
    }
    for (const dc of data.deckCards) {
      await local.run(
        'INSERT OR REPLACE INTO deck_cards (deck_id, card_id, quantity) VALUES (?, ?, ?)',
        [dc.deck_id, dc.card_id, dc.quantity],
        false,
      );
    }
    await local.commitTransaction();
  } catch (e) {
    await local.rollbackTransaction();
    throw e;
  }
}
