import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDb } from '../DbContext';
import { listInventory, setInventoryQuantity } from '../db/localRepo';
import { getCard, getPrint } from '../db/datasetRepo';
import { normalizeForSearch } from '../db/normalize';
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
  const [query, setQuery] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  async function reload(signal?: { cancelled: boolean }) {
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
    if (signal?.cancelled) return;
    setRows(joined);
    setLocations(locs);
    setLoading(false);
  }

  useEffect(() => {
    const signal = { cancelled: false };
    reload(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [dataset, local]);

  const locationName = (id: number | null) => locations.find((l) => l.id === id)?.name ?? '未設定';

  function toggleSelected(invId: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(invId)) next.delete(invId);
      else next.add(invId);
      return next;
    });
  }

  function exitSelecting() {
    setSelecting(false);
    setSelectedIds(new Set());
  }

  async function deleteSelected() {
    if (selectedIds.size === 0) return;
    if (!confirm(`選択した${selectedIds.size}件の在庫を削除しますか？`)) return;
    const targets = rows.filter((r) => selectedIds.has(r.inv.id));
    for (const r of targets) {
      await setInventoryQuantity(local, r.inv.print_id, 0);
    }
    exitSelecting();
    await reload();
  }

  if (loading) return <div className="empty-state">読み込み中...</div>;
  if (rows.length === 0) return <div className="empty-state">まだ在庫が登録されていません</div>;

  const normalizedQuery = normalizeForSearch(query.trim());
  const filteredRows = normalizedQuery
    ? rows.filter((r) => normalizeForSearch(r.card.name_ja).includes(normalizedQuery))
    : rows;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          type="search"
          placeholder="在庫内をカード名で検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1 }}
        />
        <button type="button" className="plain" style={{ flexShrink: 0 }} onClick={() => (selecting ? exitSelecting() : setSelecting(true))}>
          {selecting ? 'キャンセル' : '選択'}
        </button>
      </div>

      {selecting && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <button
            type="button"
            className="plain"
            onClick={() =>
              setSelectedIds((prev) =>
                prev.size === filteredRows.length ? new Set() : new Set(filteredRows.map((r) => r.inv.id)),
              )
            }
          >
            {selectedIds.size === filteredRows.length && filteredRows.length > 0 ? 'すべて解除' : 'すべて選択'}
          </button>
          <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>{selectedIds.size}件選択中</span>
          <button
            type="button"
            className="plain"
            style={{ marginLeft: 'auto', color: 'var(--danger)', borderColor: 'var(--danger)' }}
            onClick={deleteSelected}
            disabled={selectedIds.size === 0}
          >
            削除
          </button>
        </div>
      )}

      <div className="section-title">在庫一覧 ({filteredRows.length}件)</div>
      {filteredRows.length === 0 && <div className="empty-state">該当する在庫がありません</div>}
      {filteredRows.map(({ inv, print, card }) => {
        const rowContent = (
          <>
            {selecting && (
              <input
                type="checkbox"
                checked={selectedIds.has(inv.id)}
                onChange={() => toggleSelected(inv.id)}
                onClick={(e) => e.stopPropagation()}
                style={{ width: 18, height: 18, flexShrink: 0 }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="name">{card.name_ja}</div>
              <div className="meta">
                {print.set_code} / {print.rarity} ・ {locationName(inv.storage_location_id)}
              </div>
            </div>
            <div className="qty-value">×{inv.quantity}</div>
          </>
        );
        return selecting ? (
          <div key={inv.id} className="card-list-item" onClick={() => toggleSelected(inv.id)}>
            {rowContent}
          </div>
        ) : (
          <Link key={inv.id} to={`/card/${card.id}`} className="card-list-item">
            {rowContent}
          </Link>
        );
      })}
    </div>
  );
}
