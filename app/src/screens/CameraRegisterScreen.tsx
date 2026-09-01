import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { createWorker, PSM } from 'tesseract.js';
import { useDb } from '../DbContext';
import { matchCardsByOcrText, matchPrintsByOcrText, type OcrCandidate, type PrintSearchResult } from '../db/datasetRepo';
import { incrementInventory } from '../db/localRepo';
import { saveOcrTrainingSample } from '../ocrTraining';

type Mode = 'name' | 'code';
type Status = 'idle' | 'cropping' | 'reading' | 'matching' | 'done' | 'error';

// Fractions of the photo (0..1). 型番 is printed in tiny text along the card's bottom
// edge, usually left-aligned -- this is just a starting guess the user drags/resizes to
// fit, not a real detection.
interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
const DEFAULT_CROP: CropRect = { x: 0.05, y: 0.8, w: 0.5, h: 0.12 };
const MIN_CROP_W = 0.06;
const MIN_CROP_H = 0.02;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

// Tesseract fetches its worker script/wasm core/language data from a CDN on first use;
// on a flaky connection this can hang far longer than a user will wait, with no error --
// this turns that into a clear timeout instead of an indefinite "reading" spinner.
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

// OCG set codes are printed in light grey on the card's grey bottom border, and on
// foil/holo rarities the print surface itself has a fine embossed texture -- both add
// high-frequency noise that Tesseract's LSTM reads as extra phantom characters even when
// the actual text is crisp and correctly cropped. This grayscales, box-blurs to smooth out
// that texture noise while leaving the much larger letter strokes intact, then stretches
// contrast so the darkest/lightest pixels hit full black/white. (A global Otsu-threshold
// binarization step was tried here too, but on an unevenly lit crop it just as often
// crushed the whole image to a black blob as it helped -- Tesseract's own adaptive
// binarizer does better with a clean greyscale image than this naive global one does.)
function cleanupForOcr(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const imageData = ctx.getImageData(0, 0, width, height);
  const px = imageData.data;
  const n = width * height;

  const gray = new Float32Array(n);
  for (let i = 0, j = 0; i < px.length; i += 4, j += 1) {
    gray[j] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  }

  const blurred = new Float32Array(n);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          sum += gray[yy * width + xx];
          count += 1;
        }
      }
      blurred[y * width + x] = sum / count;
    }
  }

  let min = 255;
  let max = 0;
  for (let i = 0; i < n; i += 1) {
    if (blurred[i] < min) min = blurred[i];
    if (blurred[i] > max) max = blurred[i];
  }
  const range = Math.max(1, max - min);
  for (let i = 0, j = 0; i < px.length; i += 4, j += 1) {
    const v = ((blurred[j] - min) / range) * 255;
    px[i] = v;
    px[i + 1] = v;
    px[i + 2] = v;
  }
  ctx.putImageData(imageData, 0, 0);
}

// Straightens a photo taken with the phone rotated relative to the card -- Tesseract
// expects roughly horizontal text, and set-code text running sideways (very easy to end
// up with when leaning in close for a zoomed shot) reads as pure noise regardless of any
// other preprocessing.
async function rotateImage(dataUrl: string, degrees: 0 | 90 | 180 | 270): Promise<string> {
  if (degrees === 0) return dataUrl;
  const img = await loadImageEl(dataUrl);
  const swap = degrees === 90 || degrees === 270;
  const canvas = document.createElement('canvas');
  canvas.width = swap ? img.naturalHeight : img.naturalWidth;
  canvas.height = swap ? img.naturalWidth : img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas context取得に失敗しました');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  return canvas.toDataURL('image/jpeg', 0.92);
}

async function loadImageEl(dataUrl: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = dataUrl;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
  });
  return img;
}

// Crops the photo to `rect` and upscales it so the (otherwise tiny) set-code text is fed
// to Tesseract at a size it can actually resolve -- OCR on the whole card photo mostly
// fails because the set code is only a few pixels tall at normal photo resolution.
async function cropAndUpscale(dataUrl: string, rect: CropRect): Promise<string> {
  const img = await loadImageEl(dataUrl);
  const sx = rect.x * img.naturalWidth;
  const sy = rect.y * img.naturalHeight;
  const sw = rect.w * img.naturalWidth;
  const sh = rect.h * img.naturalHeight;
  const scale = Math.max(1, 1600 / sw);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas context取得に失敗しました');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  cleanupForOcr(ctx, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

// Same contrast preprocessing as cropAndUpscale, but on the untouched whole photo -- for
// when the user already zoomed the camera itself in on the set code, so no digital
// crop/upscale is needed (or wanted -- upscaling can't recover detail that was never
// captured in the first place).
async function preprocessWholePhoto(dataUrl: string): Promise<string> {
  const img = await loadImageEl(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas context取得に失敗しました');
  ctx.drawImage(img, 0, 0);
  cleanupForOcr(ctx, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

export default function CameraRegisterScreen() {
  const { dataset, local } = useDb();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('name');
  const [photo, setPhoto] = useState<string | null>(null);
  // photo, straightened by `rotation` -- this (not `photo`) is what's displayed, cropped,
  // and fed to OCR while in 型番 mode.
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [rotatedPhoto, setRotatedPhoto] = useState<string | null>(null);
  const [crop, setCrop] = useState<CropRect>(DEFAULT_CROP);
  const [status, setStatus] = useState<Status>('idle');
  const [candidates, setCandidates] = useState<OcrCandidate[]>([]);
  const [printCandidates, setPrintCandidates] = useState<PrintSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [registeredPrintId, setRegisteredPrintId] = useState<number | null>(null);
  // What Tesseract actually read, shown for the 型番 mode so a failed match can be
  // diagnosed (empty/garbage OCR text vs. text that just didn't hit any known set_code).
  const [debugOcrText, setDebugOcrText] = useState<string | null>(null);
  // The actual image handed to Tesseract (after crop/upscale/contrast-stretch) -- shown so
  // a bad OCR result can be told apart from "the crop/preprocessing itself is broken" vs.
  // "the crop looks right but Tesseract still can't read it".
  const [processedPreview, setProcessedPreview] = useState<string | null>(null);
  // Tesseract downloads its worker script/wasm core/language data from a CDN on first use
  // -- if that's slow or blocked, OCR silently hangs at "reading" with no other feedback,
  // so surface which stage it's actually in.
  const [ocrProgress, setOcrProgress] = useState<string | null>(null);
  const imgWrapRef = useRef<HTMLDivElement | null>(null);

  function switchMode(next: Mode) {
    setMode(next);
    setPhoto(null);
    setRotation(0);
    setRotatedPhoto(null);
    setStatus('idle');
    setCandidates([]);
    setPrintCandidates([]);
    setError(null);
    setRegisteredPrintId(null);
    setDebugOcrText(null);
    setProcessedPreview(null);
  }

  async function rotateBy(delta: 90 | -90) {
    if (!photo) return;
    const next = (((rotation + delta) % 360) + 360) % 360 as 0 | 90 | 180 | 270;
    setRotation(next);
    setCrop(DEFAULT_CROP);
    setRotatedPhoto(await rotateImage(photo, next));
  }

  async function handleTakePhoto() {
    setError(null);
    setCandidates([]);
    setPrintCandidates([]);
    setRegisteredPrintId(null);
    setDebugOcrText(null);
    setProcessedPreview(null);
    setOcrProgress(null);
    try {
      const result = await Camera.getPhoto({
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
        // Fine print (set codes) turns to mush under heavy JPEG compression -- quality
        // matters more here than file size, since the photo is only used transiently.
        quality: 92,
        allowEditing: false,
      });
      if (!result.dataUrl) return;
      setPhoto(result.dataUrl);
      if (mode === 'code') {
        // Set codes are printed too small to read from the whole-card photo directly --
        // let the user frame just that text before OCR runs on it.
        setRotation(0);
        setRotatedPhoto(result.dataUrl);
        setCrop(DEFAULT_CROP);
        setStatus('cropping');
      } else {
        setStatus('reading');
        await runNameOcr(result.dataUrl);
      }
    } catch (e) {
      // User cancelling the camera also lands here (rejected promise) -- not a real error.
      const msg = e instanceof Error ? e.message : String(e);
      if (!/cancel/i.test(msg)) setError(msg);
    }
  }

  async function runNameOcr(dataUrl: string) {
    setStatus('reading');
    try {
      const worker = await withTimeout(createWorker('jpn'), 45000, 'OCRエンジンの起動がタイムアウトしました(通信環境を確認してください)');
      try {
        const { data } = await withTimeout(worker.recognize(dataUrl), 45000, '文字認識がタイムアウトしました');
        setStatus('matching');
        setCandidates(await matchCardsByOcrText(dataset, data.text));
        setStatus('done');
      } finally {
        await worker.terminate();
      }
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function runCodeOcr(dataUrl: string, psm: PSM) {
    setStatus('reading');
    setOcrProgress('起動中...');
    try {
      const worker = await withTimeout(
        createWorker(
          'eng',
          undefined,
          { logger: (m) => setOcrProgress(`${m.status} ${Math.round(m.progress * 100)}%`) },
          // Set codes ("DBPR-JP043") aren't dictionary words, but Tesseract's LSTM engine
          // biases its output toward real English words by default -- it was reading a
          // crisp, correctly-cropped "DBPR-JP043" as things like "BUSHES"/"SERRE" because
          // those are closer to known words. Disabling every dictionary/word-list here
          // turns that bias off so it trusts the raw character shapes instead.
          {
            load_system_dawg: '0',
            load_freq_dawg: '0',
            load_punc_dawg: '0',
            load_number_dawg: '0',
            load_unambig_dawg: '0',
            load_bigram_dawg: '0',
          },
        ),
        45000,
        'OCRエンジンの起動がタイムアウトしました(通信環境を確認してください)',
      );
      try {
        await worker.setParameters({
          tessedit_pageseg_mode: psm,
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-',
        });
        const { data } = await withTimeout(worker.recognize(dataUrl), 45000, '文字認識がタイムアウトしました');
        setDebugOcrText(data.text);
        setStatus('matching');
        setPrintCandidates(await matchPrintsByOcrText(dataset, data.text));
        setStatus('done');
      } finally {
        await worker.terminate();
      }
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function confirmCrop() {
    if (!rotatedPhoto) return;
    try {
      const cropped = await cropAndUpscale(rotatedPhoto, crop);
      setProcessedPreview(cropped);
      // Now that the crop is straightened (via the rotate buttons) and tight, SINGLE_LINE
      // -- built specifically for "one line of text, nothing else" -- reads it more
      // precisely than SINGLE_BLOCK's more general layout analysis does.
      await runCodeOcr(cropped, PSM.SINGLE_LINE);
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function scanWholePhoto() {
    if (!rotatedPhoto) return;
    try {
      const preprocessed = await preprocessWholePhoto(rotatedPhoto);
      setProcessedPreview(preprocessed);
      // No crop -- text is scattered amid card art/rules text, so don't assume one line.
      await runCodeOcr(preprocessed, PSM.SPARSE_TEXT);
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function startCropDrag(e: React.PointerEvent<HTMLDivElement>, handle: 'move' | 'tl' | 'br') {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const wrap = imgWrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const start = crop;

    function onMove(ev: PointerEvent) {
      const dx = (ev.clientX - startX) / rect.width;
      const dy = (ev.clientY - startY) / rect.height;
      if (handle === 'move') {
        const x = clamp(start.x + dx, 0, 1 - start.w);
        const y = clamp(start.y + dy, 0, 1 - start.h);
        setCrop({ ...start, x, y });
      } else if (handle === 'br') {
        const w = clamp(start.w + dx, MIN_CROP_W, 1 - start.x);
        const h = clamp(start.h + dy, MIN_CROP_H, 1 - start.y);
        setCrop({ ...start, w, h });
      } else {
        const x = clamp(start.x + dx, 0, start.x + start.w - MIN_CROP_W);
        const y = clamp(start.y + dy, 0, start.y + start.h - MIN_CROP_H);
        setCrop({ x, y, w: start.w + (start.x - x), h: start.h + (start.y - y) });
      }
    }
    function onUp() {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
    }
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  }

  async function registerPrint(printId: number) {
    await incrementInventory(local, printId, 1);
    setRegisteredPrintId(printId);
    // The user just confirmed this print is the one in the photo -- whether or not the
    // OCR guess that surfaced it was actually correct, (processedPreview, set_code) is now
    // a verified-correct training pair for future model fine-tuning.
    if (processedPreview) {
      const print = printCandidates.find((p) => p.print.id === printId);
      if (print) void saveOcrTrainingSample(processedPreview, print.print.set_code);
    }
  }

  const handleStyle: React.CSSProperties = {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: '50%',
    background: 'var(--accent)',
    border: '2px solid #fff',
    touchAction: 'none',
  };

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
          : '型番はごく小さい文字なので、スマホを型番部分に近づけて(ピントを合わせて)ズームで撮影するのがおすすめです。カード全体を撮った場合は撮影後に枠で型番部分を切り出せます。型番が一致すれば収録弾・レアリティも特定できるので、候補から直接+1登録できます。'}
      </p>

      {status !== 'cropping' && (
        <button className="primary" onClick={handleTakePhoto} disabled={status === 'reading' || status === 'matching'}>
          📷 カードを撮影
        </button>
      )}

      {photo && status !== 'cropping' && (
        <img
          src={photo}
          alt="撮影したカード"
          style={{ width: '100%', borderRadius: 10, marginTop: 12, maxHeight: 240, objectFit: 'contain', background: '#000' }}
        />
      )}

      {photo && rotatedPhoto && status === 'cropping' && (
        <>
          <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>
            型番の文字が横向き・縦向きに写っている場合は、まず回転ボタンで文字が水平になるように直してください。そのあと枠を型番の文字にぴったり合わせてください(ドラッグで移動、丸で拡大縮小)。すでに型番だけをアップで撮影できている場合は、枠を調整せず「全体から読み取る」の方がきれいに読み取れます。
          </p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button type="button" className="plain" style={{ flex: 1 }} onClick={() => rotateBy(-90)}>
              ↺ 左に90°回転
            </button>
            <button type="button" className="plain" style={{ flex: 1 }} onClick={() => rotateBy(90)}>
              ↻ 右に90°回転
            </button>
          </div>
          <div ref={imgWrapRef} style={{ position: 'relative', width: '100%', marginTop: 8, lineHeight: 0 }}>
            <img src={rotatedPhoto} alt="撮影したカード" style={{ width: '100%', borderRadius: 10, display: 'block' }} />
            <div
              onPointerDown={(e) => startCropDrag(e, 'move')}
              style={{
                position: 'absolute',
                left: `${crop.x * 100}%`,
                top: `${crop.y * 100}%`,
                width: `${crop.w * 100}%`,
                height: `${crop.h * 100}%`,
                border: '2px solid var(--accent)',
                background: 'rgba(123, 63, 228, 0.15)',
                touchAction: 'none',
                boxSizing: 'border-box',
              }}
            >
              <div
                onPointerDown={(e) => startCropDrag(e, 'tl')}
                style={{ ...handleStyle, left: -11, top: -11, cursor: 'nwse-resize' }}
              />
              <div
                onPointerDown={(e) => startCropDrag(e, 'br')}
                style={{ ...handleStyle, right: -11, bottom: -11, cursor: 'nwse-resize' }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="primary" style={{ flex: 1 }} onClick={confirmCrop}>
              この範囲を読み取る
            </button>
            <button type="button" className="plain" onClick={scanWholePhoto}>
              全体から読み取る
            </button>
          </div>
          <button type="button" className="plain" style={{ marginTop: 8, width: '100%' }} onClick={handleTakePhoto}>
            撮り直す
          </button>
        </>
      )}

      {status === 'reading' && (
        <div className="empty-state">
          文字を読み取り中...
          {ocrProgress && <div style={{ fontSize: 12, marginTop: 4 }}>{ocrProgress}</div>}
        </div>
      )}
      {status === 'matching' && <div className="empty-state">候補を検索中...</div>}
      {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

      {(status === 'done' || status === 'error') && mode === 'code' && (
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
          <div>読み取り結果(デバッグ): {debugOcrText ? `"${debugOcrText}"` : '(なし)'}</div>
          {processedPreview && (
            <>
              <div style={{ marginTop: 6 }}>実際にOCRへ渡した画像:</div>
              <img
                src={processedPreview}
                alt="OCRに渡した画像"
                style={{ width: '100%', marginTop: 4, borderRadius: 6, background: '#000', imageRendering: 'pixelated' }}
              />
            </>
          )}
        </div>
      )}

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

      {(status === 'done' || status === 'error') && mode === 'code' && photo && (
        <button type="button" className="plain" style={{ width: '100%', marginBottom: 12 }} onClick={() => setStatus('cropping')}>
          型番の位置を選び直す
        </button>
      )}

      {status === 'done' && mode === 'code' && (
        <>
          <div className="section-title">候補 ({printCandidates.length})</div>
          {printCandidates.length === 0 && (
            <div className="empty-state">
              型番が読み取れませんでした。枠の位置・大きさを調整するか、検索/登録タブの型番検索から手動で探してください。
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
