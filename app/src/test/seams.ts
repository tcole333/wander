// Seams between decoded surface tiles (streaming.md 3.1 Edges, 7.3), checked on what the decoder
// hands the GPU. The fixture's seams test and the region bake check (`npm run verify:bake`) both
// apply them. Within a face, border texels equal the neighbor's interior at mips 0-2 and edge
// profiles match, bit for bit. Across a face edge, edge profiles match bit for bit, and each border
// texel maps into the neighbor's texel column k with a code close to the neighbor's around it.
import {
  BORDER,
  TILE,
  faceSt,
  neighbor,
  stToDir,
  texelCenter,
  tileKey,
  type Edge,
  type Tile,
} from '../surface/cube';
import { EDGE_ENTRIES, MIP_SIZES, SIZE, type DecodedWst } from '../surface/wst';

export type Mip = 0 | 1 | 2;

const MIPS: readonly Mip[] = [0, 1, 2];
/** The last edge-profile entry, at texel corner 256. */
export const LAST_ENTRY = EDGE_ENTRIES - 1;

const EDGE_INDEX: Readonly<Record<Edge, number>> = { N: 0, E: 1, S: 2, W: 3 };
// Across a face edge a border code may miss the neighbor's 3×3 codes around the mapped point: the
// grids meet at an angle, so their texels cover different ground and a high or low inside one
// texel can fall outside the other grid's range, and the coastal clamp reads each grid's own shore
// distance. The bound (streaming.md 7.3) widens that range by 2 codes plus a fraction of its width,
// and to 0 where the clamp reaches the border texel.
const CROSS_FACE_CODES = 2;
const CLAMP_REACH_BYTES = 32; // 2 texels of shore distance, 16 bytes per texel around 128
const SHORE_LINE = 128; // shore bytes above it are land, below it sea

/** How far past the neighbor's 3×3 range a border code across a face edge may fall. */
export interface CrossFaceBound {
  /** The fraction of the range's width added to its 2 codes. */
  relief: number;
  /**
   * Skip a border texel the coastal clamp reaches when none of the neighbor's 3×3 lies on its side
   * of the shore: the two grids then disagree about a feature narrower than a texel, one keeping
   * its height and the other clamping it to 0.
   */
  shoreSplit: boolean;
}

// In the fixture, the range ± 2 codes alone misses 39 of the 110,592 border texels checked (1 at
// L0, 38 at the Kirkuk corner at L2-L7), by up to 14 codes where the range spans 153. The largest
// miss past ± 2 codes is 10.3% of the range's width (7 codes past a 68-code range), so an eighth
// passes every texel and a tenth does not.
export const FIXTURE_CROSS_FACE: CrossFaceBound = { relief: 1 / 8, shoreSplit: false };

// The region bake's 15", 1' and 4' sources are rougher than the fixture's excerpts. Away from the
// shore its largest miss past ± 2 codes is 30.8% of the range's width, so a third passes every
// texel, a quarter misses 11 and an eighth 122; one more miss is a 44 m islet in Korea Bay that one
// grid keeps and the other clamps (docs/design/measurements/work/surface-bake/region-bake.json).
export const REGION_CROSS_FACE: CrossFaceBound = { relief: 1 / 3, shoreSplit: true };

/** The integer an IEEE half-float holds, for the whole numbers within ±2048 the decoder writes. */
export function halfToInt(bits: number): number {
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  const magnitude =
    exponent === 0 ? fraction / 2 ** 24 : (1 + fraction / 1024) * 2 ** (exponent - 15);
  return bits & 0x8000 ? -magnitude : magnitude;
}

/** The height code the GPU sees at stored texel `k` of a mip, offset + codeMid. */
export function codeAt(decoded: DecodedWst, mip: Mip, k: number): number {
  const bits = decoded.heightMips[mip][k];
  if (bits === undefined) throw new RangeError(`mip ${mip} has no texel ${k}`);
  return halfToInt(bits) + decoded.header.codeMid;
}

/** Every height code of a mip as the GPU sees it, offset + codeMid. */
export function mipCodes(decoded: DecodedWst, mip: Mip): Int32Array {
  return Int32Array.from(
    decoded.heightMips[mip],
    (bits) => halfToInt(bits) + decoded.header.codeMid,
  );
}

/** Edge profile entries 0..256 as the GPU sees them, offset + codeMid. */
export function edgeCodes(decoded: DecodedWst, edge: Edge): number[] {
  const start = EDGE_INDEX[edge] * EDGE_ENTRIES;
  return Array.from(
    decoded.edges.subarray(start, start + EDGE_ENTRIES),
    (bits) => halfToInt(bits) + decoded.header.codeMid,
  );
}

/**
 * What `a` and its neighbor `b` across `edge`, on the same face, disagree on at mips 0-2: the
 * heights or the (shore, water) pairs of the texels they share, the last 2b columns (E) or rows (N)
 * of the western or southern tile and the first 2b of the other, b the mip's border. Empty when
 * every shared texel is identical.
 */
export function withinFaceMismatches(a: DecodedWst, b: DecodedWst, edge: Edge): string[] {
  if (edge === 'W') return withinFaceMismatches(b, a, 'E');
  if (edge === 'S') return withinFaceMismatches(b, a, 'N');
  const off: string[] = [];
  for (const mip of MIPS) {
    const size = MIP_SIZES[mip];
    const band = 2 * (BORDER >> mip);
    const at = (row: number, col: number): number =>
      edge === 'E' ? row * size + col : col * size + row;
    const rgA = a.channelMips[mip];
    const rgB = b.channelMips[mip];
    let heights = true;
    let channels = true;
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < band; c += 1) {
        const ka = at(r, size - band + c);
        const kb = at(r, c);
        if (codeAt(a, mip, ka) !== codeAt(b, mip, kb)) heights = false;
        if (rgA[2 * ka] !== rgB[2 * kb] || rgA[2 * ka + 1] !== rgB[2 * kb + 1]) channels = false;
      }
    }
    if (!heights) off.push(`mip ${mip} heights`);
    if (!channels) off.push(`mip ${mip} shore and water`);
  }
  return off;
}

/** Whether `t`'s edge profile along `edge` equals, entry for entry, its neighbor's across it. */
export function edgeProfileMatches(
  t: Tile,
  edge: Edge,
  mine: DecodedWst,
  theirs: DecodedWst,
): boolean {
  const other = neighbor(t, edge);
  const own = edgeCodes(mine, edge);
  const across = edgeCodes(theirs, other.edge);
  return own.every((code, k) => code === across[other.reversed ? LAST_ENTRY - k : k]);
}

/**
 * The border texels of `t` past the face edge `edge` that do not map into the neighbor's texel
 * column k (k texels past the edge), or whose code falls outside `bound` around the neighbor's 3×3
 * codes there, one line each. `theirs` is the neighbor across `edge`.
 */
export function crossFaceMisses(
  t: Tile,
  edge: Edge,
  mine: DecodedWst,
  theirs: DecodedWst,
  bound: CrossFaceBound,
): string[] {
  const other = neighbor(t, edge);
  if (other.tile.face === t.face) throw new Error(`${tileKey(t)} ${edge} is not a face edge`);
  const shore = mine.channelMips[0];
  const off: string[] = [];
  for (let k = 0; k < BORDER; k += 1) {
    for (let along = 0; along < TILE; along += 1) {
      const [i, j] = borderTexel(edge, k, along);
      const [si, sj] = mappedTexel(t, i, j, other.tile);
      const column = { W: si, E: TILE - 1 - si, S: sj, N: TILE - 1 - sj }[other.edge];
      const at = (j + BORDER) * SIZE + (i + BORDER);
      const code = codeAt(mine, 0, at);
      const side = Math.sign((shore[2 * at] ?? NaN) - SHORE_LINE);
      const nearShore = Math.abs((shore[2 * at] ?? NaN) - SHORE_LINE) <= CLAMP_REACH_BYTES;
      const around = around3x3(theirs, si, sj);
      const low = nearShore ? Math.min(around.low, 0) : around.low;
      const high = nearShore ? Math.max(around.high, 0) : around.high;
      const slack = CROSS_FACE_CODES + (high - low) * bound.relief;
      const split = bound.shoreSplit && nearShore && side !== 0 && !around.sides.has(side);
      const outside = code < low - slack || code > high + slack;
      if (column !== k || (outside && !split)) {
        off.push(`${tileKey(t)} ${edge} k=${k} along=${along}: ${code} vs ${low}..${high}`);
      }
    }
  }
  return off;
}

/** Tile-local texel (i, j) of the border texel k past the edge at position `along`. */
function borderTexel(edge: Edge, k: number, along: number): [number, number] {
  switch (edge) {
    case 'E':
      return [TILE + k, along];
    case 'W':
      return [-1 - k, along];
    case 'N':
      return [along, TILE + k];
    case 'S':
      return [along, -1 - k];
  }
}

/** The tile-local texel of `other` (on another face) holding the center of texel (i, j) of `t`. */
function mappedTexel(t: Tile, i: number, j: number, other: Tile): [number, number] {
  const n = TILE * 2 ** t.level;
  const p = stToDir(
    t.face,
    texelCenter(t.level, TILE * t.x + i),
    texelCenter(t.level, TILE * t.y + j),
  );
  const [s, u] = faceSt(other.face, p);
  return [
    Math.floor(((s + 1) * n) / 2) - TILE * other.x,
    Math.floor(((u + 1) * n) / 2) - TILE * other.y,
  ];
}

/**
 * The lowest and highest of the 3×3 stored codes around tile-local texel (i, j), and the sides of
 * the shore their texels lie on: 1 for land, -1 for sea (a texel on the line counts for neither).
 */
function around3x3(
  tile: DecodedWst,
  i: number,
  j: number,
): { low: number; high: number; sides: Set<number> } {
  let low = Infinity;
  let high = -Infinity;
  const sides = new Set<number>();
  for (let dj = -1; dj <= 1; dj += 1) {
    for (let di = -1; di <= 1; di += 1) {
      const ci = i + di + BORDER;
      const cj = j + dj + BORDER;
      if (ci < 0 || ci >= SIZE || cj < 0 || cj >= SIZE) {
        throw new RangeError(`texel (${i + di}, ${j + dj}) is not stored`);
      }
      const at = cj * SIZE + ci;
      const code = codeAt(tile, 0, at);
      low = Math.min(low, code);
      high = Math.max(high, code);
      sides.add(Math.sign((tile.channelMips[0][2 * at] ?? NaN) - SHORE_LINE));
    }
  }
  return { low, high, sides };
}
