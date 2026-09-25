// The surface tile decoder (streaming.md 3.1), the inverse of pipeline/src/prebuild/wst.py: inflate
// a .wst, check it, undo its predictors, and build what the GPU takes. It is pure and imports no
// three, so the decode worker stays small; the worker only wraps it.
import constants from '@shared/constants.json';
import { codeToMeters } from './codes';
import { TILE, tileKey, type Tile } from './cube';
import { HALF_EXACT, halfBitsOf } from './half';

export interface WstHeader {
  face: number;
  level: number;
  x: number;
  y: number;
  /** FLAG_INLAND_WATER and FLAG_ALL_SEA. */
  flags: number;
  /** Meters per code at or above −200 m. */
  qLand: number;
  /** 4·qLand, meters per code below −200 m. */
  qDeep: number;
  codeMid: number;
  codeMin: number;
  codeMax: number;
}

/** A tile's planes as stored: 264² texels, row 0 at j = −4 (the smallest t). */
export interface WstPlanes {
  codes: Int16Array;
  shore: Uint8Array;
  water: Uint8Array;
  /** 4×257 codes: N, E, S, W at texel corners 0..256. */
  edges: Int16Array;
}

export interface DecodedWst {
  header: WstHeader;
  /** R16F: half-float bits of code − codeMid at 264², 132² and 66². */
  heightMips: [Uint16Array, Uint16Array, Uint16Array];
  /** RG8: (shore, water) at 264², 132² and 66². */
  channelMips: [Uint8Array, Uint8Array, Uint8Array];
  /** R16F: half-float bits of edge code − codeMid, 4×257 in the order N, E, S, W. */
  edges: Uint16Array;
  /** 33² mesh heights in meters, row 0 at the smallest t; vertex k sits at texel corner 8k. */
  grid: Float32Array;
  /** [floor(h(codeMin)), ceil(h(codeMax))], the node's LOD bounds. */
  boundsM: [number, number];
  /** The stored bytes, handed back so the main thread can keep them in its byte cache. */
  compressed: ArrayBuffer;
}

export class WstError extends Error {
  override name = 'WstError';
}

export const WST_MAGIC: string = constants.formats.surfaceTile.magic;
export const WST_VERSION: number = constants.formats.surfaceTile.version;
export const FLAG_INLAND_WATER = 1;
export const FLAG_ALL_SEA = 2;

export const SIZE = TILE + 2 * constants.cube.border; // 264
export const MIP_SIZES = [SIZE, SIZE / 2, SIZE / 4] as const;
export const EDGE_ENTRIES = TILE + 1;
export const GRID = 33;
const GRID_STEP = TILE / (GRID - 1);
const N = 0; // edge-profile order N, E, S, W
const E = 1;
const S = 2;
const W = 3;

const EDGES_AT = 26;
const HEIGHT_AT = EDGES_AT + 4 * EDGE_ENTRIES * 2; // 2,082
const SHORE_AT = HEIGHT_AT + SIZE * SIZE * 2; // 141,474
const WATER_AT = SHORE_AT + SIZE * SIZE; // 211,170
export const PAYLOAD_BYTES = WATER_AT + SIZE * SIZE; // 280,866

/** Gunzip `buf` (left intact), refusing output longer than `maxBytes`. */
export async function inflate(buf: ArrayBuffer, maxBytes: number): Promise<Uint8Array> {
  const reader = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const out = new Uint8Array(maxBytes);
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out.subarray(0, length);
    if (length + value.length > maxBytes) {
      await reader.cancel();
      throw new WstError(`inflates past ${maxBytes} bytes`);
    }
    out.set(value, length);
    length += value.length;
  }
}

/**
 * The header and planes of a raw payload. Rejects a wrong length, magic, version or key, a qLand
 * that is not positive or a qDeep other than 4·qLand, any |code − codeMid| > 2048, and a codeMin
 * or codeMax that does not match the planes and edges.
 */
export function decodePlanes(
  raw: Uint8Array,
  expected: Tile,
): { header: WstHeader; planes: WstPlanes } {
  if (raw.length !== PAYLOAD_BYTES) {
    throw new WstError(`payload is ${raw.length} bytes, not ${PAYLOAD_BYTES}`);
  }
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const magic = String.fromCharCode(...raw.subarray(0, 4));
  if (magic !== WST_MAGIC) {
    throw new WstError(`magic is ${JSON.stringify(magic)}, not ${WST_MAGIC}`);
  }
  const version = view.getUint8(4);
  if (version !== WST_VERSION) throw new WstError(`version is ${version}, not ${WST_VERSION}`);
  const header: WstHeader = {
    face: view.getUint8(5),
    level: view.getUint8(6),
    flags: view.getUint8(7),
    x: view.getUint16(8, true),
    y: view.getUint16(10, true),
    qLand: view.getFloat32(12, true),
    qDeep: view.getFloat32(16, true),
    codeMid: view.getInt16(20, true),
    codeMin: view.getInt16(22, true),
    codeMax: view.getInt16(24, true),
  };
  const { face, level, x, y, qLand, qDeep, codeMid, codeMin, codeMax } = header;
  if (face !== expected.face || level !== expected.level || x !== expected.x || y !== expected.y) {
    throw new WstError(`tile is ${tileKey(header)}, not ${tileKey(expected)}`);
  }
  if (!(Number.isFinite(qLand) && qLand > 0 && qDeep === 4 * qLand)) {
    throw new WstError(`qLand ${qLand} and qDeep ${qDeep} are not a positive q and 4q`);
  }

  const edges = new Int16Array(4 * EDGE_ENTRIES);
  let low = Infinity;
  let high = -Infinity;
  for (let k = 0; k < edges.length; k += 1) {
    const code = view.getInt16(EDGES_AT + 2 * k, true);
    edges[k] = code;
    low = Math.min(low, code);
    high = Math.max(high, code);
  }
  const codes = new Int16Array(SIZE * SIZE);
  const range = undoHeightPredictor(view, codes);
  low = Math.min(low, range.low);
  high = Math.max(high, range.high);
  if (high - codeMid > HALF_EXACT || codeMid - low > HALF_EXACT) {
    throw new WstError(`codes ${low}..${high} reach past codeMid ${codeMid} ± ${HALF_EXACT}`);
  }
  if (low !== codeMin || high !== codeMax) {
    throw new WstError(`header codes ${codeMin}..${codeMax}, planes and edges ${low}..${high}`);
  }
  const shore = undoBytePredictor(raw.subarray(SHORE_AT, WATER_AT));
  const water = undoBytePredictor(raw.subarray(WATER_AT, PAYLOAD_BYTES));
  return { header, planes: { codes, shore, water, edges } };
}

/** Mips 132² and 66² of every plane, (a + b + c + d + 2) >> 2, and what the GPU and LOD take. */
export function buildMips(planes: WstPlanes, header: WstHeader): Omit<DecodedWst, 'compressed'> {
  const { codeMid, codeMin, codeMax, qLand } = header;
  const codes = mipChain(planes.codes, (length) => new Int16Array(length));
  const shore = mipChain(planes.shore, (length) => new Uint8Array(length));
  const water = mipChain(planes.water, (length) => new Uint8Array(length));
  const offsets = (mip: Int16Array): Uint16Array => {
    const bits = new Uint16Array(mip.length);
    mip.forEach((code, k) => {
      bits[k] = halfBitsOf(code - codeMid);
    });
    return bits;
  };
  return {
    header,
    heightMips: [offsets(codes[0]), offsets(codes[1]), offsets(codes[2])],
    channelMips: [
      interleave(shore[0], water[0]),
      interleave(shore[1], water[1]),
      interleave(shore[2], water[2]),
    ],
    edges: offsets(planes.edges),
    grid: meterGrid(codes[2], planes.edges, qLand),
    boundsM: [Math.floor(codeToMeters(codeMin, qLand)), Math.ceil(codeToMeters(codeMax, qLand))],
  };
}

/** Inflate, check and decode a stored .wst for the tile `expected`. */
export async function decodeWst(buf: ArrayBuffer, expected: Tile): Promise<DecodedWst> {
  const raw = await inflate(buf, PAYLOAD_BYTES);
  const { header, planes } = decodePlanes(raw, expected);
  return { ...buildMips(planes, header), compressed: buf };
}

/**
 * Codes from zigzag(code − pred), pred = left + up − upleft with 0 outside the grid. Returns the
 * codes' range as decoded, before any is narrowed to an i16.
 */
function undoHeightPredictor(view: DataView, codes: Int16Array): { low: number; high: number } {
  // above[i + 1] is the code at (j − 1, i) and row[i + 1] at (j, i); index 0 stays 0.
  let above = new Int32Array(SIZE + 1);
  let row = new Int32Array(SIZE + 1);
  let low = Infinity;
  let high = -Infinity;
  for (let j = 0; j < SIZE; j += 1) {
    for (let i = 0; i < SIZE; i += 1) {
      const k = j * SIZE + i;
      const z = view.getUint16(HEIGHT_AT + 2 * k, true);
      const code = ((z >>> 1) ^ -(z & 1)) + (row[i] ?? 0) + (above[i + 1] ?? 0) - (above[i] ?? 0);
      row[i + 1] = code;
      codes[k] = code;
      low = Math.min(low, code);
      high = Math.max(high, code);
    }
    [above, row] = [row, above];
  }
  return { low, high };
}

/** Bytes from (v − pred) mod 256, pred = left + up − upleft with 0 outside the grid. */
function undoBytePredictor(residuals: Uint8Array): Uint8Array {
  const out = new Uint8Array(SIZE * SIZE);
  for (let j = 0; j < SIZE; j += 1) {
    for (let i = 0; i < SIZE; i += 1) {
      const k = j * SIZE + i;
      const left = i > 0 ? (out[k - 1] ?? 0) : 0;
      const up = j > 0 ? (out[k - SIZE] ?? 0) : 0;
      const upleft = i > 0 && j > 0 ? (out[k - SIZE - 1] ?? 0) : 0;
      out[k] = (residuals[k] ?? 0) + left + up - upleft;
    }
  }
  return out;
}

/** The plane and its two mips, each texel (a + b + c + d + 2) >> 2 of the level above. */
function mipChain<T extends Int16Array | Uint8Array>(
  plane: T,
  make: (length: number) => T,
): [T, T, T] {
  const one = halve(plane, SIZE, make);
  return [plane, one, halve(one, SIZE / 2, make)];
}

function halve<T extends Int16Array | Uint8Array>(
  above: T,
  size: number,
  make: (length: number) => T,
): T {
  const half = size / 2;
  const mip = make(half * half);
  for (let y = 0; y < half; y += 1) {
    for (let x = 0; x < half; x += 1) {
      const k = 2 * y * size + 2 * x;
      const sum =
        (above[k] ?? 0) + (above[k + 1] ?? 0) + (above[k + size] ?? 0) + (above[k + size + 1] ?? 0);
      mip[y * half + x] = (sum + 2) >> 2;
    }
  }
  return mip;
}

/** RG8: shore in R, water in G. */
function interleave(shore: Uint8Array, water: Uint8Array): Uint8Array {
  const rg = new Uint8Array(2 * shore.length);
  for (let k = 0; k < shore.length; k += 1) {
    rg[2 * k] = shore[k] ?? 0;
    rg[2 * k + 1] = water[k] ?? 0;
  }
  return rg;
}

/**
 * Interior vertex (k, l) takes h of the mean of the four mip-2 codes around texel corner
 * (8k, 8l): mip-2 texels 2k and 2k + 1 across, 2l and 2l + 1 up (mip-2 texel 0 is the border).
 * Boundary vertices take h of the edge-profile code at their corner: rows 0 and 32 from S and N,
 * the rest of columns 0 and 32 from W and E.
 */
function meterGrid(mip2: Int16Array, edges: Int16Array, qLand: number): Float32Array {
  const side = MIP_SIZES[2];
  const edge = (which: number, k: number): number =>
    edges[which * EDGE_ENTRIES + GRID_STEP * k] ?? 0;
  const grid = new Float32Array(GRID * GRID);
  const last = GRID - 1;
  for (let l = 0; l < GRID; l += 1) {
    for (let k = 0; k < GRID; k += 1) {
      let code: number;
      if (l === 0) code = edge(S, k);
      else if (l === last) code = edge(N, k);
      else if (k === 0) code = edge(W, l);
      else if (k === last) code = edge(E, l);
      else {
        const p = 2 * l * side + 2 * k;
        const sum =
          (mip2[p] ?? 0) + (mip2[p + 1] ?? 0) + (mip2[p + side] ?? 0) + (mip2[p + side + 1] ?? 0);
        code = sum / 4;
      }
      grid[l * GRID + k] = codeToMeters(code, qLand);
    }
  }
  return grid;
}
