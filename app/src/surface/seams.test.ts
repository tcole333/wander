// Seams in the fixture's surface layer (streaming.md 3.1 Edges, 7.3), checked on what the decoder
// hands the GPU with the checks in ../test/seams.ts: within a face on the 24 L1 pairs and the
// Sumbawa L7 pair, and across a face edge on every L0 and L1 face edge and at the Kirkuk corner.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadSurfaceTile, readSurfaceRecord, type FixtureTile } from '../test/fixture';
import {
  LAST_ENTRY,
  crossFaceMisses,
  edgeCodes,
  edgeProfileMatches,
  withinFaceMismatches,
} from '../test/seams';
import { EDGES, neighbor, tileKey, type Edge, type Tile } from './cube';

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

/** Edge profile entries 0..256 as the GPU sees them. */
function edges(t: Tile, edge: Edge): number[] {
  return edgeCodes(tile(t).decoded, edge);
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

  it.each(WITHIN_FACE.map(([a, b, side]) => [tileKey(a), tileKey(b), side, a, b] as const))(
    '%s and %s share their edge profile',
    (_, __, side, a, b) => {
      expect(edges(a, side)).toEqual(edges(b, side === 'E' ? 'W' : 'S'));
    },
  );

  it.each([0, 1, 2, 3, 4, 5])('the four L1 tiles of face %i agree at its center', (face) => {
    const sw = { face, level: 1, x: 0, y: 0 };
    const se = { face, level: 1, x: 1, y: 0 };
    const nw = { face, level: 1, x: 0, y: 1 };
    const ne = { face, level: 1, x: 1, y: 1 };
    const entries = [
      edges(sw, 'N')[LAST_ENTRY],
      edges(sw, 'E')[LAST_ENTRY],
      edges(se, 'N')[0],
      edges(se, 'W')[LAST_ENTRY],
      edges(nw, 'S')[LAST_ENTRY],
      edges(nw, 'E')[0],
      edges(ne, 'S')[0],
      edges(ne, 'W')[0],
    ];
    expect(new Set(entries).size).toBe(1);
  });
});

describe('across a face edge', () => {
  it('edge profiles match on every L0 and L1 face edge and at the Kirkuk corner', () => {
    const checked = faceEdges();
    const off = checked.filter(
      ([t, edge]) =>
        !edgeProfileMatches(t, edge, tile(t).decoded, tile(neighbor(t, edge).tile).decoded),
    );
    expect(off.map(([t, edge]) => `${tileKey(t)} ${edge}`)).toEqual([]);
    // Each L0 tile has four face edges, each L1 tile two, and each Kirkuk tile two.
    expect(checked).toHaveLength(6 * 4 + 24 * 2 + 3 * 2 * KIRKUK_LEVELS.length);
  });

  it.each(KIRKUK_LEVELS)('the three Kirkuk tiles at L%i share their edges and vertex', (level) => {
    const [face0, face1, face4] = kirkukTiles(level) as [Tile, Tile, Tile];
    expect(edges(face0, 'N')).toEqual(edges(face4, 'S'));
    expect(edges(face0, 'E')).toEqual(edges(face1, 'W'));
    expect(edges(face1, 'N')).toEqual(edges(face4, 'E'));
    const vertex = [edges(face0, 'N')[LAST_ENTRY], edges(face1, 'N')[0], edges(face4, 'E')[0]];
    expect(new Set(vertex).size).toBe(1);
  });

  it('border texels map into neighbor column k, near the codes around them', () => {
    const off = faceEdges().flatMap(([t, edge]) =>
      crossFaceMisses(t, edge, tile(t).decoded, tile(neighbor(t, edge).tile).decoded),
    );
    expect(off).toEqual([]);
  });
});
