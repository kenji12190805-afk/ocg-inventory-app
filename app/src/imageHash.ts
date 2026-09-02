// Client-side counterpart to data-pipeline/scripts/lib/dhash.mjs -- MUST stay bit-for-bit
// the same algorithm (9x8 greyscale difference hash) as the pipeline, or a photo's hash
// and the reference hashes synced from card_hashes simply won't be comparable.
const W = 9;
const H = 8;

export async function computeDHash(dataUrl: string, rect?: { x: number; y: number; w: number; h: number }): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
  });

  const sx = rect ? rect.x * img.naturalWidth : 0;
  const sy = rect ? rect.y * img.naturalHeight : 0;
  const sw = rect ? rect.w * img.naturalWidth : img.naturalWidth;
  const sh = rect ? rect.h * img.naturalHeight : img.naturalHeight;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas context取得に失敗しました');
  // Deliberately stretch to WxH ignoring aspect ratio -- matches sharp's `fit: "fill"` on
  // the pipeline side.
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
  const { data } = ctx.getImageData(0, 0, W, H);

  const gray: number[] = [];
  for (let i = 0; i < W * H; i += 1) {
    const o = i * 4;
    gray.push(0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]);
  }

  let bits = 0n;
  let bitIndex = 0n;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W - 1; x += 1) {
      const left = gray[y * W + x];
      const right = gray[y * W + x + 1];
      if (left > right) bits |= 1n << bitIndex;
      bitIndex += 1n;
    }
  }
  return bits.toString(16).padStart(16, '0');
}

export function hammingDistanceHex(aHex: string, bHex: string): number {
  let x = BigInt(`0x${aHex}`) ^ BigInt(`0x${bHex}`);
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}
