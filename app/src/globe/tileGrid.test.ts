// The shared tile grid (streaming.md 5.6 rules 5 and 8).
import { describe, expect, test } from 'vitest';
import { buildTileGrid, GRID_SEGMENTS, SKIRT, SURFACE, type TileGrid } from './tileGrid';

const vertex = (grid: TileGrid, v: number) => {
  const [k = NaN, l = NaN, role = NaN] = grid.position.subarray(3 * v, 3 * v + 3);
  return { k, l, role };
};

/** Triangle corners on the flat proxy (k, l, −role): skirts hang one unit below the surface. */
function triangles(grid: TileGrid): [number, number, number][][] {
  const out: [number, number, number][][] = [];
  for (let i = 0; i < grid.index.length; i += 3) {
    out.push(
      [0, 1, 2].map((j) => {
        const { k, l, role } = vertex(grid, grid.index[i + j] ?? 0);
        return [k, l, -role];
      }),
    );
  }
  return out;
}

function normalOf([a, b, c]: [number, number, number][]): [number, number, number] {
  const u = [b![0] - a![0], b![1] - a![1], b![2] - a![2]];
  const v = [c![0] - a![0], c![1] - a![1], c![2] - a![2]];
  return [
    u[1]! * v[2]! - u[2]! * v[1]!,
    u[2]! * v[0]! - u[0]! * v[2]!,
    u[0]! * v[1]! - u[1]! * v[0]!,
  ];
}

describe.each(Object.entries(GRID_SEGMENTS))('the %s grid', (_tier, segments) => {
  const grid = buildTileGrid(segments);
  const G = segments;

  test('has (G + 1)² surface vertices and 4G skirt bottoms, 6G² + 24G indices', () => {
    expect(grid.vertexCount).toBe((G + 1) ** 2 + 4 * G);
    expect(grid.index.length).toBe(6 * G * G + 24 * G);
  });

  test('lays surface vertices out row-major', () => {
    for (let l = 0; l <= G; l += 1) {
      for (let k = 0; k <= G; k += 1) {
        expect(vertex(grid, l * (G + 1) + k)).toEqual({ k, l, role: SURFACE });
      }
    }
  });

  test('hangs exactly one skirt bottom from each boundary vertex', () => {
    const bottoms = new Map<string, number>();
    for (let v = (G + 1) ** 2; v < grid.vertexCount; v += 1) {
      const { k, l, role } = vertex(grid, v);
      expect(role).toBe(SKIRT);
      expect(k === 0 || k === G || l === 0 || l === G).toBe(true);
      bottoms.set(`${k},${l}`, (bottoms.get(`${k},${l}`) ?? 0) + 1);
    }
    expect(bottoms.size).toBe(4 * G);
    expect([...bottoms.values()].every((count) => count === 1)).toBe(true);
  });

  test('splits every quad along (k, l)-(k + 1, l + 1)', () => {
    const surface = triangles(grid).filter((t) => t.every(([, , z]) => z === 0));
    expect(surface).toHaveLength(2 * G * G);
    for (const t of surface) {
      const ks = t.map(([k]) => k);
      const ls = t.map(([, l]) => l);
      const k0 = Math.min(...ks);
      const l0 = Math.min(...ls);
      const keys = t.map(([k, l]) => `${k - k0},${l - l0}`);
      expect(keys).toContain('0,0');
      expect(keys).toContain('1,1');
    }
  });

  test('winds every surface triangle counter-clockwise in (k, l): outward', () => {
    for (const t of triangles(grid).filter((tri) => tri.every(([, , z]) => z === 0))) {
      expect(normalOf(t)[2]).toBeGreaterThan(0);
    }
  });

  test('faces every skirt triangle away from the tile center', () => {
    const skirts = triangles(grid).filter((t) => t.some(([, , z]) => z !== 0));
    expect(skirts).toHaveLength(8 * G);
    for (const t of skirts) {
      const [nx, ny] = normalOf(t);
      const cx = t.reduce((sum, [k]) => sum + k, 0) / 3 - G / 2;
      const cy = t.reduce((sum, [, l]) => sum + l, 0) / 3 - G / 2;
      expect(nx * cx + ny * cy).toBeGreaterThan(0);
    }
  });

  test('gives every vertex the constant (0, 0, 127) normal', () => {
    for (let v = 0; v < grid.vertexCount; v += 1) {
      expect([...grid.normal.subarray(3 * v, 3 * v + 3)]).toEqual([0, 0, 127]);
    }
  });
});
