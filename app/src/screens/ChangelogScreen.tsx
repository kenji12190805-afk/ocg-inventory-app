import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchChangelog, type Changelog } from '../changelogCheck';
import { cardTypeLabel } from '../gameConstants';

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('ja-JP');
}

export default function ChangelogScreen() {
  const [data, setData] = useState<Changelog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchChangelog()
      .then((c) => {
        if (!cancelled) setData(c);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <Link to="/settings" className="badge" style={{ display: 'inline-block', marginBottom: 8 }}>
        ← 設定に戻る
      </Link>
      <h2 style={{ margin: '4px 0' }}>新着カード</h2>

      {loading && <div className="empty-state">読み込み中...</div>}
      {error && <div className="empty-state">取得に失敗しました。{error}</div>}

      {data && (
        <>
          <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            前回の同期({formatDate(data.previousBuiltAt)})から今回({formatDate(data.builtAt)})までの差分
          </p>

          <div className="section-title">新しく追加された収録弾 ({data.newSets.length})</div>
          {data.newSets.length === 0 && <div className="empty-state">今回追加された収録弾はありません</div>}
          {data.newSets.map((s) => (
            <div key={s.setName} className="list-row">
              <span>{s.setName}</span>
              <span className="qty-value">{s.cardCount}枚</span>
            </div>
          ))}

          <div className="section-title">新しく追加されたカード ({data.newCardCount})</div>
          {data.newCards.length === 0 && <div className="empty-state">今回追加されたカードはありません</div>}
          {data.newCards.map((c) => (
            <Link key={c.id} to={`/card/${c.id}`} className="card-list-item">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="name">{c.nameJa}</div>
                <div className="meta">{cardTypeLabel(c.cardType)}</div>
              </div>
            </Link>
          ))}
          {data.newCardCount > data.newCards.length && (
            <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              他 {data.newCardCount - data.newCards.length} 枚(先頭 {data.newCards.length} 件のみ表示)
            </p>
          )}
        </>
      )}
    </div>
  );
}
