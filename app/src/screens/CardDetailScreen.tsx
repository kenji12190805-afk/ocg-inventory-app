import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useDb } from '../DbContext';
import { getCard, getCardPrice, getPrintsForCard } from '../db/datasetRepo';
import {
  addPriceLogEntry,
  getInventoryForPrints,
  getPriceLogForPrints,
  incrementInventory,
  listStorageLocations,
  setInventoryStorageLocation,
} from '../db/localRepo';
import type { Card, CardPrice, CardPrint, InventoryRow, PriceLogEntry, StorageLocation } from '../db/types';
import { cardTypeLabel } from '../gameConstants';

const PRICE_SOURCES = ['メルカリ', '駿河屋', 'ヤフオク', 'カードショップ', 'その他'];

export default function CardDetailScreen() {
  const { cardId } = useParams();
  const navigate = useNavigate();
  const { dataset, local } = useDb();
  const [card, setCard] = useState<Card | null>(null);
  const [prints, setPrints] = useState<CardPrint[]>([]);
  const [inventory, setInventory] = useState<Map<number, InventoryRow>>(new Map());
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [cardPrice, setCardPrice] = useState<CardPrice | null>(null);
  const [priceLog, setPriceLog] = useState<Map<number, PriceLogEntry[]>>(new Map());
  const [priceFormPrintId, setPriceFormPrintId] = useState<number | null>(null);
  const [priceInput, setPriceInput] = useState('');
  const [sourceInput, setSourceInput] = useState(PRICE_SOURCES[0]);
  const [noteInput, setNoteInput] = useState('');

  const reload = useCallback(async () => {
    const id = Number(cardId);
    const [c, p, locs, price] = await Promise.all([
      getCard(dataset, id),
      getPrintsForCard(dataset, id),
      listStorageLocations(local),
      getCardPrice(dataset, id),
    ]);
    setCard(c);
    setPrints(p);
    setLocations(locs);
    setCardPrice(price);
    setInventory(await getInventoryForPrints(local, p.map((x) => x.id)));
    setPriceLog(await getPriceLogForPrints(local, p.map((x) => x.id)));
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

  function openPriceForm(printId: number) {
    setPriceFormPrintId(printId);
    setPriceInput('');
    setSourceInput(PRICE_SOURCES[0]);
    setNoteInput('');
  }

  async function submitPriceLog(printId: number) {
    const price = Number(priceInput);
    if (!Number.isFinite(price) || price <= 0) return;
    await addPriceLogEntry(local, printId, price, sourceInput, noteInput);
    setPriceFormPrintId(null);
    setPriceLog(await getPriceLogForPrints(local, prints.map((x) => x.id)));
  }

  if (!card) return <div className="empty-state">読み込み中...</div>;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button
          type="button"
          className="badge"
          style={{ fontFamily: 'inherit', cursor: 'pointer' }}
          onClick={() => navigate(-1)}
        >
          ‹ 1つ前に戻る
        </button>
        <Link to="/" className="badge" style={{ display: 'inline-block' }}>
          ← 検索に戻る
        </Link>
      </div>
      <h2 style={{ margin: '4px 0' }}>{card.name_ja}</h2>
      <div className="meta">
        {cardTypeLabel(card.card_type)}
        {card.card_type & 1 ? ` / ATK ${card.atk} DEF ${card.def} / Lv${card.level}` : ''}
      </div>
      <p style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.6 }}>{card.desc_ja}</p>

      {cardPrice &&
        (cardPrice.cardmarket_eur != null || cardPrice.tcgplayer_usd != null) && (
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-dim)',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: 8,
              marginBottom: 12,
            }}
          >
            <div style={{ fontWeight: 'bold', color: 'var(--text)' }}>海外参考価格(TCG)</div>
            <div style={{ marginTop: 2 }}>
              日本のOCG相場とは印刷枚数・禁止制限リストが異なるため一致しません。あくまで目安です。
            </div>
            <div style={{ marginTop: 4 }}>
              {cardPrice.cardmarket_eur != null && `Cardmarket: €${cardPrice.cardmarket_eur.toFixed(2)}`}
              {cardPrice.cardmarket_eur != null && cardPrice.tcgplayer_usd != null && ' / '}
              {cardPrice.tcgplayer_usd != null && `TCGplayer: $${cardPrice.tcgplayer_usd.toFixed(2)}`}
            </div>
          </div>
        )}

      <div className="section-title">収録弾・レアリティ ({prints.length})</div>
      {prints.length === 0 && (
        <div className="empty-state">収録弾データがまだありません(Yugipedia未マッチの可能性)</div>
      )}
      {prints.map((p) => {
        const inv = inventory.get(p.id);
        const qty = inv?.quantity ?? 0;
        const log = priceLog.get(p.id) ?? [];
        const latest = log[0];
        return (
          <div key={p.id}>
            <div className="print-row">
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

            <div style={{ fontSize: 12, padding: '2px 4px 10px', color: 'var(--text-dim)' }}>
              {latest ? (
                <span>
                  相場メモ: ¥{latest.price_jpy.toLocaleString()} ({latest.source || '出典不明'} /{' '}
                  {latest.observed_at.slice(0, 10)}){log.length > 1 && ` 他${log.length - 1}件`}
                </span>
              ) : (
                <span>相場メモ: まだ記録がありません</span>
              )}{' '}
              <button
                type="button"
                className="plain"
                style={{ fontSize: 12, padding: '2px 8px' }}
                onClick={() => (priceFormPrintId === p.id ? setPriceFormPrintId(null) : openPriceForm(p.id))}
              >
                {priceFormPrintId === p.id ? '閉じる' : '＋記録'}
              </button>

              {priceFormPrintId === p.id && (
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <input
                    type="number"
                    inputMode="numeric"
                    placeholder="価格(円)"
                    value={priceInput}
                    onChange={(e) => setPriceInput(e.target.value)}
                    style={{ fontSize: 14 }}
                  />
                  <select value={sourceInput} onChange={(e) => setSourceInput(e.target.value)} style={{ fontSize: 14 }}>
                    {PRICE_SOURCES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="メモ(状態など、任意)"
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    style={{ fontSize: 14 }}
                  />
                  <button
                    type="button"
                    className="primary"
                    style={{ fontSize: 13 }}
                    onClick={() => submitPriceLog(p.id)}
                    disabled={!priceInput || Number(priceInput) <= 0}
                  >
                    記録する
                  </button>
                  {log.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      {log.map((entry) => (
                        <div key={entry.id}>
                          ¥{entry.price_jpy.toLocaleString()} ({entry.source || '出典不明'} /{' '}
                          {entry.observed_at.slice(0, 10)}){entry.note && ` -- ${entry.note}`}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
