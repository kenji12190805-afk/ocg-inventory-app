import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { createWorker } from 'tesseract.js';
import { useDb } from '../DbContext';
import { matchCardsByOcrText, matchPrintsByOcrText, type OcrCandidate, type PrintSearchResult } from '../db/datasetRepo';
import { incrementInventory } from '../db/localRepo';

type Mode = 'name' | 'code';
type Status = 'idle' | 'reading' | 'matching' | 'done' | 'error';

export default function CameraRegisterScreen() {
  const { dataset, local } = useDb();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('name');
  const [photo, setPhoto] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [candidates, setCandidates] = useState<OcrCandidate[]>([]);
  const [printCandidates, setPrintCandidates] = useState<PrintSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [registeredPrintId, setRegisteredPrintId] = useState<number | null>(null);

  function switchMode(next: Mode) {
    setMode(next);
    setPhoto(null);
    setStatus('idle');
    setCandidates([]);
    setPrintCandidates([]);
    setError(null);
    setRegisteredPrintId(null);
  }

  async function handleTakePhoto() {
    setError(null);
    setCandidates([]);
    setPrintCandidates([]);
    setRegisteredPrintId(null);
    try {
      const result = await Camera.getPhoto({
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
        quality: 70,
        allowEditing: false,
      });
      if (!result.dataUrl) return;
      setPhoto(result.dataUrl);
      await runOcr(result.dataUrl);
    } catch (e) {
      // User cancelling the camera also lands here (rejected promise) -- not a real error.
      const msg = e instanceof Error ? e.message : String(e);
      if (!/cancel/i.test(msg)) setError(msg);
    }
  }

  async function runOcr(dataUrl: string) {
    setStatus('reading');
    try {
      // Card names are Japanese; set codes (型番, e.g. "SUB1-JP001") are printed in plain
      // Latin/digits -- the 'eng' model reads that far more reliably than 'jpn' does.
      const worker = await createWorker(mode === 'name' ? 'jpn' : 'eng');
      try {
        const { data } = await worker.recognize(dataUrl);
        setStatus('matching');
        if (mode === 'name') {
          setCandidates(await matchCardsByOcrText(dataset, data.text));
        } else {
          setPrintCandidates(await matchPrintsByOcrText(dataset, data.text));
        }
        setStatus('done');
      } finally {
        await worker.terminate();
      }
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function registerPrint(printId: number) {
    await incrementInventory(local, printId, 1);
    setRegisteredPrintId(printId);
  }

  return (
    <div>
      <div className="section-title">カメラでカードを識別</div>

      <div className="chip-row">
        <div className={`chip${mode === 'name' ? ' selected' : ''}`} onClick={() => switchMode('name')}>
          カード名で識別
        </div>
        <div className={`chip${mode === 'code' ? ' selected' : ''}`} onClick={() => switchMode('code')}>
          型番で識別
        </div>
      </div>

      <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>
        {mode === 'name'
          ? 'カード名の部分がはっきり写るように撮影してください。候補から選んだ後、通常どおり収録弾・レアリティを選んで在庫登録します。'
          : 'カード左下(または右下)の型番(例: SUB1-JP001)がはっきり写るように撮影してください。型番が一致すれば収録弾・レアリティも特定できるので、候補から直接+1登録できます。'}
      </p>

      <button className="primary" onClick={handleTakePhoto} disabled={status === 'reading' || status === 'matching'}>
        📷 カードを撮影
      </button>

      {photo && (
        <img
          src={photo}
          alt="撮影したカード"
          style={{ width: '100%', borderRadius: 10, marginTop: 12, maxHeight: 240, objectFit: 'contain', background: '#000' }}
        />
      )}

      {status === 'reading' && <div className="empty-state">文字を読み取り中...</div>}
      {status === 'matching' && <div className="empty-state">候補を検索中...</div>}
      {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

      {status === 'done' && mode === 'name' && (
        <>
          <div className="section-title">候補 ({candidates.length})</div>
          {candidates.length === 0 && (
            <div className="empty-state">
              候補が見つかりませんでした。検索/登録タブから手動で探してください。
            </div>
          )}
          {candidates.map(({ card }) => (
            <div key={card.id} className="card-list-item" onClick={() => navigate(`/card/${card.id}`)}>
              <div className="name">{card.name_ja}</div>
            </div>
          ))}
        </>
      )}

      {status === 'done' && mode === 'code' && (
        <>
          <div className="section-title">候補 ({printCandidates.length})</div>
          {printCandidates.length === 0 && (
            <div className="empty-state">
              型番が読み取れませんでした。検索/登録タブの型番検索から手動で探してください。
            </div>
          )}
          {printCandidates.map(({ print, card }) => (
            <div key={print.id} className="print-row">
              <div className="info" style={{ cursor: 'pointer' }} onClick={() => navigate(`/card/${card.id}`)}>
                <div className="name">{card.name_ja}</div>
                <div className="set-code">{print.set_code}</div>
                <div className="rarity">
                  {print.set_name} / {print.rarity}
                </div>
              </div>
              <button
                className="primary"
                style={{ flexShrink: 0 }}
                onClick={() => registerPrint(print.id)}
                disabled={registeredPrintId === print.id}
              >
                {registeredPrintId === print.id ? '登録済み' : '＋1登録'}
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
