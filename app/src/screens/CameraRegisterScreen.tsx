import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { createWorker, PSM } from 'tesseract.js';
import { useDb } from '../DbContext';
import {
  matchCardsByOcrText,
  matchPrintsByOcrText,
  searchCards,
  searchPrintsBySetCode,
  suggestSetCodes,
  type OcrCandidate,
  type PrintSearchResult,
} from '../db/datasetRepo';
import { incrementInventory } from '../db/localRepo';
import { saveOcrTrainingSample } from '../ocrTraining';
import type { Card } from '../db/types';

type Status = 'idle' | 'cropping' | 'reading' | 'done' | 'error';

// Fractions of the photo (0..1) -- just starting guesses the user drags/resizes to fit,
// not a real detection. Card name sits in the title bar near the top; the set code is
// printed tiny along the bottom edge (position varies a bit by card type -- pendulum cards
// push it down near ATK/DEF -- so this is a reasonable default, not exact for every card).
interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
const NAME_DEFAULT_CROP: CropRect = { x: 0.08, y: 0.055, w: 0.68, h: 0.09 };
const CODE_DEFAULT_CROP: CropRect = { x: 0.05, y: 0.8, w: 0.5, h: 0.12 };
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
// expects roughly horizontal text, and text running sideways (very easy to end up with
// when leaning in close for a zoomed shot) reads as pure noise regardless of any other
// preprocessing.
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

// Crops the photo to `rect` and upscales it so the (otherwise tiny) text is fed to
// Tesseract at a size it can actually resolve -- OCR on the whole card photo mostly fails
// because both the name and especially the set code are only a few pixels tall at normal
// photo resolution.
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

export default function CameraRegisterScreen() {
  const { dataset, local } = useDb();
  const navigate = useNavigate();
  const [photo, setPhoto] = useState<string | null>(null);
  // photo, straightened by `rotation` -- this (not `photo`) is what's displayed and cropped.
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [rotatedPhoto, setRotatedPhoto] = useState<string | null>(null);
  const [nameCrop, setNameCrop] = useState<CropRect>(NAME_DEFAULT_CROP);
  const [codeCrop, setCodeCrop] = useState<CropRect>(CODE_DEFAULT_CROP);
  const [status, setStatus] = useState<Status>('idle');
  const [candidates, setCandidates] = useState<OcrCandidate[]>([]);
  const [printCandidates, setPrintCandidates] = useState<PrintSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [registeredPrintId, setRegisteredPrintId] = useState<number | null>(null);
  // What each OCR pass actually read, and the exact (cropped/cleaned) image it read it
  // from -- shown so a failed match can be diagnosed (empty/garbage OCR text vs. text that
  // just didn't hit anything known) instead of just "it didn't work".
  const [nameDebugText, setNameDebugText] = useState<string | null>(null);
  const [nameProcessedPreview, setNameProcessedPreview] = useState<string | null>(null);
  const [codeDebugText, setCodeDebugText] = useState<string | null>(null);
  const [codeProcessedPreview, setCodeProcessedPreview] = useState<string | null>(null);
  // Tesseract downloads its worker script/wasm core/language data from a CDN on first use
  // -- if that's slow or blocked, OCR silently hangs at "reading" with no other feedback,
  // so surface which stage it's actually in.
  const [ocrProgress, setOcrProgress] = useState<string | null>(null);
  // Manual correction: lets the user register the right print even when OCR found
  // nothing/the wrong thing, AND still ties the (processedPreview, confirmed set_code)
  // pair into the training-sample pipeline -- every scan becomes useful, not just the ones
  // OCR happened to get right.
  const [manualCode, setManualCode] = useState('');
  const [manualSuggestions, setManualSuggestions] = useState<string[]>([]);
  const [showManualSuggestions, setShowManualSuggestions] = useState(false);
  const [manualResults, setManualResults] = useState<PrintSearchResult[]>([]);
  const [manualLoading, setManualLoading] = useState(false);
  // Same idea for the card-name side: OCR misses shouldn't be a dead end.
  const [nameQuery, setNameQuery] = useState('');
  const [nameResults, setNameResults] = useState<Card[]>([]);
  const [nameSearchLoading, setNameSearchLoading] = useState(false);
  const imgWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (status !== 'done' || !manualCode.trim()) {
      setManualSuggestions([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      suggestSetCodes(dataset, manualCode.trim()).then((s) => {
        if (!cancelled) setManualSuggestions(s);
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [dataset, status, manualCode]);

  useEffect(() => {
    if (status !== 'done' || manualCode.trim().length < 2) {
      setManualResults([]);
      return;
    }
    let cancelled = false;
    setManualLoading(true);
    const handle = setTimeout(() => {
      searchPrintsBySetCode(dataset, manualCode.trim())
        .then((r) => {
          if (!cancelled) setManualResults(r);
        })
        .finally(() => {
          if (!cancelled) setManualLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [dataset, status, manualCode]);

  useEffect(() => {
    if (status !== 'done' || !nameQuery.trim()) {
      setNameResults([]);
      return;
    }
    let cancelled = false;
    setNameSearchLoading(true);
    const handle = setTimeout(() => {
      searchCards(dataset, { text: nameQuery })
        .then((r) => {
          if (!cancelled) setNameResults(r);
        })
        .finally(() => {
          if (!cancelled) setNameSearchLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [dataset, status, nameQuery]);

  function resetResults() {
    setError(null);
    setCandidates([]);
    setPrintCandidates([]);
    setRegisteredPrintId(null);
    setNameDebugText(null);
    setNameProcessedPreview(null);
    setCodeDebugText(null);
    setCodeProcessedPreview(null);
    setOcrProgress(null);
    setManualCode('');
    setManualResults([]);
    setNameQuery('');
    setNameResults([]);
  }

  async function rotateBy(delta: 90 | -90) {
    if (!photo) return;
    const next = (((rotation + delta) % 360) + 360) % 360 as 0 | 90 | 180 | 270;
    setRotation(next);
    setNameCrop(NAME_DEFAULT_CROP);
    setCodeCrop(CODE_DEFAULT_CROP);
    setRotatedPhoto(await rotateImage(photo, next));
  }

  async function handleTakePhoto() {
    resetResults();
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
      setRotation(0);
      setRotatedPhoto(result.dataUrl);
      setNameCrop(NAME_DEFAULT_CROP);
      setCodeCrop(CODE_DEFAULT_CROP);
      setStatus('cropping');
    } catch (e) {
      // User cancelling the camera also lands here (rejected promise) -- not a real error.
      const msg = e instanceof Error ? e.message : String(e);
      if (!/cancel/i.test(msg)) setError(msg);
    }
  }

  async function runBothOcr() {
    if (!rotatedPhoto) return;
    setStatus('reading');
    try {
      setOcrProgress('カード名を切り出し中...');
      const nameCropped = await cropAndUpscale(rotatedPhoto, nameCrop);
      setNameProcessedPreview(nameCropped);
      setOcrProgress('カード名を認識中...');
      const nameWorker = await withTimeout(
        createWorker('jpn'),
        45000,
        'OCRエンジンの起動がタイムアウトしました(通信環境を確認してください)',
      );
      try {
        const { data } = await withTimeout(nameWorker.recognize(nameCropped), 45000, '文字認識がタイムアウトしました');
        setNameDebugText(data.text);
        setCandidates(await matchCardsByOcrText(dataset, data.text));
      } finally {
        await nameWorker.terminate();
      }

      setOcrProgress('型番を切り出し中...');
      const codeCropped = await cropAndUpscale(rotatedPhoto, codeCrop);
      setCodeProcessedPreview(codeCropped);
      setOcrProgress('型番を認識中...');
      const codeWorker = await withTimeout(
        createWorker(
          'eng',
          undefined,
          { logger: (m) => setOcrProgress(`型番を認識中... (${m.status} ${Math.round(m.progress * 100)}%)`) },
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
        await codeWorker.setParameters({
          // SINGLE_LINE demands a near-perfectly horizontal baseline and returns nothing
          // at all for a handheld photo's inevitable slight tilt -- this unified flow no
          // longer has a separate "already know it's dead straight" crop step, so
          // SINGLE_BLOCK's tolerance for a bit of tilt is the safer default here.
          tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-',
        });
        const { data } = await withTimeout(codeWorker.recognize(codeCropped), 45000, '文字認識がタイムアウトしました');
        setCodeDebugText(data.text);
        setPrintCandidates(await matchPrintsByOcrText(dataset, data.text));
      } finally {
        await codeWorker.terminate();
      }

      setStatus('done');
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function startCropDrag(
    e: React.PointerEvent<HTMLDivElement>,
    handle: 'move' | 'tl' | 'br',
    crop: CropRect,
    setCrop: (r: CropRect) => void,
  ) {
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

  function goToCard(card: Card) {
    // Opening a card's detail page from an identification candidate is the closest thing
    // to a confirmation click we get on this side (there's no separate "register" step for
    // the name search) -- treat it as one, same spirit as the print +1登録 capture below.
    if (nameProcessedPreview) void saveOcrTrainingSample(nameProcessedPreview, card.name_ja);
    navigate(`/card/${card.id}`);
  }

  async function registerPrint(printId: number) {
    await incrementInventory(local, printId, 1);
    setRegisteredPrintId(printId);
    // The user just confirmed this print is the one in the photo -- whether or not the
    // OCR guess that surfaced it was actually correct, (processedPreview, set_code) is now
    // a verified-correct training pair for future model fine-tuning.
    if (codeProcessedPreview) {
      const print = printCandidates.find((p) => p.print.id === printId);
      if (print) void saveOcrTrainingSample(codeProcessedPreview, print.print.set_code);
    }
  }

  async function registerManualPrint(printId: number, setCode: string) {
    await incrementInventory(local, printId, 1);
    setRegisteredPrintId(printId);
    // Same training-sample capture as registerPrint, but for the manual-correction path --
    // this is what turns an OCR *miss* into useful data instead of nothing at all.
    if (codeProcessedPreview) void saveOcrTrainingSample(codeProcessedPreview, setCode);
  }

  const handleStyle: React.CSSProperties = {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: '50%',
    border: '2px solid #fff',
    touchAction: 'none',
  };

  function cropBox(crop: CropRect, setCrop: (r: CropRect) => void, color: string, label: string) {
    return (
      <div
        onPointerDown={(e) => startCropDrag(e, 'move', crop, setCrop)}
        style={{
          position: 'absolute',
          left: `${crop.x * 100}%`,
          top: `${crop.y * 100}%`,
          width: `${crop.w * 100}%`,
          height: `${crop.h * 100}%`,
          border: `2px solid ${color}`,
          background: `${color}26`,
          touchAction: 'none',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: -20,
            left: 0,
            fontSize: 11,
            color,
            background: 'var(--surface)',
            padding: '1px 4px',
            borderRadius: 4,
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </div>
        <div
          onPointerDown={(e) => startCropDrag(e, 'tl', crop, setCrop)}
          style={{ ...handleStyle, left: -11, top: -11, cursor: 'nwse-resize', background: color }}
        />
        <div
          onPointerDown={(e) => startCropDrag(e, 'br', crop, setCrop)}
          style={{ ...handleStyle, right: -11, bottom: -11, cursor: 'nwse-resize', background: color }}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="section-title">カメラでカードを識別</div>

      <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>
        カード全体を1枚撮影すると、カード名と型番を同時に認識します。それぞれの枠を文字にぴったり合わせるほど精度が上がります。
      </p>

      {status !== 'cropping' && (
        <button className="primary" onClick={handleTakePhoto} disabled={status === 'reading'}>
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
            カードが横向き・逆さまに写っている場合は、まず回転ボタンで直してください。そのあと紫の枠をカード名に、オレンジの枠を型番にそれぞれ合わせてください(ドラッグで移動、丸で拡大縮小)。
          </p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button type="button" className="plain" style={{ flex: 1 }} onClick={() => rotateBy(-90)}>
              ↺ 左に90°回転
            </button>
            <button type="button" className="plain" style={{ flex: 1 }} onClick={() => rotateBy(90)}>
              ↻ 右に90°回転
            </button>
          </div>
          <div ref={imgWrapRef} style={{ position: 'relative', width: '100%', marginTop: 20, lineHeight: 0 }}>
            <img src={rotatedPhoto} alt="撮影したカード" style={{ width: '100%', borderRadius: 10, display: 'block' }} />
            {cropBox(nameCrop, setNameCrop, 'var(--accent)', 'カード名')}
            {cropBox(codeCrop, setCodeCrop, '#e08a2e', '型番')}
          </div>
          <button className="primary" style={{ width: '100%', marginTop: 12 }} onClick={runBothOcr}>
            認識する
          </button>
          <button type="button" className="plain" style={{ marginTop: 8, width: '100%' }} onClick={handleTakePhoto}>
            撮り直す
          </button>
        </>
      )}

      {status === 'reading' && (
        <div className="empty-state">
          {ocrProgress ?? '読み取り中...'}
        </div>
      )}
      {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

      {(status === 'done' || status === 'error') && photo && (
        <button type="button" className="plain" style={{ width: '100%', marginBottom: 12 }} onClick={() => setStatus('cropping')}>
          枠を選び直す
        </button>
      )}

      {(status === 'done' || status === 'error') && (
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
          <div>カード名の読み取り結果(デバッグ): {nameDebugText ? `"${nameDebugText}"` : '(なし)'}</div>
          <div style={{ marginTop: 6 }}>型番の読み取り結果(デバッグ): {codeDebugText ? `"${codeDebugText}"` : '(なし)'}</div>
          {codeProcessedPreview && (
            <>
              <div style={{ marginTop: 6 }}>実際にOCRへ渡した型番の画像:</div>
              <img
                src={codeProcessedPreview}
                alt="OCRに渡した型番画像"
                style={{ width: '100%', marginTop: 4, borderRadius: 6, background: '#000', imageRendering: 'pixelated' }}
              />
            </>
          )}
        </div>
      )}

      {status === 'done' && (
        <>
          <div className="section-title">カード名候補 ({candidates.length})</div>
          {candidates.length === 0 && (
            <div className="empty-state">
              候補が見つかりませんでした。下でカード名を検索してください。
            </div>
          )}
          {candidates.map(({ card }) => (
            <div key={card.id} className="card-list-item" onClick={() => goToCard(card)}>
              <div className="name">{card.name_ja}</div>
            </div>
          ))}

          <div className="section-title">候補になければカード名で検索</div>
          <input
            type="search"
            placeholder="カード名を入力"
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            style={{ width: '100%' }}
          />
          {nameSearchLoading && <div className="empty-state">検索中...</div>}
          {nameResults.map((card) => (
            <div key={card.id} className="card-list-item" onClick={() => goToCard(card)}>
              <div className="name">{card.name_ja}</div>
            </div>
          ))}
        </>
      )}

      {status === 'done' && (
        <>
          <div className="section-title">型番候補 ({printCandidates.length})</div>
          {printCandidates.length === 0 && (
            <div className="empty-state">
              型番が読み取れませんでした。枠の位置・大きさを調整するか、下で型番を入力してください。
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

          <div className="section-title">候補になければ型番を入力</div>
          <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            ここで確定した型番は、今撮影した画像と一緒に学習データとしても保存されます。
          </p>
          <div style={{ position: 'relative' }}>
            <input
              type="search"
              placeholder="型番を入力 (例: SUB1-JP001)"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              onFocus={() => setShowManualSuggestions(true)}
              onBlur={() => setTimeout(() => setShowManualSuggestions(false), 150)}
              style={{ textTransform: 'uppercase', width: '100%' }}
            />
            {showManualSuggestions && manualSuggestions.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  zIndex: 10,
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  marginTop: 4,
                  maxHeight: 200,
                  overflowY: 'auto',
                }}
              >
                {manualSuggestions.map((code) => (
                  <div
                    key={code}
                    style={{ padding: '8px 12px', fontSize: 14, cursor: 'pointer' }}
                    onMouseDown={() => {
                      setManualCode(code);
                      setShowManualSuggestions(false);
                    }}
                  >
                    {code}
                  </div>
                ))}
              </div>
            )}
          </div>
          {manualLoading && <div className="empty-state">検索中...</div>}
          {manualResults.map(({ print, card }) => (
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
                onClick={() => registerManualPrint(print.id, print.set_code)}
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
