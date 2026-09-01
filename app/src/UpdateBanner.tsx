import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDb } from './DbContext';
import { checkForDatasetUpdate } from './updateCheck';

export default function UpdateBanner() {
  const { dataset, refreshDataset } = useDb();
  const [available, setAvailable] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [justSynced, setJustSynced] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkForDatasetUpdate(dataset).then((r) => setAvailable(r.available));
  }, [dataset]);

  async function handleSync() {
    setSyncing(true);
    setError(null);
    try {
      await refreshDataset();
      setAvailable(false);
      setJustSynced(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

  if (!justSynced && (!available || dismissed)) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '8px 16px',
        background: '#fff3d6',
        borderBottom: '1px solid var(--border)',
        fontSize: 13,
      }}
    >
      {justSynced ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span>同期が完了しました</span>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <Link to="/changelog" className="plain" onClick={() => setJustSynced(false)}>
              新着カードを見る
            </Link>
            <button className="plain" onClick={() => setJustSynced(false)}>
              閉じる
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span>新しいカードデータがあります</span>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button className="plain" onClick={handleSync} disabled={syncing}>
              {syncing ? '同期中...' : '今すぐ同期'}
            </button>
            <button className="plain" onClick={() => setDismissed(true)}>
              後で
            </button>
          </div>
        </div>
      )}
      {error && <span style={{ color: 'var(--danger)' }}>{error}</span>}
    </div>
  );
}
