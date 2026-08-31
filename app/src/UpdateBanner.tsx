import { useEffect, useState } from 'react';
import { useDb } from './DbContext';
import { checkForDatasetUpdate } from './updateCheck';
import { openDataset } from './db/sqlite';

export default function UpdateBanner() {
  const { dataset } = useDb();
  const [available, setAvailable] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    checkForDatasetUpdate(dataset).then((r) => setAvailable(r.available));
  }, [dataset]);

  if (!available || dismissed) return null;

  async function handleSync() {
    setSyncing(true);
    try {
      await openDataset(true);
      window.location.reload();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: '8px 16px',
        background: '#fff3d6',
        borderBottom: '1px solid var(--border)',
        fontSize: 13,
      }}
    >
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
  );
}
