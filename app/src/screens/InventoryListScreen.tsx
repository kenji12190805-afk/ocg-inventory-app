import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDb } from '../DbContext';
import { listInventory } from '../db/localRepo';
import { getCard, getPrint } from '../db/datasetRepo';
import type { Card, CardPrint, InventoryRow, StorageLocation } from '../db/types';
import { listStorageLocations } from '../db/localRepo';

interface Row {
  inv: InventoryRow;
  print: CardPrint;
  card: Card;
}

export default function InventoryListScreen() {
  const { dataset, local } = useDb();
  const [rows, setRows] = useState<Row[]>([]);
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const invRows = await listInventory(local);
      const locs = await listStorageLocations(local);
      const joined: Row[] = [];
      for (const inv of invRows) {
        const print = await getPrint(dataset, inv.print_id);
        if (!print) continue;
        const card = await getCard(dataset, print.card_id);
        if (!card) continue;
        joined.push({ inv, print, card });
      }
      if (!cancelled) {
        setRows(joined);
        setLocations(locs);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dataset, local]);

  const locationName = (id: number | null) => locations.find((l) => l.id === id)?.name ?? '未設定';

  if (loading) return <div className="empty-state">読み込み中...</div>;
  if (rows.length === 0) return <div className="empty-state">まだ在庫が登録されていません</div>;

  return (
    <div>
      <div className="section-title">在庫一覧 ({rows.length}件)</div>
      {rows.map(({ inv, print, card }) => (
        <Link key={inv.id} to={`/card/${card.id}`} className="card-list-item">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="name">{card.name_ja}</div>
            <div className="meta">
              {print.set_code} / {print.rarity} ・ {locationName(inv.storage_location_id)}
            </div>
          </div>
          <div className="qty-value">×{inv.quantity}</div>
        </Link>
      ))}
    </div>
  );
}
