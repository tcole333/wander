// The camera's terrain ceiling (streaming.md 5.7) on the fixture: it bounds every drawn vertex
// near a direction, it is continuous as the direction and the cap move, and it counts what can
// draw inside a node, from its ancestors down to its finest descendants.
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, test } from 'vitest';
import { parseSurfaceBounds } from '../surface/bounds';
import {
  availGet,
  lonLatToDir,
  nodeFromIndex,
  nodeIndex,
  stToDir,
  corner,
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
    const { decoded } = await loadSurfaceTile(
      record,
      `${tile.level}/${tile.face}/${tile.x}/${tile.y}`,
    );
    for (let l = 0; l <= 32; l += 1) {
      for (let v = 0; v <= 32; v += 1) {
        const s = corner(tile.level, 256 * tile.x + 8 * v);
        const t = corner(tile.level, 256 * tile.y + 8 * l);
        vertices.push({ dir: stToDir(tile.face, s, t), h: decoded.grid[l * 33 + v] ?? 0 });
      }
    }
  }
});

/** A seeded generator taking an LCG's high bits. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function near(lon: number, lat: number, spreadDeg: number, next: () => number): Vec3 {
  return lonLatToDir(lon + (next() - 0.5) * 2 * spreadDeg, lat + (next() - 0.5) * 2 * spreadDeg);
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe('the ceiling', () => {
  test('is at least every fixture grid vertex within the cap, at ×16', () => {
    const next = random(3);
    for (const [lon, lat] of [
      [118.0, -8.25],
      [45.0, 35.26],
    ] as const) {
      for (let i = 0; i < 150; i += 1) {
        const dir = near(lon, lat, 2, next);
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

  test('moves continuously as the direction crosses node and face edges', () => {
    const cap = 20 / EARTH_KM;
    const step = 1e-5;
    // Past the highest bound, each step can change the ceiling by at most smoothstep's slope (1.5)
    // times the step over the cap radius.
    const bound = K * field.hMax * 1.5 * (step / cap) * 1.01 + 1e-6;
    for (const [lon, lat, dLon, dLat] of [
      [117.0, -8.25, 1, 0], // across Sumbawa's tiles
      [44.0, 35.26, 1, 0], // across the face 0-1 edge at the Kirkuk corner
      [45.0, 34.5, 0, 1], // toward the Kirkuk vertex along a face edge
    ] as const) {
      let previous = field.ceilingM(lonLatToDir(lon, lat), cap, K);
      for (let i = 1; i <= 2000; i += 1) {
        const deg = (i * step * 180) / Math.PI;
        const now = field.ceilingM(lonLatToDir(lon + dLon * deg, lat + dLat * deg), cap, K);
        expect(Math.abs(now - previous)).toBeLessThanOrEqual(bound);
        previous = now;
      }
    }
  });

  test('moves continuously as the cap grows through a level blend', () => {
    const dir = lonLatToDir(117.96, -8.25);
    let previous = field.ceilingM(dir, 5 / EARTH_KM, K);
    for (let km = 5.01; km <= 400; km *= 1.001) {
      const now = field.ceilingM(dir, km / EARTH_KM, K);
      // A 0.1% step in the cap moves the level by 0.0014 and each weight by at most 0.3%.
      expect(Math.abs(now - previous)).toBeLessThanOrEqual(K * field.hMax * 0.005);
      previous = now;
    }
  });

  test('scales with kLand', () => {
    const dir = lonLatToDir(117.96, -8.25);
    const cap = 30 / EARTH_KM;
    expect(field.ceilingM(dir, cap, 16)).toBeCloseTo(2 * field.ceilingM(dir, cap, 8), 9);
  });
});

describe('heightCeiling', () => {
  test('counts the finest descendant: an L2 tile over Tambora reaches its L7 summit', () => {
    const summit = bounds.get(nodeIndex({ face: 1, level: 7, x: 103, y: 50 }))?.[1] ?? NaN;
    const l2 = { face: 1, level: 2, x: 3, y: 1 };
    expect(field.heightCeiling(l2)).toBeGreaterThanOrEqual(summit);
    expect(bounds.get(nodeIndex(l2))?.[1]).toBeLessThan(summit);
  });

  test('falls back to the ancestors where a node has no tile', () => {
    // An L5 node on face 3, far from the fixture's L2-L7 tiles: only L0-L1 ancestors exist.
    const tile = { face: 3, level: 5, x: 10, y: 20 };
    const own = (t: Tile) => bounds.get(nodeIndex(t))?.[1] ?? -Infinity;
    const expected = Math.max(
      own({ face: 3, level: 0, x: 0, y: 0 }),
      own({ face: 3, level: 1, x: 0, y: 1 }),
    );
    expect(field.heightCeiling(tile)).toBe(expected);
  });
});
