// Seams in the fixture's surface layer (streaming.md 3.1 Edges, 7.3), checked on what the decoder
// hands the GPU. Within a face, border texels equal the neighbor's interior at mips 0-2 and edge
// profiles match, bit for bit. Across a face edge, edge profiles match bit for bit, and each border
// texel maps into the neighbor's texel column k with a code close to the neighbor's around it.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadSurfaceTile, readSurfaceRecord, type FixtureTile } from '../test/fixture';
import {
  BORDER,
  EDGES,
  TILE,
  faceSt,
  neighbor,
  stToDir,
  texelCenter,
  tileKey,
  type Edge,
  type Tile,
} from './cube';
import { EDGE_ENTRIES, MIP_SIZES, SIZE } from './wst';

const EDGE_INDEX: Readonly<Record<Edge, number>> = { N: 0, E: 1, S: 2, W: 3 };
const LAST = EDGE_ENTRIES - 1;
const SUMBAWA_WEST: Tile = { face: 1, level: 7, x: 102, y: 50 };
const SUMBAWA_EAST: Tile = { face: 1, level: 7, x: 103, y: 50 };
const KIRKUK_LEVELS = [2, 3, 4, 5, 6, 7];
// Across a face edge a border code may miss the neighbor's 3×3 codes around the mapped point: the
// grids meet at an angle, so their texels cover different ground, and the coastal clamp reads each
// grid's own shore distance. The bound (streaming.md 7.3) widens that range by 2 codes plus half
// its width, and to 0 where the clamp reaches the border texel. The range ± 2 codes alone misses
// 39 of the 110,592 border texels checked here, by up to 14 codes where the range spans 153, on the
// Kirkuk tiles whose sources are coarser than their texels (4′ for 4.9 km at L3, 1′ at L5-L6).
const CROSS_FACE_CODES = 2;
const CLAMP_REACH_BYTES = 32; // 2 texels of shore distance, 16 bytes per texel around 128

const record = readSurfaceRecord();
const tiles = new Map<string, FixtureTile>();

function fixtureTiles(): Tile[] {
  const found: Tile[] = [];
  for (const level of [0, 1]) {
    for (let face = 0; face < 6; face += 1) {
      for (let y = 0; y < 2 ** level; y += 1) {
        for (let x = 0; x < 2 ** level; x += 1) found.push({ face, level, x, y });
      }
    }
  }
  return [...found, ...KIRKUK_LEVELS.flatMap(kirkukTiles), SUMBAWA_WEST, SUMBAWA_EAST];
}

beforeAll(async () => {
  for (const t of fixtureTiles()) tiles.set(tileKey(t), await loadSurfaceTile(record, tileKey(t)));
});

function tile(t: Tile): FixtureTile {
  const found = tiles.get(tileKey(t));
  if (!found) throw new Error(`the fixture has no tile ${tileKey(t)}`);
  return found;
}

/** The integer an IEEE half-float holds, for the whole numbers within ±2048 the decoder writes. */
function halfToInt(bits: number): number {
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  const magnitude =
    exponent === 0 ? fraction / 2 ** 24 : (1 + fraction / 1024) * 2 ** (exponent - 15);
  return bits & 0x8000 ? -magnitude : magnitude;
}

/** Height codes of a mip as the GPU sees them, offset + codeMid. */
function mipCodes(t: Tile, mip: 0 | 1 | 2): Int32Array {
  const { decoded } = tile(t);
  return Int32Array.from(
    decoded.heightMips[mip],
    (bits) => halfToInt(bits) + decoded.header.codeMid,
  );
}

/** (shore, water) of a mip as the GPU sees them. */
function mipChannels(t: Tile, mip: 0 | 1 | 2): Uint8Array {
  return tile(t).decoded.channelMips[mip];
}

/** Edge profile entries 0..256 as the GPU sees them, offset + codeMid. */
function edgeCodes(t: Tile, edge: Edge): number[] {
  const { decoded } = tile(t);
  const start = EDGE_INDEX[edge] * EDGE_ENTRIES;
  return Array.from(
    decoded.edges.subarray(start, start + EDGE_ENTRIES),
    (bits) => halfToInt(bits) + decoded.header.codeMid,
  );
}

/**
 * The texels a mip shares across an edge: the columns (E) or rows (N) of the last 2b of the first
 * tile and the first 2b of the second, b the mip's border, with `width` values per texel.
 */
function sharedBand(
  values: ArrayLike<number>,
  mip: 0 | 1 | 2,
  width: number,
  side: 'E' | 'N',
  first: boolean,
): number[] {
  const size = MIP_SIZES[mip];
  const band = 2 * (BORDER >> mip);
  const start = first ? size - band : 0;
  const out: number[] = [];
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < band; c += 1) {
      const [row, col] = side === 'E' ? [r, start + c] : [start + c, r];
      for (let w = 0; w < width; w += 1) out.push(values[(row * size + col) * width + w] ?? NaN);
    }
  }
  return out;
}

function kirkukTiles(level: number): Tile[] {
  const n = 2 ** level;
  return [
    { face: 0, level, x: n - 1, y: n - 1 },
    { face: 1, level, x: 0, y: n - 1 },
    { face: 4, level, x: n - 1, y: 0 },
  ];
}

/** Within-face neighbors: the 24 pairs at L1 and the Sumbawa pair at L7. */
const WITHIN_FACE: [Tile, Tile, 'E' | 'N'][] = [
  ...[0, 1, 2, 3, 4, 5].flatMap((face) =>
    [0, 1].flatMap((k): [Tile, Tile, 'E' | 'N'][] => [
      [{ face, level: 1, x: 0, y: k }, { face, level: 1, x: 1, y: k }, 'E'],
      [{ face, level: 1, x: k, y: 0 }, { face, level: 1, x: k, y: 1 }, 'N'],
    ]),
  ),
  [SUMBAWA_WEST, SUMBAWA_EAST, 'E'],
];

/** Every (tile, edge) of the L0 and L1 tiles and the Kirkuk corner tiles on a face edge. */
function faceEdges(): [Tile, Edge][] {
  const found: [Tile, Edge][] = [];
  for (const t of fixtureTiles()) {
    for (const edge of EDGES) {
      if (neighbor(t, edge).tile.face !== t.face) found.push([t, edge]);
    }
  }
  return found;
}

describe('within a face', () => {
  it.each(WITHIN_FACE.map(([a, b, side]) => [tileKey(a), tileKey(b), side, a, b] as const))(
    '%s and %s share their border texels at mips 0-2',
    (_, __, side, a, b) => {
      for (const mip of [0, 1, 2] as const) {
        expect(sharedBand(mipCodes(a, mip), mip, 1, side, true)).toEqual(
          sharedBand(mipCodes(b, mip), mip, 1, side, false),
        );
        expect(sharedBand(mipChannels(a, mip), mip, 2, side, true)).toEqual(
          sharedBand(mipChannels(b, mip), mip, 2, side, false),
        );
      }
    },
  );

  it.each(WITHIN_FACE.map(([a, b, side]) => [tileKey(a), tileKey(b), side, a, b] as const))(
    '%s and %s share their edge profile',
    (_, __, side, a, b) => {
      expect(edgeCodes(a, side)).toEqual(edgeCodes(b, side === 'E' ? 'W' : 'S'));
    },
  );

  it.each([0, 1, 2, 3, 4, 5])('the four L1 tiles of face %i agree at its center', (face) => {
    const sw = { face, level: 1, x: 0, y: 0 };
    const se = { face, level: 1, x: 1, y: 0 };
    const nw = { face, level: 1, x: 0, y: 1 };
    const ne = { face, level: 1, x: 1, y: 1 };
    const entries = [
      edgeCodes(sw, 'N')[LAST],
      edgeCodes(sw, 'E')[LAST],
      edgeCodes(se, 'N')[0],
      edgeCodes(se, 'W')[LAST],
      edgeCodes(nw, 'S')[LAST],
      edgeCodes(nw, 'E')[0],
      edgeCodes(ne, 'S')[0],
      edgeCodes(ne, 'W')[0],
    ];
    expect(new Set(entries).size).toBe(1);
  });
});

describe('across a face edge', () => {
  it('edge profiles match on every L0 and L1 face edge and at the Kirkuk corner', () => {
    const checked = faceEdges();
    const off = checked.filter(([t, edge]) => {
      const other = neighbor(t, edge);
      const theirs = edgeCodes(other.tile, other.edge);
      const mine = edgeCodes(t, edge);
      return mine.some((code, k) => code !== theirs[other.reversed ? LAST - k : k]);
    });
    expect(off.map(([t, edge]) => `${tileKey(t)} ${edge}`)).toEqual([]);
    // Each L0 tile has four face edges, each L1 tile two, and each Kirkuk tile two.
    expect(checked).toHaveLength(6 * 4 + 24 * 2 + 3 * 2 * KIRKUK_LEVELS.length);
  });

  it.each(KIRKUK_LEVELS)('the three Kirkuk tiles at L%i share their edges and vertex', (level) => {
    const [face0, face1, face4] = kirkukTiles(level) as [Tile, Tile, Tile];
    expect(edgeCodes(face0, 'N')).toEqual(edgeCodes(face4, 'S'));
    expect(edgeCodes(face0, 'E')).toEqual(edgeCodes(face1, 'W'));
    expect(edgeCodes(face1, 'N')).toEqual(edgeCodes(face4, 'E'));
    const vertex = [
      edgeCodes(face0, 'N')[LAST],
      edgeCodes(face1, 'N')[0],
      edgeCodes(face4, 'E')[0],
    ];
    expect(new Set(vertex).size).toBe(1);
  });

  it('border texels map into neighbor column k, near the codes around them', () => {
    const off: string[] = [];
    for (const [t, edge] of faceEdges()) {
      const other = neighbor(t, edge);
      const codes = mipCodes(t, 0);
      const shore = mipChannels(t, 0);
      const theirs = mipCodes(other.tile, 0);
      for (let k = 0; k < BORDER; k += 1) {
        for (let along = 0; along < TILE; along += 1) {
          const [i, j] = borderTexel(edge, k, along);
          const [si, sj] = mappedTexel(t, i, j, other.tile);
          const column = { W: si, E: TILE - 1 - si, S: sj, N: TILE - 1 - sj }[other.edge];
          const at = (j + BORDER) * SIZE + (i + BORDER);
          const code = codes[at] ?? NaN;
          const nearShore = Math.abs((shore[2 * at] ?? NaN) - 128) <= CLAMP_REACH_BYTES;
          const [low, high] = range3x3(theirs, si, sj, nearShore);
          const slack = CROSS_FACE_CODES + (high - low) / 2;
          if (column !== k || code < low - slack || code > high + slack) {
            off.push(`${tileKey(t)} ${edge} k=${k} along=${along}: ${code} vs ${low}..${high}`);
          }
        }
      }
    }
    expect(off).toEqual([]);
  });
});

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

/** The lowest and highest of the 3×3 stored codes around tile-local texel (i, j), taking in 0 when
 * the coastal clamp may have set the border texel there. */
function range3x3(codes: Int32Array, i: number, j: number, withZero: boolean): [number, number] {
  let low = withZero ? 0 : Infinity;
  let high = withZero ? 0 : -Infinity;
  for (let dj = -1; dj <= 1; dj += 1) {
    for (let di = -1; di <= 1; di += 1) {
      const code = codes[(j + dj + BORDER) * SIZE + (i + di + BORDER)];
      if (code === undefined) throw new RangeError(`texel (${i + di}, ${j + dj}) is not stored`);
      low = Math.min(low, code);
      high = Math.max(high, code);
    }
  }
  return [low, high];
}
