// Difference hash (dHash): resize to 9x8 greyscale, compare each pixel to its right
// neighbour row-wise -> 64 bits, returned as 16 hex chars. Deliberately simple (no DCT/
// frequency-domain stuff) so the exact same algorithm can be re-implemented client-side
// with just a <canvas>, no image library -- the app has to compute a hash from a phone
// photo of a card and compare it against these reference hashes with the same method, or
// the two hash spaces won't line up. Matches card ARTWORK, not print/rarity -- reprints of
// the same card under a different set code share the same illustration and hash.
import sharp from "sharp";

const W = 9;
const H = 8;

export async function dHashFromBuffer(buffer) {
  const { data } = await sharp(buffer)
    .resize(W, H, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let bits = 0n;
  let bitIndex = 0n;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W - 1; x++) {
      const left = data[y * W + x];
      const right = data[y * W + x + 1];
      if (left > right) bits |= 1n << bitIndex;
      bitIndex++;
    }
  }
  return bits.toString(16).padStart(16, "0");
}

export function hammingDistanceHex(aHex, bHex) {
  let a = BigInt(`0x${aHex}`);
  let b = BigInt(`0x${bHex}`);
  let x = a ^ b;
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}
