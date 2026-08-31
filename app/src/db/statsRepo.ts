import type { SQLiteDBConnection } from '@capacitor-community/sqlite';
import { getPrintCountsBySetNames, getPrintsByIds } from './datasetRepo';
import { listInventory } from './localRepo';

export interface SetProgress {
  setName: string;
  owned: number;
  total: number;
}

export interface RarityCount {
  rarity: string;
  owned: number;
}

export interface CollectionStats {
  totalCopies: number;
  totalDistinctPrints: number;
  bySet: SetProgress[];
  byRarity: RarityCount[];
}

export async function computeCollectionStats(
  dataset: SQLiteDBConnection,
  local: SQLiteDBConnection,
): Promise<CollectionStats> {
  const inventory = await listInventory(local);
  if (inventory.length === 0) {
    return { totalCopies: 0, totalDistinctPrints: 0, bySet: [], byRarity: [] };
  }

  const prints = await getPrintsByIds(dataset, inventory.map((r) => r.print_id));

  const totalCopies = inventory.reduce((sum, r) => sum + r.quantity, 0);
  const totalDistinctPrints = inventory.length;

  const ownedBySet = new Map<string, number>();
  const ownedByRarity = new Map<string, number>();
  for (const row of inventory) {
    const print = prints.get(row.print_id);
    if (!print) continue;
    ownedBySet.set(print.set_name, (ownedBySet.get(print.set_name) ?? 0) + 1);
    ownedByRarity.set(print.rarity, (ownedByRarity.get(print.rarity) ?? 0) + 1);
  }

  const totalBySet = await getPrintCountsBySetNames(dataset, [...ownedBySet.keys()]);

  const bySet: SetProgress[] = [...ownedBySet.entries()]
    .map(([setName, owned]) => ({ setName, owned, total: totalBySet.get(setName) ?? owned }))
    .sort((a, b) => b.owned / b.total - a.owned / a.total);

  const byRarity: RarityCount[] = [...ownedByRarity.entries()]
    .map(([rarity, owned]) => ({ rarity, owned }))
    .sort((a, b) => b.owned - a.owned);

  return { totalCopies, totalDistinctPrints, bySet, byRarity };
}
