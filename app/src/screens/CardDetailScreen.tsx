import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useDb } from '../DbContext';
import { getCard, getPrintsForCard } from '../db/datasetRepo';
import {
  getInventoryForPrints,
  incrementInventory,
  listStorageLocations,
  setInventoryStorageLocation,
} from '../db/localRepo';
import type { Card, CardPrint, InventoryRow, StorageLocation } from '../db/types';
import { cardTypeLabel } from '../gameConstants';

export default function CardDetailScreen() {
  const { cardId } = useParams();
  const { dataset, local } = useDb();
  const [card, setCard] = useState<Card | null>(null);
  const [prints, setPrints] = useState<CardPrint[]>([]);
  const [inventory, setInventory] = useState<Map<number, InventoryRow>>(new Map());
  const [locations, setLocations] = useState<StorageLocation[]>([]);

  const reload = useCallback(async () => {
    const id = Number(cardId);
    const [c, p, locs] = await Promise.all([
      getCard(dataset, id),
      getPrintsForCard(dataset, id),
      listStorageLocations(local),
    ]);
    setCard(c);
    setPrints(p);
    setLocations(locs);
    setInventory(await getInventoryForPrints(local, p.map((x) => x.id)));
  }, [cardId, dataset, local]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function changeQty(printId: number, delta: number) {
    await incrementInventory(local, printId, delta);
    setInventory(await getInventoryForPrints(local, prints.map((x) => x.id)));
  }

  async function changeLocation(printId: number, locationId: number | null) {
    await setInventoryStorageLocation(local, printId, locationId);
    setInventory(await getInventoryForPrints(local, prints.map((x) => x.id)));
  }

  if (!card) return <div className="empty-state">読み込み中...</div>;

  return (
    <div>
      <Link to="/" className="badge" style={{ display: 'inline-block', marginBottom: 8 }}>
        ← 検索に戻る
      </Link>
      <h2 style={{ margin: '4px 0' }}>{card.name_ja}</h2>
      <div className="meta">
        {cardTypeLabel(card.card_type)}
        {card.card_type & 1 ? ` / ATK ${card.atk} DEF ${card.def} / Lv${card.level}` : ''}
      </div>
      <p style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.6 }}>{card.desc_ja}</p>

      <div className="section-title">収録弾・レアリティ ({prints.length})</div>
      {prints.length === 0 && (
        <div className="empty-state">収録弾データがまだありません(Yugipedia未マッチの可能性)</div>
      )}
      {prints.map((p) => {
        const inv = inventory.get(p.id);
        const qty = inv?.quantity ?? 0;
        return (
          <div key={p.id} className="print-row">
            <div className="info">
              <div className="set-code">{p.set_code}</div>
              <div className="rarity">
                {p.set_name} / {p.rarity}
              </div>
              <select
                value={inv?.storage_location_id ?? ''}
                onChange={(e) => changeLocation(p.id, e.target.value ? Number(e.target.value) : null)}
                style={{ marginTop: 4, fontSize: 12 }}
              >
                <option value="">保管場所未設定</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="qty-controls">
              <button className="qty-btn" onClick={() => changeQty(p.id, -1)} disabled={qty === 0}>
                −
              </button>
              <span className="qty-value">{qty}</span>
              <button className="qty-btn" onClick={() => changeQty(p.id, 1)}>
                ＋
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
