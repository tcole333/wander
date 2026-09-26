import { readFileSync } from 'node:fs';
import constants from '@shared/constants.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';
import {
  EDGES,
  FACE_EDGES,
  FACES,
  TILE,
  availGet,
  corner,
  dirToLonLat,
  faceEdgeSides,
  faceOf,
  faceSt,
  lonLatToDir,
  neighbor,
  nodeCount,
  nodeFromIndex,
  nodeIndex,
  parseTileKey,
  stToDir,
  subpixelCenter,
  subsample,
  texelCenter,
  texelOf,
  tileKey,
  tileOf,
  toThree,
  type Edge,
  type Tile,
  type Vec3,
} from './cube';

const designDoc = readFileSync(
  new URL('../../../docs/design/streaming.md', import.meta.url),
  'utf8',
);

const LEVELS = [0, 1, 2, 3, 4, 5, 6, 7];

// mulberry32: a small seeded generator, so every run checks the same points.
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function maxDiff(a: readonly number[], b: readonly number[]): number {
  return Math.max(...a.map((value, k) => Math.abs(value - (b[k] ?? NaN))));
}

function* allTiles(maxLevel: number): Generator<Tile> {
  for (let level = 0; level <= maxLevel; level += 1) {
    const side = 2 ** level;
    for (let face = 0; face < 6; face += 1) {
      for (let y = 0; y < side; y += 1) {
        for (let x = 0; x < side; x += 1) yield { face, level, x, y };
      }
    }
  }
}

/** (s-like, t-like): N and S edges run along s, E and W along t. */
function edgePoint(edge: Edge, along: number, across: number): [number, number] {
  return edge === 'N' || edge === 'S' ? [along, across] : [across, along];
}

/** Direction of entry k (0..256) along a tile's edge: N and S run along s, E and W along t. */
function edgeEntry(t: Tile, edge: Edge, k: number): Vec3 {
  const gx = TILE * t.x;
  const gy = TILE * t.y;
  const [cs, ct] =
    edge === 'N'
      ? [gx + k, gy + TILE]
      : edge === 'S'
        ? [gx + k, gy]
        : edge === 'E'
          ? [gx + TILE, gy + k]
          : [gx, gy + k];
  return stToDir(t.face, corner(t.level, cs), corner(t.level, ct));
}

const faceEdgeEntries = FACE_EDGES.flatMap((edges, face) =>
  EDGES.map((edge) => ({ face, edge, to: edges[edge] })),
);

describe('face frames', () => {
  it('are the shared constants table', () => {
    expect(FACES.map(({ c, u, v }) => ({ c, u, v }))).toEqual(constants.cube.faces);
  });

  it.each(FACES.map((frame, face) => ({ face, ...frame })))(
    'face $face is orthonormal with U × V = C',
    ({ c, u, v }) => {
      expect([dot(c, c), dot(u, u), dot(v, v), dot(c, u), dot(c, v), dot(u, v)]).toEqual([
        1, 1, 1, 0, 0, 0,
      ]);
      expect(cross(u, v).map((value) => value + 0)).toEqual(c);
    },
  );
});

describe('projection', () => {
  it('round-trips longitude and latitude through a direction', () => {
    const next = random(1);
    let worst = 0;
    for (let k = 0; k < 100_000; k += 1) {
      const lon = next() * 360 - 180;
      const lat = (Math.asin(next() * 2 - 1) * 180) / Math.PI;
      const [lon2, lat2] = dirToLonLat(lonLatToDir(lon, lat));
      const dLon = Math.abs(((lon2 - lon + 540) % 360) - 180);
      worst = Math.max(worst, dLon, Math.abs(lat2 - lat));
    }
    expect(worst).toBeLessThanOrEqual(1e-12);
  });

  it('round-trips (s, t) through a direction on every face', () => {
    const next = random(2);
    let worst = 0;
    for (let k = 0; k < 100_000; k += 1) {
      const face = Math.floor(next() * 6);
      const s = next() * 2 - 1;
      const t = next() * 2 - 1;
      const p = stToDir(face, s, t);
      worst = Math.max(worst, maxDiff(faceSt(face, p), [s, t]));
      worst = Math.max(worst, maxDiff(stToDir(face, ...faceSt(faceOf(p), p)), p));
    }
    expect(worst).toBeLessThanOrEqual(1e-12);
  });

  it('puts points inside a face on that face', () => {
    const next = random(3);
    for (let k = 0; k < 10_000; k += 1) {
      const face = Math.floor(next() * 6);
      const p = stToDir(face, (next() * 2 - 1) * 0.999999, (next() * 2 - 1) * 0.999999);
      expect(faceOf(p)).toBe(face);
    }
  });

  it.each([
    { p: [1, 1, 0], face: 0 },
    { p: [-1, 1, 0], face: 1 },
    { p: [1, 1, 1], face: 0 },
    { p: [-1, -1, 0], face: 2 },
    { p: [0, -1, -1], face: 3 },
    { p: [0, 1, 1], face: 1 },
    { p: [-1, 0, 1], face: 2 },
    { p: [0, 0, -1], face: 5 },
  ] as { p: Vec3; face: number }[])('gives a tie at $p to face $face', ({ p, face }) => {
    expect(faceOf(p)).toBe(face);
  });

  it('maps G to three.js space with north up and longitude 0 toward +Z', () => {
    expect(toThree([1, 0, 0])).toEqual([0, 0, 1]);
    expect(toThree([0, 1, 0])).toEqual([1, 0, 0]);
    expect(toThree([0, 0, 1])).toEqual([0, 1, 0]);
  });
});

describe('exact positions', () => {
  // (numerator − denominator)/denominator is exact for an integer numerator and a power-of-two
  // denominator, so equality proves the functions return the exact binary fraction.
  it.each(LEVELS)('are exact binary fractions at level %i', (level) => {
    const n = 2 ** level;
    const inexact: string[] = [];
    for (let g = -4; g < 256 * n + 4; g += 1) {
      if (texelCenter(level, g) !== (2 * g + 1 - 256 * n) / (256 * n)) inexact.push(`texel ${g}`);
      for (let a = 0; a < 4; a += 1) {
        const exact = (8 * g + 2 * a + 1 - 1024 * n) / (1024 * n);
        if (subsample(level, g, a) !== exact) inexact.push(`sub-sample ${g} ${a}`);
        if (subpixelCenter(level, 4 * g + a) !== exact) inexact.push(`subpixel ${4 * g + a}`);
      }
    }
    for (let c = 0; c <= 256 * n; c += 1) {
      if (corner(level, c) !== (c - 128 * n) / (128 * n)) inexact.push(`corner ${c}`);
    }
    expect(inexact).toEqual([]);
  });

  it.each(LEVELS)(
    'make border texels of tile x equal texels 0..3 of x + 1 at level %i',
    (level) => {
      // Tile x + 1 starts at −1 + 2(x + 1)/n (streaming.md 3.0). Every term is a small dyadic
      // rational, so the expected value is exact.
      const n = 2 ** level;
      for (let x = 0; x < n - 1; x += 1) {
        const nextS0 = -1 + (2 * (x + 1)) / n;
        for (let k = 0; k < 4; k += 1) {
          expect(texelCenter(level, TILE * x + 256 + k)).toBe(nextS0 + (2 * k + 1) / (256 * n));
        }
        expect(corner(level, TILE * x + 256)).toBe(nextS0);
      }
    },
  );
});

describe('tiles, texels and keys', () => {
  it.each(LEVELS)('finds the tile and texel of each texel center at level %i', (level) => {
    const wrong: number[] = [];
    for (let g = 0; g < 256 * 2 ** level; g += 1) {
      const s = texelCenter(level, g);
      const x = tileOf(s, level);
      if (x !== Math.floor(g / 256) || texelOf(s, level, x) !== g % 256) wrong.push(g);
    }
    expect(wrong).toEqual([]);
  });

  it('clamps tiles and texels to the face and tile', () => {
    expect([tileOf(-1, 3), tileOf(1, 3), tileOf(1 + 1e-15, 3)]).toEqual([0, 7, 7]);
    expect([texelOf(-1, 3, 7), texelOf(1, 3, 7)]).toEqual([0, 255]);
  });

  it('numbers nodes as a bijection through level 7', () => {
    const wrong: string[] = [];
    let k = 0;
    for (const t of allTiles(7)) {
      if (nodeIndex(t) !== k || tileKey(nodeFromIndex(k)) !== tileKey(t)) wrong.push(tileKey(t));
      k += 1;
    }
    expect(wrong).toEqual([]);
    expect([k, nodeCount(7)]).toEqual([131_070, 131_070]);
  });

  it('numbers the Sumbawa L7 tile 55,653', () => {
    expect(nodeIndex({ face: 1, level: 7, x: 103, y: 50 })).toBe(55_653);
  });

  it('round-trips tile keys', () => {
    for (const t of allTiles(3)) expect(parseTileKey(tileKey(t))).toEqual(t);
  });

  it.each(['1/6/0/0', '1/0/2/0', '0/0/0', '01/0/0/0', '1/0/0/0 ', 'a/b/c/d'])(
    'rejects %j as a tile key',
    (key) => {
      expect(() => parseTileKey(key)).toThrow();
    },
  );

  it('reads availability bits least significant first', () => {
    const bitmap = new Uint8Array([0x01, 0x02]);
    const set = Array.from({ length: 16 }, (_, k) => availGet(bitmap, k));
    expect(set).toEqual(Array.from({ length: 16 }, (_, k) => k === 0 || k === 9));
    expect(() => availGet(bitmap, 16)).toThrow();
  });
});

describe('the face-edge table', () => {
  it('matches the design doc', () => {
    const section = designDoc.split('Across a face edge, each face meets this neighbor edge:')[1];
    const rows = [...(section ?? '').matchAll(/^\s*\| (\d) \|(.+)\|$/gm)].slice(0, 6);
    const documented = rows.map((row) => {
      const cells = (row[2] ?? '').split('|').map((cell) => {
        const match = /^(\d) ([NESW])(, rev)?$/.exec(cell.trim());
        if (!match) throw new Error(`bad cell ${cell}`);
        return [Number(match[1]), match[2], match[3] !== undefined];
      });
      return Object.fromEntries(EDGES.map((edge, k) => [edge, cells[k]]));
    });
    expect(documented).toEqual(FACE_EDGES);
  });

  it('is symmetric', () => {
    for (const { face, edge, to } of faceEdgeEntries) {
      const [other, facing, reversed] = to;
      expect(FACE_EDGES[other]?.[facing]).toEqual([face, edge, reversed]);
    }
  });

  it.each(faceEdgeEntries)('matches geometry at $face $edge', ({ face, edge, to }) => {
    const level = 3;
    const full = TILE * 2 ** level;
    const [other, facing, reversed] = to;
    let worst = 0;
    for (let along = 0; along <= full; along += 1) {
      const across = edge === 'N' || edge === 'E' ? full : 0;
      const [cs, ct] = edgePoint(edge, along, across);
      const got = faceSt(other, stToDir(face, corner(level, cs), corner(level, ct)));
      const mapped = reversed ? full - along : along;
      const expectedAcross = facing === 'N' || facing === 'E' ? full : 0;
      const [es, et] = edgePoint(facing, mapped, expectedAcross);
      worst = Math.max(worst, maxDiff(got, [corner(level, es), corner(level, et)]));
    }
    expect(worst).toBeLessThanOrEqual(1e-12);
  });

  // Border texel 256 + k past a face edge lands in the neighbor's texel column k; the along-edge
  // index lands within 4 texels of the table's mapped index.
  it.each(faceEdgeEntries)(
    'maps border texels into the neighbor column at $face $edge',
    (entry) => {
      const [other, facing, reversed] = entry.to;
      const outOfColumn: string[] = [];
      let worstAlong = 0;
      for (const level of LEVELS) {
        const full = TILE * 2 ** level;
        for (let k = 0; k < 4; k += 1) {
          const across = entry.edge === 'N' || entry.edge === 'E' ? full + k : -1 - k;
          const column = facing === 'N' || facing === 'E' ? full - 1 - k : k;
          for (let along = -4; along < full + 4; along += 1) {
            const [gs, gt] = edgePoint(entry.edge, along, across);
            const p = stToDir(entry.face, texelCenter(level, gs), texelCenter(level, gt));
            const [s2, t2] = faceSt(other, p);
            const [gotAlong, gotAcross] = edgePoint(
              facing,
              Math.floor((s2 + 1) * (full / 2)),
              Math.floor((t2 + 1) * (full / 2)),
            );
            if (gotAcross !== column) outOfColumn.push(`L${level} k${k} along ${along}`);
            const mapped = reversed ? full - 1 - along : along;
            worstAlong = Math.max(worstAlong, Math.abs(gotAlong - mapped));
          }
        }
      }
      expect(outOfColumn).toEqual([]);
      expect(worstAlong).toBeLessThanOrEqual(4);
    },
  );
});

describe('neighbors', () => {
  it('are mutual through level 3', () => {
    for (const t of allTiles(3)) {
      for (const edge of EDGES) {
        const across = neighbor(t, edge);
        expect(neighbor(across.tile, across.edge)).toEqual({
          tile: t,
          edge,
          reversed: across.reversed,
        });
      }
    }
  });

  it('meet their neighbor entry for entry through level 3', () => {
    const off: string[] = [];
    for (const t of allTiles(3)) {
      for (const edge of EDGES) {
        const across = neighbor(t, edge);
        for (let k = 0; k <= TILE; k += 1) {
          const theirs = across.reversed ? TILE - k : k;
          if (maxDiff(edgeEntry(t, edge, k), edgeEntry(across.tile, across.edge, theirs)) > 1e-12) {
            off.push(`${tileKey(t)} ${edge} entry ${k}`);
            break;
          }
        }
      }
    }
    expect(off).toEqual([]);
  });

  it('meet across a reversed face edge', () => {
    expect(neighbor({ face: 2, level: 2, x: 0, y: 3 }, 'N')).toEqual({
      tile: { face: 4, level: 2, x: 3, y: 3 },
      edge: 'N',
      reversed: true,
    });
  });

  it.each(LEVELS)('meet at the Kirkuk corner at level %i', (level) => {
    const last = 2 ** level - 1;
    expect(neighbor({ face: 0, level, x: last, y: last }, 'E')).toEqual({
      tile: { face: 1, level, x: 0, y: last },
      edge: 'W',
      reversed: false,
    });
    expect(neighbor({ face: 0, level, x: last, y: last }, 'N')).toEqual({
      tile: { face: 4, level, x: last, y: 0 },
      edge: 'S',
      reversed: false,
    });
    expect(neighbor({ face: 1, level, x: 0, y: last }, 'N')).toEqual({
      tile: { face: 4, level, x: last, y: 0 },
      edge: 'E',
      reversed: false,
    });
  });
});

describe('the sides that store edge profiles', () => {
  it('are all four on an L0 tile', () => {
    for (let face = 0; face < 6; face += 1) {
      expect(faceEdgeSides({ face, level: 0, x: 0, y: 0 })).toEqual([0, 1, 2, 3]);
    }
  });

  it.each(LEVELS.slice(1))('are two on each Kirkuk corner tile at level %i', (level) => {
    const last = 2 ** level - 1;
    expect(faceEdgeSides({ face: 0, level, x: last, y: last })).toEqual([0, 1]); // N, E
    expect(faceEdgeSides({ face: 1, level, x: 0, y: last })).toEqual([0, 3]); // N, W
    expect(faceEdgeSides({ face: 4, level, x: last, y: 0 })).toEqual([1, 2]); // E, S
  });

  it('are none inside a face and one along a single face edge', () => {
    expect(faceEdgeSides({ face: 1, level: 7, x: 103, y: 50 })).toEqual([]);
    expect(faceEdgeSides({ face: 5, level: 9, x: 300, y: 511 })).toEqual([0]); // N
    expect(faceEdgeSides({ face: 4, level: 2, x: 1, y: 0 })).toEqual([2]); // S
  });

  it('are the sides whose neighbor lies on another face, through level 3', () => {
    for (const t of allTiles(3)) {
      const across = EDGES.flatMap((edge, e) =>
        neighbor(t, edge).tile.face !== t.face ? [e] : [],
      );
      expect(faceEdgeSides(t), tileKey(t)).toEqual(across);
    }
  });
});
