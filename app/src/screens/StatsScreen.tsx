import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDb } from '../DbContext';
import { computeCollectionStats, type CollectionStats } from '../db/statsRepo';

export default function StatsScreen() {
  const { dataset, local } = useDb();
  const [stats, setStats] = useState<CollectionStats | null>(null);

  useEffect(() => {
    computeCollectionStats(dataset, local).then(setStats);
  }, [dataset, local]);

  if (!stats) return <div className="empty-state">集計中...</div>;

  return (
    <div>
      <Link to="/settings" className="badge" style={{ display: 'inline-block', marginBottom: 8 }}>
        ← 設定に戻る
      </Link>
      <div className="section-title">コレクション統計</div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div className="print-row" style={{ flex: 1, flexDirection: 'column', alignItems: 'flex-start' }}>
          <span className="rarity">総所持枚数</span>
          <span style={{ fontSize: 28, fontWeight: 700 }}>{stats.totalCopies}</span>
        </div>
        <div className="print-row" style={{ flex: 1, flexDirection: 'column', alignItems: 'flex-start' }}>
          <span className="rarity">収集済み(弾+レアリティ違い)</span>
          <span style={{ fontSize: 28, fontWeight: 700 }}>{stats.totalDistinctPrints}</span>
        </div>
      </div>

      {stats.totalDistinctPrints === 0 && (
        <div className="empty-state">在庫を登録すると統計が表示されます</div>
      )}

      {stats.bySet.length > 0 && (
        <>
          <div className="section-title">弾ごとの収集率</div>
          {stats.bySet.map((s) => {
            const pct = Math.round((s.owned / s.total) * 100);
            return (
              <div key={s.setName} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span>{s.setName}</span>
                  <span>
                    {s.owned} / {s.total} ({pct}%)
                  </span>
                </div>
                <div style={{ height: 6, background: 'var(--bg)', borderRadius: 3, overflow: 'hidden', marginTop: 3 }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent)' }} />
                </div>
              </div>
            );
          })}
        </>
      )}

      {stats.byRarity.length > 0 && (
        <>
          <div className="section-title">レアリティ別内訳</div>
          {stats.byRarity.map((r) => (
            <div key={r.rarity} className="list-row">
              <span>{r.rarity || '(不明)'}</span>
              <span>{r.owned}種</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
