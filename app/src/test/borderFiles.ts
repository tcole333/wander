// Border steps and preview chunks as the borders stage writes them (streaming.md 3.3), raw before
// gzip, for Vitest (which gzips with zlib) and the borders probe (with CompressionStream): the
// bytes each plane codes a distance as, a step field from a function of its texels, and a chunk
// from its previews, each after the first stored as its difference from the one before.
import constants from '@shared/constants.json' with { type: 'json' };

/** Rounds half away from zero, as the build does. */
const rha = (x: number) => Math.sign(x) * Math.floor(Math.abs(x) + 0.5);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** R: an outer distance in texels. */
export function outerByte(d: number): number {
  return Math.min(255, rha(128 + 16 * clamp(d, -8, 8)));
}

/** G: an inner distance in texels, or none in reach, and the soft bit. */
export function innerByte(d: number | null, soft = false): number {
  const q = d === null ? 127 : Math.min(127, rha(64 + 8 * clamp(d, -8, 7.875)));
  return q | (soft ? 128 : 0);
}

/** A preview texel: an outer distance in preview texels and the soft bit. */
export function previewByte(d: number, soft = false): number {
  return (Math.min(127, rha(64 + 8 * clamp(d, -8, 7.875))) << 1) | (soft ? 1 : 0);
}

/**
 * A WBF2 step of `size`² texels a face: `texel` writes each texel's R and G into `out` at `at`,
 * face by face, row 0 the smallest t, or every texel takes the same R and G.
 */
export function stepFile(
  year: number,
  texel:
    ((face: number, i: number, j: number, out: Uint8Array, at: number) => void) | [number, number],
  { size = 1024, faces = 6, channels = 2, version = constants.formats.borderStep.version } = {},
): Uint8Array {
  const bytes = new Uint8Array(16 + faces * size * size * channels);
  const view = new DataView(bytes.buffer);
  bytes.set([...constants.formats.borderStep.magic].map((c) => c.charCodeAt(0)));
  view.setUint8(4, version);
  view.setUint8(5, faces);
  view.setUint16(6, size, true);
  view.setUint16(8, 4, true);
  view.setInt16(10, year, true);
  view.setUint8(12, channels);
  if (Array.isArray(texel)) {
    const [r, g] = texel;
    for (let at = 16; at < bytes.length; at += channels) {
      bytes[at] = r;
      bytes[at + 1] = g;
    }
    return bytes;
  }
  let at = 16;
  for (let face = 0; face < faces; face += 1) {
    for (let j = 0; j < size; j += 1) {
      for (let i = 0; i < size; i += 1, at += channels) texel(face, i, j, bytes, at);
    }
  }
  return bytes;
}

/** A WBP2 chunk of `layers`, each 512 × 256 preview bytes, row 0 the northmost. */
export function previewChunk(years: number[], layers: Uint8Array[]): Uint8Array {
  const plane = 512 * 256;
  const head = 12 + 4 * years.length;
  const bytes = new Uint8Array(head + layers.length * plane);
  const view = new DataView(bytes.buffer);
  bytes.set([...constants.formats.borderPreviews.magic].map((c) => c.charCodeAt(0)));
  view.setUint8(4, constants.formats.borderPreviews.version);
  view.setUint16(6, years.length, true);
  view.setUint16(8, 512, true);
  view.setUint16(10, 256, true);
  years.forEach((year, i) => view.setInt32(12 + 4 * i, year, true));
  layers.forEach((layer, k) => {
    const out = bytes.subarray(head + k * plane, head + (k + 1) * plane);
    const before = layers[k - 1];
    for (let t = 0; t < plane; t += 1) {
      out[t] = before ? ((layer[t] ?? 0) - (before[t] ?? 0)) & 255 : (layer[t] ?? 0);
    }
  });
  return bytes;
}
