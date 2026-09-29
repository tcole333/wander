// A glyph set turned into signed distance fields, one cell per glyph on shelves as wide as the
// look's sea-name atlas, which the look appends below the names (seaNames.ts): the marks need no
// sampler of their own. Each glyph is filled at SUPERSAMPLE times its cell on a 2D canvas, its
// exact distance transform taken there and averaged down, and the canvas released.
//
// A cell is GLYPH_CELL texels square: the 64-unit grid at one texel a unit, and GLYPH_MARGIN
// texels around it where the field carries on, for a contact shadow, a hollow outline and mips
// that never reach a neighbor's glyph. A texel holds 128 + 127 × distance / GLYPH_SPREAD, the
// distance in texels to the glyph's edge, positive inside; far outside is about 0, as the names'
// blank atlas is, so neither bleeds into the other's mips.
import { GLYPH_UNITS, type GlyphSet } from './glyphs';

export const GLYPH_MARGIN = 16;
export const GLYPH_CELL = GLYPH_UNITS + 2 * GLYPH_MARGIN;
/** Texels of distance either side of the edge that a byte spans. */
export const GLYPH_SPREAD = 16;
/** The fill's resolution over the cell's, before the field is averaged down. */
const SUPERSAMPLE = 4;
const INF = 1e20;

/** A glyph's cell: its top-left texel, and how far the glyph reaches from its center. */
export interface GlyphCell {
  x: number;
  y: number;
  /** The farthest the glyph's shape reaches from the grid's center, in half grids (1 at an edge). */
  extent: number;
}

/** Glyph cells on shelves `width` texels wide: R8 bytes, row 0 first, and each glyph's cell. */
export interface GlyphShelf {
  width: number;
  height: number;
  data: Uint8Array;
  /** Each glyph's cell within the shelf. */
  cells: Map<string, GlyphCell>;
}

/** Rasterizes every glyph in `set` and lays their fields out on shelves `width` texels wide. */
export function glyphShelf(set: GlyphSet, width: number): GlyphShelf {
  const names = Object.keys(set);
  const perRow = Math.max(1, Math.floor(width / GLYPH_CELL));
  const rows = Math.ceil(names.length / perRow);
  const height = rows * GLYPH_CELL;
  const data = new Uint8Array(width * height);
  const cells = new Map<string, GlyphCell>();
  if (names.length === 0) return { width, height, data, cells };

  const side = GLYPH_CELL * SUPERSAMPLE;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = side;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2D canvas');
  try {
    names.forEach((name, n) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, side, side);
      const offset = GLYPH_MARGIN * SUPERSAMPLE;
      ctx.setTransform(SUPERSAMPLE, 0, 0, SUPERSAMPLE, offset, offset);
      ctx.fillStyle = '#fff';
      ctx.fill(new Path2D(set[name]), 'nonzero');
      const { data: rgba } = ctx.getImageData(0, 0, side, side);
      const inside = new Uint8Array(side * side);
      for (let i = 0; i < inside.length; i++) inside[i] = (rgba[i * 4] ?? 0) >= 128 ? 1 : 0;
      const field = signedDistance(inside, side, side);
      const x = (n % perRow) * GLYPH_CELL;
      const y = Math.floor(n / perRow) * GLYPH_CELL;
      writeCell(field, side, data, width, x, y);
      cells.set(name, { x, y, extent: extentOf(inside, side) });
    });
  } finally {
    canvas.width = canvas.height = 0;
  }
  return { width, height, data, cells };
}

/** How far the inside pixels of a square fill reach from its center, in the glyph's half grids. */
export function extentOf(inside: Uint8Array, side: number): number {
  const center = side / 2;
  let most = 0;
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      if (inside[j * side + i] !== 1) continue;
      most = Math.max(most, Math.hypot(i + 0.5 - center, j + 0.5 - center) + Math.SQRT1_2);
    }
  }
  return most / ((side / GLYPH_CELL) * (GLYPH_UNITS / 2));
}

/** Averages a supersampled field (in fine pixels) into one cell of bytes at (x, y). */
function writeCell(
  field: Float32Array,
  side: number,
  out: Uint8Array,
  width: number,
  x: number,
  y: number,
): void {
  const s = SUPERSAMPLE;
  for (let j = 0; j < GLYPH_CELL; j++) {
    for (let i = 0; i < GLYPH_CELL; i++) {
      let sum = 0;
      for (let b = 0; b < s; b++) {
        for (let a = 0; a < s; a++) sum += field[(j * s + b) * side + i * s + a] ?? 0;
      }
      out[(y + j) * width + x + i] = encodeDistance(sum / (s * s) / s);
    }
  }
}

/** A distance in texels, positive inside, as the byte the atlas holds. */
export function encodeDistance(texels: number): number {
  return Math.max(0, Math.min(255, Math.round(128 + (127 * texels) / GLYPH_SPREAD)));
}

/**
 * The signed distance from each pixel's center to the edge between `inside` (1) and outside (0)
 * pixels, in pixels, positive inside: exact Euclidean distance transforms of both sets (Felzenszwalb
 * and Huttenlocher), each less half a pixel, so the edge lies between the two pixels either side.
 */
export function signedDistance(inside: Uint8Array, width: number, height: number): Float32Array {
  const toInside = transform(inside, width, height, 1);
  const toOutside = transform(inside, width, height, 0);
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) {
    out[i] =
      inside[i] === 1 ? Math.sqrt(toOutside[i] ?? 0) - 0.5 : -(Math.sqrt(toInside[i] ?? 0) - 0.5);
  }
  return out;
}

/** Squared distances from each pixel to the nearest pixel whose value is `target`. */
function transform(mask: Uint8Array, width: number, height: number, target: number): Float64Array {
  const grid = new Float64Array(width * height);
  for (let i = 0; i < grid.length; i++) grid[i] = mask[i] === target ? 0 : INF;
  const n = Math.max(width, height);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x] ?? INF;
    line(f, d, v, z, height);
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y] ?? INF;
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = grid[y * width + x] ?? INF;
    line(f, d, v, z, width);
    for (let x = 0; x < width; x++) grid[y * width + x] = d[x] ?? INF;
  }
  return grid;
}

/** The 1D squared distance transform of f's first n values into d: the lower envelope of parabolas. */
function line(f: Float64Array, d: Float64Array, v: Int32Array, z: Float64Array, n: number): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  const at = (i: number) => f[i] ?? INF;
  for (let q = 1; q < n; q++) {
    // z[0] is -INF, so the search stops at the first parabola at the latest.
    let p = v[k] ?? 0;
    let s = (at(q) + q * q - (at(p) + p * p)) / (2 * q - 2 * p);
    while (s <= (z[k] ?? -INF)) {
      k -= 1;
      p = v[k] ?? 0;
      s = (at(q) + q * q - (at(p) + p * p)) / (2 * q - 2 * p);
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while ((z[k + 1] ?? INF) < q) k += 1;
    const p = v[k] ?? 0;
    d[q] = (q - p) * (q - p) + at(p);
  }
}
