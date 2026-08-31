import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { createWorker } from 'tesseract.js';
import { useDb } from '../DbContext';
import { matchCardsByOcrText, type OcrCandidate } from '../db/datasetRepo';

type Status = 'idle' | 'reading' | 'matching' | 'done' | 'error';

export default function CameraRegisterScreen() {
  const { dataset } = useDb();
  const navigate = useNavigate();
  const [photo, setPhoto] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [candidates, setCandidates] = useState<OcrCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function handleTakePhoto() {
    setError(null);
    setCandidates([]);
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
      const worker = await createWorker('jpn');
      try {
        const { data } = await worker.recognize(dataUrl);
        setStatus('matching');
        const matches = await matchCardsByOcrText(dataset, data.text);
        setCandidates(matches);
        setStatus('done');
      } finally {
        await worker.terminate();
      }
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <div className="section-title">カメラでカードを識別</div>
      <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>
        カード名の部分がはっきり写るように撮影してください。候補から選んだ後、通常どおり収録弾・レアリティを選んで在庫登録します。
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

      {status === 'done' && (
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
    </div>
  );
}
