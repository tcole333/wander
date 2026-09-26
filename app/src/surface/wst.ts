// The surface tile decoder (streaming.md 3.1), the inverse of pipeline/src/prebuild/wst.py: inflate
// a .wst, check it, undo its predictors, and build what the GPU takes. It is pure and imports no
// three, so the decode worker stays small; the worker only wraps it.
import constants from '@shared/constants.json' with { type: 'json' };
import { codeToMeters } from './codes';
import { BORDER, EDGES, TILE, faceEdgeSides, tileKey, type Tile } from './cube';
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

/** A tile's planes as stored, 264² texels, row 0 at j = −4 (the smallest t), and its profiles. */
export interface WstPlanes {
  codes: Int16Array;
  shore: Uint8Array;
  water: Uint8Array;
  /**
   * 4×451 codes: sides N, E, S, W, each mip 0 entries 0..256, mip 1 0..128 and mip 2 0..64, in
   * increasing s or t, entry k of mip m at texel corner 2^m·k. The sides inside a face hold 0.
   */
  profiles: Int16Array;
  /** The shore byte of each profile entry, laid out alike. */
  profileShore: Uint8Array;
}

export interface DecodedWst {
  header: WstHeader;
  /** R16F: half-float bits of code − codeMid at 264², 132² and 66². */
  heightMips: [Uint16Array, Uint16Array, Uint16Array];
  /** RG8: (shore, water) at 264², 132² and 66². */
  channelMips: [Uint8Array, Uint8Array, Uint8Array];
  /**
   * RG16F, 257 wide and 12 rows: row 4m + e holds side e (N 0, E 1, S 2, W 3) at mip m, and texel
   * k its entry k as half-float bits of (code − codeMid, shore byte). The rows of sides inside a
   * face and the texels past 256 >> m are 0.
   */
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

export const SIZE = TILE + 2 * BORDER; // 264
export const MIP_SIZES = [SIZE, SIZE / 2, SIZE / 4] as const;
export const GRID = 33;
const GRID_STEP = TILE / (GRID - 1);
const N = 0; // edge-profile order N, E, S, W
const E = 1;
const S = 2;
const W = 3;

/** A side's profile: mip 0 entries 0..256, then mip 1 entries 0..128, then mip 2 entries 0..64. */
export const MIP_ENTRIES = [TILE + 1, TILE / 2 + 1, TILE / 4 + 1] as const; // 257, 129, 65
export const MIP_START = [0, MIP_ENTRIES[0], MIP_ENTRIES[0] + MIP_ENTRIES[1]] as const;
export const PROFILE_ENTRIES = MIP_ENTRIES[0] + MIP_ENTRIES[1] + MIP_ENTRIES[2]; // 451
/** The edge texture's width, mip 0's texel corners 0..256. */
export const EDGE_ENTRIES = MIP_ENTRIES[0];
/** The edge texture's rows: row 4m + e holds side e at mip m. */
export const EDGE_ROWS = EDGES.length * MIP_SIZES.length; // 12
/** Where two stored sides meet at a tile corner: (side, entry, side, entry), entry −1 the last. */
const TILE_CORNERS = [
  [N, 0, W, -1],
  [N, -1, E, -1],
  [S, 0, W, 0],
  [S, -1, E, 0],
] as const;

const PROFILES_AT = 26;
const SIDE_BYTES = 3 * PROFILE_ENTRIES; // 1,353: the i16 codes and u8 shore bytes of one side
const PLANE_BYTES = 4 * SIZE * SIZE; // 278,784: the u16 height, u8 shore and u8 water planes

/**
 * The raw payload's length for a tile with `sides` face-edge sides: 26 + 1,353·sides, one pad byte
 * when sides is odd, then the 278,784 bytes of the planes.
 */
export function payloadBytes(sides: number): number {
  return PROFILES_AT + SIDE_BYTES * sides + (sides % 2) + PLANE_BYTES;
}

/** The longest payload, an L0 tile's, with all four sides stored: 284,222 bytes. */
export const MAX_PAYLOAD_BYTES = payloadBytes(EDGES.length);

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
 * The header, planes and profiles of a raw payload. Rejects a wrong magic, version or key, a length
 * other than the one the key's face-edge sides give, a qLand that is not positive or a qDeep other
 * than 4·qLand, any |code − codeMid| > 2048, a codeMin or codeMax that does not match the planes
 * and stored profile entries, and stored sides that disagree at a tile corner at any mip.
 */
export function decodePlanes(
  raw: Uint8Array,
  expected: Tile,
): { header: WstHeader; planes: WstPlanes } {
  if (raw.length < PROFILES_AT) {
    throw new WstError(
      `payload is ${raw.length} bytes, shorter than the ${PROFILES_AT}-byte header`,
    );
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
  const sides = faceEdgeSides(expected);
  const n = sides.length;
  if (raw.length !== payloadBytes(n)) {
    throw new WstError(
      `payload is ${raw.length} bytes, not ${payloadBytes(n)} for ${n} stored sides`,
    );
  }
  if (!(Number.isFinite(qLand) && qLand > 0 && qDeep === 4 * qLand)) {
    throw new WstError(`qLand ${qLand} and qDeep ${qDeep} are not a positive q and 4q`);
  }

  // The stored sides' codes, then their shore bytes, 451 entries a side.
  const profiles = new Int16Array(EDGES.length * PROFILE_ENTRIES);
  const profileShore = new Uint8Array(EDGES.length * PROFILE_ENTRIES);
  const shoreAt = PROFILES_AT + 2 * PROFILE_ENTRIES * n;
  let low = Infinity;
  let high = -Infinity;
  sides.forEach((e, stored) => {
    for (let k = 0; k < PROFILE_ENTRIES; k += 1) {
      const code = view.getInt16(PROFILES_AT + 2 * (stored * PROFILE_ENTRIES + k), true);
      profiles[e * PROFILE_ENTRIES + k] = code;
      profileShore[e * PROFILE_ENTRIES + k] = view.getUint8(shoreAt + stored * PROFILE_ENTRIES + k);
      low = Math.min(low, code);
      high = Math.max(high, code);
    }
  });
  const heightAt = PROFILES_AT + SIDE_BYTES * n + (n % 2);
  const codes = new Int16Array(SIZE * SIZE);
  const range = undoHeightPredictor(view, heightAt, codes);
  low = Math.min(low, range.low);
  high = Math.max(high, range.high);
  if (high - codeMid > HALF_EXACT || codeMid - low > HALF_EXACT) {
    throw new WstError(`codes ${low}..${high} reach past codeMid ${codeMid} ± ${HALF_EXACT}`);
  }
  if (low !== codeMin || high !== codeMax) {
    throw new WstError(`header codes ${codeMin}..${codeMax}, planes and profiles ${low}..${high}`);
  }
  const disagreement = cornerDisagreement(sides, profiles, profileShore);
  if (disagreement !== null) throw new WstError(disagreement);
  const shoreAtPlane = heightAt + 2 * SIZE * SIZE;
  const waterAtPlane = shoreAtPlane + SIZE * SIZE;
  const shore = undoBytePredictor(raw.subarray(shoreAtPlane, waterAtPlane));
  const water = undoBytePredictor(raw.subarray(waterAtPlane, waterAtPlane + SIZE * SIZE));
  return { header, planes: { codes, shore, water, profiles, profileShore } };
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
    edges: edgeTexels(planes, header),
    grid: meterGrid(codes[2], planes.profiles, header),
    boundsM: [Math.floor(codeToMeters(codeMin, qLand)), Math.ceil(codeToMeters(codeMax, qLand))],
  };
}

/** Inflate, check and decode a stored .wst for the tile `expected`. */
export async function decodeWst(buf: ArrayBuffer, expected: Tile): Promise<DecodedWst> {
  const raw = await inflate(buf, MAX_PAYLOAD_BYTES);
  const { header, planes } = decodePlanes(raw, expected);
  return { ...buildMips(planes, header), compressed: buf };
}

/**
 * Codes from zigzag(code − pred), pred = left + up − upleft with 0 outside the grid, reading the
 * height plane at byte `at`. Returns the codes' range as decoded, before any is narrowed to an i16.
 */
function undoHeightPredictor(
  view: DataView,
  at: number,
  codes: Int16Array,
): { low: number; high: number } {
  // above[i + 1] is the code at (j − 1, i) and row[i + 1] at (j, i); index 0 stays 0.
  let above = new Int32Array(SIZE + 1);
  let row = new Int32Array(SIZE + 1);
  let low = Infinity;
  let high = -Infinity;
  for (let j = 0; j < SIZE; j += 1) {
    for (let i = 0; i < SIZE; i += 1) {
      const k = j * SIZE + i;
      const z = view.getUint16(at + 2 * k, true);
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

/** The index into a profile layout of entry k of side e at mip m; k −1 is the mip's last. */
function profileIndex(e: number, m: number, k: number): number {
  return e * PROFILE_ENTRIES + (MIP_START[m] ?? 0) + (k < 0 ? TILE >> m : k);
}

/**
 * Where two stored sides meet at a tile corner, both hold its entry at every mip, as the same code
 * and shore byte. The first corner where they differ, or null.
 */
function cornerDisagreement(
  sides: readonly number[],
  profiles: Int16Array,
  profileShore: Uint8Array,
): string | null {
  for (let m = 0; m < MIP_SIZES.length; m += 1) {
    for (const [a, atA, b, atB] of TILE_CORNERS) {
      if (!sides.includes(a) || !sides.includes(b)) continue;
      const i = profileIndex(a, m, atA);
      const j = profileIndex(b, m, atB);
      if (profiles[i] !== profiles[j] || profileShore[i] !== profileShore[j]) {
        return `edge profiles ${EDGES[a]} and ${EDGES[b]} disagree at a tile corner at mip ${m}`;
      }
    }
  }
  return null;
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

/** The RG16F edge texture of the stored sides' profiles (DecodedWst.edges). */
function edgeTexels(planes: WstPlanes, header: WstHeader): Uint16Array {
  const texels = new Uint16Array(2 * EDGE_ROWS * EDGE_ENTRIES);
  for (const e of faceEdgeSides(header)) {
    MIP_ENTRIES.forEach((count, m) => {
      const row = (EDGES.length * m + e) * EDGE_ENTRIES;
      for (let k = 0; k < count; k += 1) {
        const at = profileIndex(e, m, k);
        texels[2 * (row + k)] = halfBitsOf((planes.profiles[at] ?? 0) - header.codeMid);
        texels[2 * (row + k) + 1] = halfBitsOf(planes.profileShore[at] ?? 0);
      }
    });
  }
  return texels;
}

/**
 * Vertex (k, l) sits at texel corner (8k, 8l). A vertex on a stored side (row 32 for N, column 32
 * for E, row 0 for S, column 0 for W) takes h of that side's mip-2 entry 2·(its index along the
 * side), which two stored sides agree on at a tile corner. Every other vertex, on a side inside the
 * face too, takes h of the mean of the four mip-2 codes around its corner: mip-2 texels 2k and
 * 2k + 1 across, 2l and 2l + 1 up (mip-2 texel 0 is the border).
 */
function meterGrid(mip2: Int16Array, profiles: Int16Array, header: WstHeader): Float32Array {
  const side = MIP_SIZES[2];
  const stored = faceEdgeSides(header);
  const last = GRID - 1;
  const along = (e: number, i: number): number | undefined =>
    stored.includes(e) ? (profiles[profileIndex(e, 2, (GRID_STEP >> 2) * i)] ?? 0) : undefined;
  const onSide = (k: number, l: number): number | undefined =>
    (l === 0 ? along(S, k) : undefined) ??
    (l === last ? along(N, k) : undefined) ??
    (k === 0 ? along(W, l) : undefined) ??
    (k === last ? along(E, l) : undefined);
  const grid = new Float32Array(GRID * GRID);
  for (let l = 0; l < GRID; l += 1) {
    for (let k = 0; k < GRID; k += 1) {
      const p = 2 * l * side + 2 * k;
      const code =
        onSide(k, l) ??
        ((mip2[p] ?? 0) + (mip2[p + 1] ?? 0) + (mip2[p + side] ?? 0) + (mip2[p + side + 1] ?? 0)) /
          4;
      grid[l * GRID + k] = codeToMeters(code, header.qLand);
    }
  }
  return grid;
}
