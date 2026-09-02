import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

// Every synthetic-font model we've tried reads real card photos badly -- the actual fix is
// a fine-tune on real photos, not more synthetic data. Rather than build that dataset by
// hand, we collect it for free as a side effect of normal use: whenever the user confirms
// a print from a 型番 OCR scan (by tapping +1登録), the image that was actually fed to
// Tesseract and the set_code they just confirmed make a perfect (image, label) training
// pair -- true regardless of whether that scan's OCR guess was right or wrong. Everything
// here stays on-device; nothing is uploaded anywhere.
const SAMPLES_DIR = 'ocr_training_samples';
const MANIFEST_PATH = `${SAMPLES_DIR}/labels.jsonl`;

let dirReady: Promise<void> | null = null;

async function ensureDir(): Promise<void> {
  if (!dirReady) {
    dirReady = Filesystem.mkdir({ path: SAMPLES_DIR, directory: Directory.Data, recursive: true }).catch(() => {
      // Already exists -- mkdir on an existing dir rejects, which is fine here.
    });
  }
  await dirReady;
}

/** Saves one (processed OCR input image, confirmed-correct set_code) pair to local
 *  storage. `imageDataUrl` is the same PNG data URL that was actually handed to Tesseract
 *  (post crop/rotate/contrast-cleanup), so the sample matches what the model needs to get
 *  right. Best-effort: a save failure here should never block registering the card. */
export async function saveOcrTrainingSample(imageDataUrl: string, setCode: string): Promise<void> {
  try {
    await ensureDir();
    const base64 = imageDataUrl.slice(imageDataUrl.indexOf(',') + 1);
    const ts = Date.now();
    const safeCode = setCode.replace(/[^A-Za-z0-9-]/g, '_');
    const imagePath = `${SAMPLES_DIR}/${ts}_${safeCode}.png`;
    await Filesystem.writeFile({ path: imagePath, data: base64, directory: Directory.Data });
    const line = `${JSON.stringify({ file: imagePath.slice(SAMPLES_DIR.length + 1), label: setCode, ts })}\n`;
    await Filesystem.appendFile({ path: MANIFEST_PATH, data: line, directory: Directory.Data, encoding: Encoding.UTF8 });
  } catch (e) {
    console.error('failed to save OCR training sample', e);
  }
}

export interface OcrTrainingStats {
  totalSamples: number;
  uniqueSetCodes: number;
  lastSavedAt: string | null;
}

/** Reads back the manifest saveOcrTrainingSample has been appending to, purely so the
 *  Settings screen can show the user something concrete ("N samples saved") instead of
 *  the collection happening invisibly in the background. */
export async function getOcrTrainingStats(): Promise<OcrTrainingStats> {
  try {
    const { data } = await Filesystem.readFile({ path: MANIFEST_PATH, directory: Directory.Data, encoding: Encoding.UTF8 });
    const text = typeof data === 'string' ? data : await data.text();
    const labels = new Set<string>();
    let count = 0;
    let lastTs = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as { label: string; ts: number };
        count += 1;
        labels.add(row.label);
        if (row.ts > lastTs) lastTs = row.ts;
      } catch {
        // Skip a malformed line rather than failing the whole stats read.
      }
    }
    return {
      totalSamples: count,
      uniqueSetCodes: labels.size,
      lastSavedAt: lastTs ? new Date(lastTs).toISOString() : null,
    };
  } catch {
    // No manifest yet -- nothing saved so far, not an error.
    return { totalSamples: 0, uniqueSetCodes: 0, lastSavedAt: null };
  }
}
