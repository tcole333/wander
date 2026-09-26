// Seams in the fixture's surface layer (streaming.md 3.1 Edges, 7.3), checked on what the decoder
// hands the GPU with the checks in ../test/seams.ts: within a face on the 24 L1 pairs and the
// Sumbawa L7 pair, and on every L0 and L1 face edge and at the Kirkuk corner, the edge profiles
// at every mip, where they meet, what their owners hold and the border texels past the edge.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadSurfaceTile, readSurfaceRecord, type FixtureTile } from '../test/fixture';
import {
  FIXTURE_CROSS_FACE,
  MIPS,
  TILE_CORNERS,
  cornerEntries,
  crossFaceMisses,
  cubeCornerOf,
  edgeProfileMismatches,
  ownerMeans,
  storedEdges,
  tileCornerMismatches,
  withinFaceMismatches,
} from '../test/seams';
import { EDGES, neighbor, tileKey, type Edge, type Tile } from './cube';
import { EDGE_ENTRIES, PROFILE_ENTRIES } from './wst';

const SUMBAWA_WEST: Tile = { face: 1, level: 7, x: 102, y: 50 };
const SUMBAWA_EAST: Tile = { face: 1, level: 7, x: 103, y: 50 };
const KIRKUK_LEVELS = [2, 3, 4, 5, 6, 7];

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
      expect(withinFaceMismatches(tile(a).decoded, tile(b).decoded, side)).toEqual([]);
    },
  );

  it('a side stores no edge profile, so its rows of the edge texture are 0', () => {
    const inFace = fixtureTiles().flatMap((t) =>
      EDGES.filter((edge) => !storedEdges(t).includes(edge)).map((edge) => [t, edge] as const),
    );
    const written = inFace.filter(([t, edge]) =>
      MIPS.some((mip) => {
        const row = (EDGES.length * mip + EDGES.indexOf(edge)) * EDGE_ENTRIES;
        return tile(t)
          .decoded.edges.subarray(2 * row, 2 * (row + EDGE_ENTRIES))
          .some(Boolean);
      }),
    );
    expect(written.map(([t, edge]) => `${tileKey(t)} ${edge}`)).toEqual([]);
    // Two sides of each L1 and Kirkuk tile, and all four of the Sumbawa pair.
    expect(inFace).toHaveLength(24 * 2 + 18 * 2 + 2 * 4);
  });
});

describe('across a face edge', () => {
  it('edge profiles match at every mip, codes and shore bytes, reversed edges included', () => {
    const checked = faceEdges();
    const off = checked.flatMap(([t, edge]) =>
      edgeProfileMismatches(t, edge, tile(t).decoded, tile(neighbor(t, edge).tile).decoded).map(
        (what) => `${tileKey(t)} ${edge}: ${what}`,
      ),
    );
    expect(off).toEqual([]);
    // Each L0 tile has four face edges, each L1 tile two, and each Kirkuk tile two. The four
    // reversed face edges are checked from both sides, once at L0 and twice at L1.
    expect(checked).toHaveLength(6 * 4 + 24 * 2 + 3 * 2 * KIRKUK_LEVELS.length);
    expect(checked.filter(([t, edge]) => neighbor(t, edge).reversed)).toHaveLength(4 * 2 * 3);
  });

  it("each tile's stored sides hold the same entry where they meet, at every mip", () => {
    expect(fixtureTiles().flatMap((t) => tileCornerMismatches(tile(t).decoded))).toEqual([]);
  });

  it('the three tiles at each cube corner hold the same entry there, at every mip', () => {
    const corners = new Map<string, string[]>();
    for (const t of fixtureTiles()) {
      for (const at of TILE_CORNERS) {
        const cube = cubeCornerOf(t, at);
        if (cube === null) continue;
        for (const mip of MIPS) {
          const key = `L${t.level} ${cube} mip ${mip}`;
          corners.set(key, [
            ...(corners.get(key) ?? []),
            ...cornerEntries(tile(t).decoded, at, mip),
          ]);
        }
      }
    }
    const off = [...corners].filter(
      ([, entries]) => entries.length !== 3 * 2 || new Set(entries).size !== 1,
    );
    expect(off.map(([key, entries]) => `${key}: ${entries.join(', ')}`)).toEqual([]);
    // All eight at L0 and at L1, and the Kirkuk corner at L2-L7, where faces 0, 1 and 4 meet.
    expect(corners.size).toBe((8 + 8 + KIRKUK_LEVELS.length) * MIPS.length);
    expect(KIRKUK_LEVELS.every((level) => corners.has(`L${level} +++ mip 0`))).toBe(true);
  });

  it("each entry lies within 0.5 of the owner's mean of the four mip-m texels around it", () => {
    let checked = 0;
    const misses: string[] = [];
    for (const t of fixtureTiles()) {
      const found = ownerMeans(t, tile(t).decoded, (owner) => tiles.get(tileKey(owner))?.decoded);
      checked += found.checked;
      misses.push(...found.misses);
    }
    expect(misses).toEqual([]);
    // The fixture holds a tile of the owner face for every entry of every stored side.
    expect(checked).toBe((6 * 4 + 24 * 2 + 18 * 2) * PROFILE_ENTRIES);
  });

  it('border texels map into neighbor column k, near the codes around them', () => {
    const off = faceEdges().flatMap(([t, edge]) =>
      crossFaceMisses(
        t,
        edge,
        tile(t).decoded,
        tile(neighbor(t, edge).tile).decoded,
        FIXTURE_CROSS_FACE,
      ),
    );
    expect(off).toEqual([]);
  });
});
