// Seams between decoded surface tiles (streaming.md 3.1 Edges, 7.3), checked on what the decoder
// hands the GPU. The fixture's seams test and the region bake check (`npm run verify:bake`) both
// apply them. Within a face, border texels equal the neighbor's interior at mips 0-2, bit for bit,
// and sides store no profile. On a face edge, each side stores an edge profile at mips 0-2: across
// the edge both tiles hold the same codes and shore bytes, a tile's stored sides and the tiles at a
// cube corner agree where they meet, and each entry is the rha mean of the owner face's four mip-m
// texels around its corner. Each border texel past a face edge maps into the neighbor's texel
// column k with a code close to the neighbor's around it.
import {
  BORDER,
  EDGES,
  FACE_EDGES,
  TILE,
  faceEdgeSides,
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

export const MIPS: readonly Mip[] = [0, 1, 2];

/** A tile's corners, named by the sides that meet there. */
export type TileCorner = 'SW' | 'SE' | 'NW' | 'NE';
export const TILE_CORNERS: readonly TileCorner[] = ['SW', 'SE', 'NW', 'NE'];
/** The sides that meet at each tile corner, and whether it is their first entry or their last. */
const CORNER_SIDES: Readonly<Record<TileCorner, readonly (readonly [Edge, 'first' | 'last'])[]>> = {
  SW: [
    ['S', 'first'],
    ['W', 'first'],
  ],
  SE: [
    ['S', 'last'],
    ['E', 'first'],
  ],
  NW: [
    ['N', 'first'],
    ['W', 'last'],
  ],
  NE: [
    ['N', 'last'],
    ['E', 'last'],
  ],
};

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

/** The sides of `t` that lie on a face edge and store a profile, in N, E, S, W order. */
export function storedEdges(t: Tile): Edge[] {
  return faceEdgeSides(t).map((e) => EDGES[e] as Edge);
}

/** A stored side's profile at one mip, entries 0..(256 >> m), as the GPU sees them. */
export interface SideProfile {
  /** Offset + codeMid. */
  codes: number[];
  shore: number[];
}

/** The profile of `edge` at `mip` in the edge texture; throws when the side stores none. */
export function sideProfile(decoded: DecodedWst, edge: Edge, mip: Mip): SideProfile {
  if (!storedEdges(decoded.header).includes(edge)) {
    throw new Error(
      `${tileKey(decoded.header)} ${edge} lies inside its face and stores no profile`,
    );
  }
  const row = (EDGES.length * mip + EDGE_INDEX[edge]) * EDGE_ENTRIES;
  const count = (TILE >> mip) + 1;
  const texel = (k: number, channel: number) => decoded.edges[2 * (row + k) + channel] ?? NaN;
  return {
    codes: Array.from({ length: count }, (_, k) => halfToInt(texel(k, 0)) + decoded.header.codeMid),
    shore: Array.from({ length: count }, (_, k) => halfToInt(texel(k, 1))),
  };
}

/** What each stored side of the tile holds at its corner `at` at `mip`, as `code/shore`. */
export function cornerEntries(decoded: DecodedWst, at: TileCorner, mip: Mip): string[] {
  const stored = storedEdges(decoded.header);
  return CORNER_SIDES[at]
    .filter(([edge]) => stored.includes(edge))
    .map(([edge, end]) => {
      const { codes, shore } = sideProfile(decoded, edge, mip);
      const k = end === 'first' ? 0 : TILE >> mip;
      return `${codes[k]}/${shore[k]}`;
    });
}

/** Where a tile's stored sides disagree at a corner they share, one line per corner and mip. */
export function tileCornerMismatches(decoded: DecodedWst): string[] {
  const off: string[] = [];
  for (const at of TILE_CORNERS) {
    for (const mip of MIPS) {
      const entries = cornerEntries(decoded, at, mip);
      if (new Set(entries).size > 1) {
        off.push(`${tileKey(decoded.header)} ${at} mip ${mip}: ${entries.join(' vs ')}`);
      }
    }
  }
  return off;
}

/**
 * The cube corner that corner `at` of `t` lies on, as the signs of its direction's G components
 * (`+++` is the Kirkuk corner), or null when the tile corner is not a corner of its face.
 */
export function cubeCornerOf(t: Tile, at: TileCorner): string | null {
  const full = TILE * 2 ** t.level;
  const cs = TILE * (t.x + (at.endsWith('E') ? 1 : 0));
  const ct = TILE * (t.y + (at.startsWith('N') ? 1 : 0));
  if ((cs !== 0 && cs !== full) || (ct !== 0 && ct !== full)) return null;
  const p = stToDir(t.face, cs === 0 ? -1 : 1, ct === 0 ? -1 : 1);
  return p.map((v) => (v > 0 ? '+' : '-')).join('');
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

/**
 * What `t`'s edge profile along the face edge `edge` and its neighbor's across it disagree on, at
 * each mip: the codes or the shore bytes, entry k against the neighbor's entry k, or its entry
 * (256 >> m) − k where the edge runs reversed. Empty when they match bit for bit.
 */
export function edgeProfileMismatches(
  t: Tile,
  edge: Edge,
  mine: DecodedWst,
  theirs: DecodedWst,
): string[] {
  const other = neighbor(t, edge);
  if (other.tile.face === t.face) throw new Error(`${tileKey(t)} ${edge} is not a face edge`);
  const off: string[] = [];
  for (const mip of MIPS) {
    const own = sideProfile(mine, edge, mip);
    const across = sideProfile(theirs, other.edge, mip);
    const at = (k: number) => (other.reversed ? (TILE >> mip) - k : k);
    if (!own.codes.every((code, k) => code === across.codes[at(k)])) off.push(`mip ${mip} codes`);
    if (!own.shore.every((byte, k) => byte === across.shore[at(k)])) {
      off.push(`mip ${mip} shore bytes`);
    }
  }
  return off;
}

/** A texel corner on a face, in face-global texel corners at the tile's level. */
interface FaceCorner {
  face: number;
  cs: number;
  ct: number;
}

/**
 * The owner of mip-0 corner c (0..256) of `t`'s edge: the lowest-numbered face among the faces
 * that meet at its point (streaming.md 3.0 item 7), and the corner in that face's frame. The
 * pipeline's `profile_owner` (pipeline/src/prebuild/cube.py) addresses the same corner, on one of
 * the tiles `tilesAt` gives.
 */
export function ownerCorner(t: Tile, edge: Edge, c: number): FaceCorner {
  const x0 = TILE * t.x;
  const y0 = TILE * t.y;
  const corners: Record<Edge, [number, number]> = {
    N: [x0 + c, y0 + TILE],
    E: [x0 + TILE, y0 + c],
    S: [x0 + c, y0],
    W: [x0, y0 + c],
  };
  const [cs, ct] = corners[edge];
  const full = TILE * 2 ** t.level;
  const onFaceEdges: Edge[] = [];
  if (ct === full) onFaceEdges.push('N');
  if (cs === full) onFaceEdges.push('E');
  if (ct === 0) onFaceEdges.push('S');
  if (cs === 0) onFaceEdges.push('W');
  let owner: FaceCorner = { face: t.face, cs, ct };
  for (const faceEdge of onFaceEdges) {
    const across = acrossFaceEdge(t.face, faceEdge, cs, ct, full);
    if (across.face < owner.face) owner = across;
  }
  return owner;
}

/** The tiles of `face` at `level` with face-global corner (cs, ct) on or inside their bounds. */
export function tilesAt(face: number, level: number, cs: number, ct: number): Tile[] {
  const last = 2 ** level - 1;
  const spans = (c: number) =>
    [...new Set([Math.floor(c / TILE), Math.ceil(c / TILE) - 1])].filter(
      (i) => i >= 0 && i <= last,
    );
  return spans(cs).flatMap((x) => spans(ct).map((y) => ({ face, level, x, y })));
}

/** Every tile that could hold the owner-frame texels of `t`'s stored entries (see `ownerMeans`). */
export function ownerTiles(t: Tile): Tile[] {
  const found = new Map<string, Tile>();
  for (const edge of storedEdges(t)) {
    for (let c = 0; c <= TILE; c += 1) {
      const { face, cs, ct } = ownerCorner(t, edge, c);
      for (const tile of tilesAt(face, t.level, cs, ct)) found.set(tileKey(tile), tile);
    }
  }
  return [...found.values()];
}

/**
 * The entries of `t`'s stored sides that are not the owner's rha means: each entry of mip m must
 * lie within 0.5, as a real, of the mean of the four mip-m codes around its corner in the owner
 * face's own tile, and its shore byte must be (T + 2) >> 2 of their four shore bytes, whose sum is
 * T. Within a face every tile holding the corner holds the same texels there, so any of them
 * serves; `find` gives one decoded, or undefined when none is at hand, which leaves that entry
 * unchecked. Returns how many entries it checked and a line for each miss.
 */
export function ownerMeans(
  t: Tile,
  mine: DecodedWst,
  find: (tile: Tile) => DecodedWst | undefined,
): { checked: number; misses: string[] } {
  let checked = 0;
  const misses: string[] = [];
  for (const edge of storedEdges(t)) {
    for (const mip of MIPS) {
      const { codes, shore } = sideProfile(mine, edge, mip);
      codes.forEach((code, k) => {
        const { face, cs, ct } = ownerCorner(t, edge, k << mip);
        const holders = tilesAt(face, t.level, cs, ct);
        const owner = holders.map((tile) => ({ tile, decoded: find(tile) })).find((o) => o.decoded);
        if (owner?.decoded === undefined) return;
        checked += 1;
        const around = aroundCorner(owner.tile, owner.decoded, mip, cs, ct);
        const mean = around.codes / 4;
        const byte = (around.shore + 2) >> 2;
        if (Math.abs(code - mean) > 0.5 || shore[k] !== byte) {
          misses.push(
            `${tileKey(t)} ${edge} mip ${mip} entry ${k}: ${code}/${shore[k]}, ` +
              `${tileKey(owner.tile)} has ${mean}/${byte}`,
          );
        }
      });
    }
  }
  return { checked, misses };
}

/** The sums of the four mip-m codes and shore bytes of `tile` around face-global corner cs, ct. */
function aroundCorner(
  tile: Tile,
  decoded: DecodedWst,
  mip: Mip,
  cs: number,
  ct: number,
): { codes: number; shore: number } {
  const size = MIP_SIZES[mip];
  // Tile corner c comes after stored mip-m column (c >> m) + (4 >> m) − 1, and likewise rows.
  const column = ((cs - TILE * tile.x) >> mip) + (BORDER >> mip) - 1;
  const row = ((ct - TILE * tile.y) >> mip) + (BORDER >> mip) - 1;
  let codes = 0;
  let shore = 0;
  for (const [dr, dc] of [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
  ] as const) {
    const at = (row + dr) * size + column + dc;
    codes += codeAt(decoded, mip, at);
    shore += decoded.channelMips[mip][2 * at] ?? NaN;
  }
  return { codes, shore };
}

/** A corner on the face edge `edge` of `face`, in the frame of the face across it. */
function acrossFaceEdge(
  face: number,
  edge: Edge,
  cs: number,
  ct: number,
  full: number,
): FaceCorner {
  const edges = FACE_EDGES[face];
  if (!edges) throw new RangeError(`no face ${face}`);
  const [other, facing, reversed] = edges[edge];
  const along = edge === 'N' || edge === 'S' ? cs : ct;
  const mapped = reversed ? full - along : along;
  const across = facing === 'N' || facing === 'E' ? full : 0;
  return facing === 'N' || facing === 'S'
    ? { face: other, cs: mapped, ct: across }
    : { face: other, cs: across, ct: mapped };
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
