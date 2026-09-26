// The camera's terrain ceiling (streaming.md 5.7): what a node counts (its subtree, or its deepest
// ancestor without a tile), a contract that every node within the cap enters in full, tightness at
// Tambora's summit, conservativeness against the fixture's grid vertices, and continuity where the
// ceiling actually varies.
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, test } from 'vitest';
import { parseSurfaceBounds } from '../surface/bounds';
import {
  availGet,
  corner,
  lonLatToDir,
  nodeFromIndex,
  nodeIndex,
  stToDir,
  tileKey,
  type Tile,
  type Vec3,
} from '../surface/cube';
import {
  loadSurfaceTile,
  readFixtureFile,
  readSurfaceRecord,
  surfaceAvailability,
} from '../test/fixture';
import { ClearanceField } from './clearance';

const EARTH_KM = 6371.0088;
const K = 16;

let field: ClearanceField;
let bounds: Map<number, [number, number]>;
/** Every fixture grid vertex: its direction and height in meters. */
let vertices: { dir: Vec3; h: number }[];

beforeAll(async () => {
  const record = readSurfaceRecord();
  const avail = surfaceAvailability(record);
  const raw = gunzipSync(readFixtureFile(record.bounds));
  bounds = parseSurfaceBounds(
    raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
    avail,
  );
  field = new ClearanceField({
    bounds,
    available: (t: Tile) => t.level <= record.maxLevel && availGet(avail, nodeIndex(t)),
    surface: { ...record, qLand: [], c200: [] },
  });
  vertices = [];
  for (const k of bounds.keys()) {
    const tile = nodeFromIndex(k);
    const { decoded } = await loadSurfaceTile(record, tileKey(tile));
    for (let l = 0; l <= 32; l += 1) {
      for (let v = 0; v <= 32; v += 1) {
        const s = corner(tile.level, 256 * tile.x + 8 * v);
        const t = corner(tile.level, 256 * tile.y + 8 * l);
        vertices.push({ dir: stToDir(tile.face, s, t), h: decoded.grid[l * 33 + v] ?? 0 });
      }
    }
  }
});

/** A layer of the given tiles' highest bounds, and nothing else. */
function synthetic(highs: [Tile, number][], maxLevel = 7): ClearanceField {
  const byNode = new Map(highs.map(([t, h]) => [nodeIndex(t), [0, h] as [number, number]]));
  return new ClearanceField({
    bounds: byNode,
    available: (t) => byNode.has(nodeIndex(t)),
    surface: { ver: 'x', maxLevel, qLand: [], c200: [], avail: '', bounds: '' },
  });
}

/** A seeded generator taking an LCG's high bits. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const angle = (a: Vec3, b: Vec3) => Math.acos(Math.min(1, Math.max(-1, dot(a, b))));

describe('heightCeiling', () => {
  const root = { face: 0, level: 0, x: 0, y: 0 };
  const child = { face: 0, level: 1, x: 0, y: 0 };
  const sibling = { face: 0, level: 1, x: 1, y: 0 };
  const grandchild = { face: 0, level: 2, x: 1, y: 1 };
  const layer = () =>
    synthetic([
      [root, 1000],
      [child, 500],
      [sibling, 200],
      [grandchild, 3000],
    ]);

  test('counts the available subtree: a node reaches its finest descendant’s peak', () => {
    expect(layer().heightCeiling(child)).toBe(3000);
    expect(layer().heightCeiling(root)).toBe(3000);
  });

  test('does not count the ancestors of a node with a tile of its own', () => {
    expect(layer().heightCeiling(sibling)).toBe(200);
  });

  test('without a tile, counts the deepest available ancestor', () => {
    expect(layer().heightCeiling({ face: 0, level: 3, x: 6, y: 1 })).toBe(200);
    expect(layer().heightCeiling({ face: 0, level: 2, x: 0, y: 3 })).toBe(1000);
  });
});

describe('the ceiling', () => {
  test('is tight at Tambora’s summit: a 1 km cap reaches kLand times the L7 bound', () => {
    const summit = bounds.get(nodeIndex({ face: 1, level: 7, x: 103, y: 50 }))?.[1] ?? NaN;
    const ceiling = field.ceilingM(lonLatToDir(117.9604, -8.2479), 1 / EARTH_KM, K);
    expect(ceiling).toBeGreaterThanOrEqual(K * summit);
    expect(ceiling).toBeLessThanOrEqual(K * summit * 1.01);
  });

  test('takes every node within the cap in full, at both blended levels', () => {
    const next = random(5);
    for (let i = 0; i < 40; i += 1) {
      const dir = lonLatToDir(116 + 4 * next(), -10 + 4 * next());
      const cap = (2 + 200 * next()) / EARTH_KM;
      const level = Math.min(7, Math.max(0, Math.log2(Math.PI / 2 / (2 * cap))));
      const coarse = Math.floor(level);
      const f = level - coarse;
      const within = (l: number) => {
        let high = 0;
        const n = 2 ** l;
        for (let face = 0; face < 6; face += 1) {
          for (let x = 0; x < n; x += 1) {
            for (let y = 0; y < n; y += 1) {
              const s = (j: number) => -1 + (2 * j) / n;
              const center = stToDir(face, s(x + 0.5), s(y + 0.5));
              if (angle(center, dir) > Math.PI / n + cap) continue;
              let radius = 0;
              for (const [a, b] of [
                [0, 0],
                [1, 0],
                [0, 1],
                [1, 1],
              ] as const) {
                radius = Math.max(radius, angle(center, stToDir(face, s(x + a), s(y + b))));
              }
              if (angle(center, dir) - radius <= cap) {
                high = Math.max(high, K * field.heightCeiling({ face, level: l, x, y }));
              }
            }
          }
        }
        return high;
      };
      const expected = (1 - f) * within(coarse) + f * within(Math.min(coarse + 1, 7));
      expect(field.ceilingM(dir, cap, K)).toBeGreaterThanOrEqual(expected - 1e-6);
    }
  });

  test('is at least every fixture grid vertex within the cap, at ×16', () => {
    const next = random(3);
    for (const [lon, lat] of [
      [118.0, -8.25],
      [45.0, 35.26],
    ] as const) {
      for (let i = 0; i < 150; i += 1) {
        const dir = lonLatToDir(lon + (next() - 0.5) * 4, lat + (next() - 0.5) * 4);
        const capKm = 0.5 * 1000 ** next();
        const cap = capKm / EARTH_KM;
        const ceiling = field.ceilingM(dir, cap, K);
        const cosCap = Math.cos(cap);
        for (const vertex of vertices) {
          if (dot(vertex.dir, dir) >= cosCap) {
            expect(K * Math.max(0, vertex.h), `${capKm.toFixed(1)} km cap`).toBeLessThanOrEqual(
              ceiling,
            );
          }
        }
      }
    }
  });

  test('scales with kLand', () => {
    const dir = lonLatToDir(117.96, -8.25);
    const cap = 30 / EARTH_KM;
    expect(field.ceilingM(dir, cap, 16)).toBeCloseTo(2 * field.ceilingM(dir, cap, 8), 9);
  });
});

describe('continuity, where the ceiling varies', () => {
  test('as the direction crosses node and face edges', () => {
    const cap = 20 / EARTH_KM;
    const step = 1e-5;
    for (const [lon, lat, dLon, dLat] of [
      [117.7, -8.25, 1, 0], // across Tambora's L7 tiles and off them
      [44.0, 35.26, 1, 0], // across the face 0-1 edge at the Kirkuk corner
      [45.0, 34.5, 0, 1], // toward the Kirkuk vertex along a face edge
    ] as const) {
      const values: number[] = [];
      for (let i = 0; i <= 3000; i += 1) {
        const deg = (i * step * 180) / Math.PI;
        values.push(field.ceilingM(lonLatToDir(lon + dLon * deg, lat + dLat * deg), cap, K));
      }
      // Each step moves the ceiling by at most smoothstep's slope (1.5) times the step over the
      // cap, times the highest value the sweep sees.
      const top = Math.max(...values);
      const bound = top * 1.5 * (step / cap) * 1.01 + 1e-6;
      expect(top - Math.min(...values), 'the sweep sees the ceiling change').toBeGreaterThan(
        0.05 * top,
      );
      for (let i = 1; i < values.length; i += 1) {
        expect(Math.abs((values[i] ?? 0) - (values[i - 1] ?? 0))).toBeLessThanOrEqual(bound);
      }
    }
  });

  test('as the cap grows through level blends', () => {
    const dir = lonLatToDir(117.5, -8.0);
    const values: number[] = [];
    for (let km = 2; km <= 800; km *= 1.001) values.push(field.ceilingM(dir, km / EARTH_KM, K));
    const top = Math.max(...values);
    expect(top - Math.min(...values), 'the sweep sees the ceiling change').toBeGreaterThan(
      0.2 * top,
    );
    // A 0.1% step in the cap moves the level by 0.0014 and each weight by at most 0.3%.
    for (let i = 1; i < values.length; i += 1) {
      expect(Math.abs((values[i] ?? 0) - (values[i - 1] ?? 0))).toBeLessThanOrEqual(0.005 * top);
    }
  });
});
