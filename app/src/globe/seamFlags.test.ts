// Seam flags (streaming.md 5.6 rules 1-4): lattice points agree across face edges and cube
// corners, hand-built sets get the flags they should, checkCover refuses what lod.ts must never
// draw, and in random balanced covers every node derives each shared point's group from its own
// bits exactly.
import { describe, expect, test } from 'vitest';
import { EDGES, neighbor, tileKey, type Edge, type Tile } from '../surface/cube';
import { flag } from './instances';
import {
  ancestorAt,
  checkCover,
  CoverError,
  DrawnGroups,
  isTJunction,
  LATTICE,
  latticePoint,
  seamFlags,
  sharedPoint,
  vertexMip,
  type DrawnNode,
} from './seamFlags';
import { GRID_SEGMENTS } from './tileGrid';

const t = (face: number, level: number, x: number, y: number): Tile => ({ face, level, x, y });
const node = (tile: Tile, source = tile.level): DrawnNode => ({ tile, source });
const E: Record<Edge, number> = { N: 0, E: 1, S: 2, W: 3 };

/** The grid point `a` along `edge` of a G-segment grid. */
function onEdge(edge: Edge, a: number, G: number): [number, number] {
  switch (edge) {
    case 'N':
      return [a, G];
    case 'S':
      return [a, 0];
    case 'E':
      return [G, a];
    case 'W':
      return [0, a];
  }
}

describe('latticePoint', () => {
  test.each(Object.entries(GRID_SEGMENTS))('agrees across all 12 face edges (%s)', (_tier, G) => {
    const segments = G;
    for (let face = 0; face < 6; face += 1) {
      for (const edge of EDGES) {
        for (let along = 0; along < 4; along += 1) {
          const [x, y] =
            edge === 'N'
              ? [along, 3]
              : edge === 'S'
                ? [along, 0]
                : edge === 'E'
                  ? [3, along]
                  : [0, along];
          const tile = t(face, 2, x, y);
          const n = neighbor(tile, edge);
          for (let a = 0; a <= G; a += 1) {
            const [k, l] = onEdge(edge, a, G);
            const [k2, l2] = onEdge(n.edge, n.reversed ? G - a : a, G);
            expect(latticePoint(tile, k, l, segments)).toBe(latticePoint(n.tile, k2, l2, segments));
          }
        }
      }
    }
  });

  test('names each of the 8 cube corners once, from all 3 faces', () => {
    const corners = new Map<string, Set<number>>();
    for (let face = 0; face < 6; face += 1) {
      for (const [k, l] of [
        [0, 0],
        [32, 0],
        [0, 32],
        [32, 32],
      ] as const) {
        const key = latticePoint(t(face, 0, 0, 0), k, l, 32);
        corners.set(key, (corners.get(key) ?? new Set()).add(face));
      }
    }
    expect(corners.size).toBe(8);
    expect([...corners.values()].every((faces) => faces.size === 3)).toBe(true);
  });

  test('names the Kirkuk corner the same from faces 0, 1 and 4 at every level', () => {
    for (let level = 0; level <= 7; level += 1) {
      const n = 2 ** level - 1;
      const keys = [
        latticePoint(t(0, level, n, n), 32, 32, 32),
        latticePoint(t(1, level, 0, n), 0, 32, 32),
        latticePoint(t(4, level, n, 0), 32, 0, 32),
      ];
      expect(new Set(keys).size).toBe(1);
    }
  });
});

describe('seamFlags on hand-built sets', () => {
  const flagsOf = (nodes: DrawnNode[], tile: Tile) =>
    seamFlags(nodes, { partial: true }).get(tileKey(tile)) ?? NaN;

  test('same level and source: no flags', () => {
    const a = t(0, 1, 0, 0);
    const b = t(0, 1, 1, 0);
    expect(flagsOf([node(a), node(b)], a)).toBe(0);
  });

  test('2:1: cN on the fine side only', () => {
    const fine = t(0, 2, 1, 1);
    const coarse = t(0, 1, 1, 0);
    const nodes = [node(fine), node(coarse)];
    // fine (2,1,1)'s E edge meets coarse (1,1,0)'s W edge: coarse spans x 2-3, y 0-1 at level 2.
    expect(flagsOf(nodes, fine) & flag.cN(E.E)).toBe(flag.cN(E.E));
    expect(flagsOf(nodes, coarse) & 0xf).toBe(0);
  });

  test('a coarser source across a whole edge: cS on both halves', () => {
    const a = t(0, 2, 1, 1);
    const b = t(0, 2, 2, 1);
    const flags = flagsOf([node(a, 2), node(b, 1)], a);
    expect(flags & (flag.cS0(E.E) | flag.cS1(E.E))).toBe(flag.cS0(E.E) | flag.cS1(E.E));
    expect(flagsOf([node(a, 2), node(b, 1)], b) & 0xff0).toBe(0);
  });

  test('two finer neighbors with different sources split the coarse edge', () => {
    const coarse = t(0, 1, 0, 0); // x 0-1, y 0-1 at level 2
    const low = t(0, 2, 2, 0); // across coarse's E edge, first half (y 0)
    const high = t(0, 2, 2, 1); // second half (y 1)
    const nodes = [node(coarse, 1), node(low, 0), node(high, 1)];
    const flags = flagsOf(nodes, coarse);
    expect(flags & flag.cS0(E.E)).toBe(flag.cS0(E.E));
    expect(flags & flag.cS1(E.E)).toBe(0);
  });

  test('a coarser source only through the diagonal sets the corner, not the edges', () => {
    // Four level-2 nodes around the point (x, y) = (2, 2) of face 0; the diagonal one has s − 1.
    const a = t(0, 2, 1, 1);
    const nodes = [
      node(a, 2),
      node(t(0, 2, 2, 1), 2),
      node(t(0, 2, 1, 2), 2),
      node(t(0, 2, 2, 2), 1),
    ];
    const flags = flagsOf(nodes, a);
    expect(flags & flag.cornerCS(3)).toBe(flag.cornerCS(3));
    expect(flags & 0xff0).toBe(0);
  });

  test('dN 1 and dN 2 through a diagonal', () => {
    // a at level 3; its N and E neighbors at level 2; the diagonal NE at level 1.
    const a = t(0, 3, 3, 3); // x 3-4, y 3-4 at level 3
    const north = t(0, 2, 1, 2); // x 2-4, y 4-6
    const east = t(0, 2, 2, 1); // x 4-6, y 2-4
    const diagonal = t(0, 1, 1, 1); // x 4-8, y 4-8
    // Sources within one level of each other, as touching nodes need.
    const nodes = [node(a, 2), node(north, 2), node(east, 2), node(diagonal, 1)];
    expect((flagsOf(nodes, a) >>> (13 + 3 * 3)) & 3).toBe(2);
    expect((flagsOf(nodes, north) >>> (13 + 3 * 1)) & 3).toBe(1);
  });

  test('a cube corner: three nodes, one with a coarser source', () => {
    const a = t(0, 1, 1, 1);
    const b = t(1, 1, 0, 1);
    const c = t(4, 1, 1, 0);
    const nodes = [node(a, 1), node(b, 1), node(c, 0)];
    expect(flagsOf(nodes, a) & flag.cornerCS(3)).toBe(flag.cornerCS(3));
    expect(flagsOf(nodes, b) & flag.cornerCS(2)).toBe(flag.cornerCS(2));
    expect(flagsOf(nodes, c) & flag.cornerCS(1)).toBe(0);
  });

  test("a coarse edge's midpoint: the two finer nodes see it as a dN-1 corner", () => {
    const coarse = t(0, 1, 0, 0);
    const low = t(0, 2, 2, 0);
    const high = t(0, 2, 2, 1);
    const nodes = [node(coarse), node(low), node(high)];
    // The midpoint is low's NW corner and high's SW corner.
    expect((flagsOf(nodes, low) >>> (13 + 3 * 2)) & 3).toBe(1);
    expect((flagsOf(nodes, high) >>> (13 + 3 * 0)) & 3).toBe(1);
  });
});

describe('checkCover refuses', () => {
  test('a node drawn with its ancestor', () => {
    expect(() => checkCover([node(t(0, 1, 0, 0)), node(t(0, 2, 1, 1))], { partial: true })).toThrow(
      /overlaps its ancestor/,
    );
  });

  test('a hole, unless partial', () => {
    const five = [0, 1, 2, 3, 4].map((face) => node(t(face, 0, 0, 0)));
    expect(() => checkCover(five)).toThrow(/hole/);
    expect(() => checkCover(five, { partial: true })).not.toThrow();
  });

  test('node levels 2 apart across an edge', () => {
    expect(() => checkCover([node(t(0, 3, 3, 0)), node(t(0, 1, 1, 0))], { partial: true })).toThrow(
      /node levels 2 apart/,
    );
  });

  test('sources 2 apart across an edge', () => {
    expect(() =>
      checkCover([node(t(0, 2, 1, 1), 2), node(t(0, 2, 2, 1), 0)], { partial: true }),
    ).toThrow(/sources 2 apart/);
  });

  test('sources 2 apart across a corner only', () => {
    expect(() =>
      checkCover([node(t(0, 2, 1, 1), 2), node(t(0, 2, 2, 2), 0)], { partial: true }),
    ).toThrow(/sources 2 apart/);
  });

  test('a source finer than the node', () => {
    expect(() => checkCover([node(t(0, 1, 0, 0), 2)], { partial: true })).toThrow(/source level 2/);
  });

  test('the same node twice', () => {
    expect(() => checkCover([node(t(0, 1, 0, 0)), node(t(0, 1, 0, 0))], { partial: true })).toThrow(
      CoverError,
    );
  });
});

describe.each(Object.entries(GRID_SEGMENTS))('isTJunction (%s)', (_tier, G) => {
  const segments = G;
  const fine = t(0, 2, 1, 1);
  const coarse = t(0, 1, 1, 0);
  const flags = seamFlags([node(fine), node(coarse)], { partial: true });
  const fineFlags = flags.get(tileKey(fine)) ?? NaN;
  const coarseFlags = flags.get(tileKey(coarse)) ?? NaN;

  test('holds for the odd vertices of the fine side of a 2:1 edge, not its corners', () => {
    for (let a = 0; a <= G; a += 1) {
      expect(isTJunction(fineFlags, G, a, segments), `a = ${a}`).toBe(
        a > 0 && a < G && a % 2 === 1,
      );
    }
  });

  test('holds nowhere else', () => {
    for (let a = 0; a <= G; a += 1) {
      expect(isTJunction(fineFlags, 0, a, segments)).toBe(false);
      expect(isTJunction(fineFlags, a, G, segments)).toBe(false);
      expect(isTJunction(coarseFlags, 0, a, segments)).toBe(false);
    }
  });
});

test('vertexMip is clamp(7 − log2 G − (coarse − sample), 0, 2)', () => {
  expect(vertexMip(32, 5, 5)).toBe(2);
  expect(vertexMip(32, 5, 4)).toBe(1);
  expect(vertexMip(32, 5, 3)).toBe(0);
  expect(vertexMip(32, 7, 2)).toBe(0);
  expect(vertexMip(16, 5, 5)).toBe(2);
  expect(vertexMip(16, 5, 4)).toBe(2);
  expect(vertexMip(16, 5, 3)).toBe(1);
});

// Random balanced covers, built the way lod.ts will: split, balance node levels across edges by
// splitting the coarser node, then demote finer sources until touching sources are within one.

function random(seed: number) {
  let state = seed >>> 0;
  return (below: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.floor((state / 2 ** 32) * below);
  };
}

function children(tile: Tile): Tile[] {
  return [0, 1, 2, 3].map((i) =>
    t(tile.face, tile.level + 1, 2 * tile.x + (i & 1), 2 * tile.y + (i >> 1)),
  );
}

/** Every drawn node touching `tile` at an edge (quarter points) or a corner. */
function touching(tile: Tile, groups: DrawnGroups): { other: DrawnNode; edge: boolean }[] {
  const span = LATTICE >> tile.level;
  const x0 = tile.x * span;
  const y0 = tile.y * span;
  const points: [number, number, boolean][] = [];
  for (const q of [span / 4, (3 * span) / 4]) {
    points.push(
      [x0 + q, y0 + span, true],
      [x0 + q, y0, true],
      [x0 + span, y0 + q, true],
      [x0, y0 + q, true],
    );
  }
  for (const [cx, cy] of [
    [0, 0],
    [span, 0],
    [0, span],
    [span, span],
  ] as const) {
    points.push([x0 + cx, y0 + cy, false]);
  }
  return points.flatMap(([X, Y, edge]) =>
    groups.at(tile.face, X, Y).map((other) => ({ other, edge })),
  );
}

function randomCover(
  next: (below: number) => number,
  maxLevel: number,
  splits: number,
): DrawnNode[] {
  const tiles = new Map<string, Tile>(
    [0, 1, 2, 3, 4, 5].map((face) => [tileKey(t(face, 0, 0, 0)), t(face, 0, 0, 0)]),
  );
  const split = (key: string) => {
    const tile = tiles.get(key);
    if (!tile) return;
    tiles.delete(key);
    for (const child of children(tile)) tiles.set(tileKey(child), child);
  };
  for (let i = 0; i < splits; i += 1) {
    const candidates = [...tiles.values()].filter((tile) => tile.level < maxLevel);
    const pick = candidates[next(candidates.length)];
    if (pick) split(tileKey(pick));
  }
  for (let changed = true; changed;) {
    changed = false;
    const groups = new DrawnGroups([...tiles.values()].map((tile) => node(tile)));
    for (const tile of [...tiles.values()]) {
      for (const { other, edge } of touching(tile, groups)) {
        if (edge && other.tile.level < tile.level - 1 && tiles.has(tileKey(other.tile))) {
          split(tileKey(other.tile));
          changed = true;
        }
      }
    }
  }
  const nodes = [...tiles.values()].map((tile) => node(tile, Math.max(0, tile.level - next(3))));
  for (let changed = true; changed;) {
    changed = false;
    const groups = new DrawnGroups(nodes);
    for (const n of nodes) {
      for (const { other } of touching(n.tile, groups)) {
        if (n.source > other.source + 1) {
          n.source = other.source + 1;
          changed = true;
        }
      }
    }
  }
  return nodes;
}

// About 1.5 s on the M5 and 3.5 times that on a CI runner, past Vitest's default 5 s.
const PROPERTY_TIMEOUT = 30_000;

describe.each(Object.entries(GRID_SEGMENTS))('random balanced covers (%s)', (tier, G) => {
  const segments = G;

  test(
    'every node derives each shared point’s coarsest node and source from its own bits',
    () => {
      const next = random(tier === 'full' ? 1 : 2);
      for (let cover = 0; cover < 60; cover += 1) {
        const nodes = randomCover(next, 4, 6 + next(20));
        const flags = seamFlags(nodes);
        const groups = new DrawnGroups(nodes);
        const truth = new Map<string, { coarse: number; lv: number }>();
        for (const n of nodes) {
          const bits = flags.get(tileKey(n.tile)) ?? NaN;
          const span = LATTICE >> n.tile.level;
          for (let a = 0; a <= segments; a += 1) {
            for (const edge of EDGES) {
              const [k, l] = onEdge(edge, a, segments);
              if (isTJunction(bits, k, l, segments)) continue;
              const key = latticePoint(n.tile, k, l, segments);
              let expected = truth.get(key);
              if (!expected) {
                const X = n.tile.x * span + (k * span) / segments;
                const Y = n.tile.y * span + (l * span) / segments;
                const group = groups.at(n.tile.face, X, Y);
                expected = {
                  coarse: Math.min(...group.map((g) => g.tile.level)),
                  lv: Math.min(...group.map((g) => g.source)),
                };
                truth.set(key, expected);
              }
              const derived = sharedPoint(n, bits, k, l, segments);
              expect(
                { coarse: derived.coarse, lv: derived.lv },
                `${tileKey(n.tile)} at ${k},${l}`,
              ).toEqual(expected);
            }
          }
        }
      }
    },
    PROPERTY_TIMEOUT,
  );
});

test('ancestorAt shifts x and y by the level difference', () => {
  expect(ancestorAt(t(3, 5, 21, 30), 2)).toEqual(t(3, 2, 2, 3));
});
