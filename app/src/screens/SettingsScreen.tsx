import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDb } from '../DbContext';
import { getSyncMeta } from '../db/datasetRepo';
import { getDatasetUrl } from '../db/sqlite';
import { exportInventoryCsv, exportFullBackupJson, importBackupJson } from '../backup';
import { getOcrTrainingStats, type OcrTrainingStats } from '../ocrTraining';
import type { SyncMeta } from '../db/types';

export default function SettingsScreen() {
  const { dataset, local, refreshDataset } = useDb();
  const [meta, setMeta] = useState<SyncMeta>({});
  const [ocrStats, setOcrStats] = useState<OcrTrainingStats | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function reload() {
    setMeta(await getSyncMeta(dataset));
    setOcrStats(await getOcrTrainingStats());
  }

  useEffect(() => {
    reload();
  }, [dataset]);

  async function handleResync() {
    setSyncing(true);
    setError(null);
    try {
      await refreshDataset();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

  async function withBusy(label: string, fn: () => Promise<void>) {
    setBusyAction(label);
    setError(null);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // The OS share sheet rejects its promise when the user backs out without picking an
      // app -- that's a normal cancel, not a failure worth surfacing as an error.
      if (!/cancel/i.test(msg)) setError(msg);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleImportFile(file: File) {
    await withBusy('restore', async () => {
      const text = await file.text();
      await importBackupJson(local, text);
      setMessage('バックアップから復元しました');
    });
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
      <div style={{ marginTop: 8 }}>
        <Link to="/changelog">
          <button className="plain">前回の同期で追加されたカードを見る</button>
        </Link>
      </div>

      <div className="section-title">コレクション統計</div>
      <Link to="/stats">
        <button className="plain">統計を見る</button>
      </Link>

      <div className="section-title">型番OCR学習状況</div>
      <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
        カメラの型番モードで「+1登録」するたびに、読み取った画像と確定した型番のペアが端末内に自動保存されます(外部送信なし)。ある程度溜まったら、それを使ってOCRモデルを改善します。
      </p>
      <div className="list-row">
        <span>保存済みサンプル数</span>
        <span>{ocrStats ? `${ocrStats.totalSamples}件` : '-'}</span>
      </div>
      <div className="list-row">
        <span>カバーしている型番の種類</span>
        <span>{ocrStats ? `${ocrStats.uniqueSetCodes}種類` : '-'}</span>
      </div>
      <div className="list-row">
        <span>最終保存</span>
        <span>{ocrStats?.lastSavedAt ? new Date(ocrStats.lastSavedAt).toLocaleString('ja-JP') : '-'}</span>
      </div>

      <div className="section-title">エクスポート/バックアップ</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
        <button
          className="plain"
          onClick={() => withBusy('csv', () => exportInventoryCsv(dataset, local))}
          disabled={busyAction !== null}
        >
          {busyAction === 'csv' ? '出力中...' : '在庫をCSVでエクスポート'}
        </button>
        <button
          className="plain"
          onClick={() => withBusy('backup', () => exportFullBackupJson(local))}
          disabled={busyAction !== null}
        >
          {busyAction === 'backup' ? '出力中...' : '全データをバックアップ(JSON)'}
        </button>
        <button
          className="plain"
          onClick={() => fileInputRef.current?.click()}
          disabled={busyAction !== null}
        >
          {busyAction === 'restore' ? '復元中...' : 'バックアップから復元'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) handleImportFile(file);
          }}
        />
      </div>
      {message && <p style={{ fontSize: 13, color: 'var(--accent)' }}>{message}</p>}
      {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

      <div className="section-title">配信元</div>
      <p style={{ fontSize: 12, color: 'var(--text-dim)', wordBreak: 'break-all' }}>{getDatasetUrl()}</p>
    </div>
  );
}
