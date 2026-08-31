import { useEffect, useState } from 'react';
import { useDb } from '../DbContext';
import { getSyncMeta } from '../db/datasetRepo';
import { openDataset, getDatasetUrl } from '../db/sqlite';
import type { SyncMeta } from '../db/types';

export default function SettingsScreen() {
  const { dataset } = useDb();
  const [meta, setMeta] = useState<SyncMeta>({});
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setMeta(await getSyncMeta(dataset));
  }

  useEffect(() => {
    reload();
  }, [dataset]);

  async function handleResync() {
    setSyncing(true);
    setError(null);
    try {
      await openDataset(true);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div>
      <div className="section-title">カードデータセット</div>
      <div className="list-row">
        <span>ビルド日時</span>
        <span>{meta.built_at ? new Date(meta.built_at).toLocaleString('ja-JP') : '-'}</span>
      </div>
      <div className="list-row">
        <span>BabelCDB</span>
        <span style={{ fontSize: 11 }}>{meta.babelcdb_commit?.slice(0, 8) ?? '-'}</span>
      </div>
      <div className="list-row">
        <span>JAテキスト</span>
        <span style={{ fontSize: 11 }}>{meta.ja_source_commit?.slice(0, 8) ?? '-'}</span>
      </div>

      <button className="primary" style={{ marginTop: 16 }} onClick={handleResync} disabled={syncing}>
        {syncing ? '同期中...' : '最新データを再取得'}
      </button>
      {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

      <div className="section-title">配信元</div>
      <p style={{ fontSize: 12, color: 'var(--text-dim)', wordBreak: 'break-all' }}>{getDatasetUrl()}</p>
    </div>
  );
}
