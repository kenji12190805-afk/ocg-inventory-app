import { useEffect, useState } from 'react';
import { useDb } from './DbContext';
import { checkForDatasetUpdate } from './updateCheck';

export default function UpdateBanner() {
  const { dataset, refreshDataset } = useDb();
  const [available, setAvailable] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkForDatasetUpdate(dataset).then((r) => setAvailable(r.available));
  }, [dataset]);

  if (!available || dismissed) return null;

  async function handleSync() {
    setSyncing(true);
    setError(null);
    try {
      await refreshDataset();
      setAvailable(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

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
      {error && <span style={{ color: 'var(--danger)' }}>{error}</span>}
    </div>
  );
}
