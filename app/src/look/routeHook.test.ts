import { describe, expect, it } from 'vitest';
import type { FxRelease } from '../data/release';
import { parseRoute } from '../data/route';
import { dirOf } from '../story/effects/geo';
import { readFixtureFile, readStageRecord } from '../test/fixture';
import {
  createRouteUniforms,
  disposeRouteTextures,
  ROUTE_COLUMNS,
  ROUTE_ROWS,
  setRouteData,
} from './routeHook';

const magellan = () => {
  const fx = readStageRecord<FxRelease>('fx');
  return parseRoute(readFixtureFile(fx['magellan/route']!.key).buffer);
};

describe('the analytic route inlay index', () => {
  it('finds every built arc through either side of the dateline and at cell edges', () => {
    const route = magellan();
    const u = createRouteUniforms();
    setRouteData(u, [route]);
    const cells = u.lookRouteCells?.value.image.data as Float32Array;
    const indices = u.lookRouteIndices.value.image.data as Float32Array;
    const segments = u.lookRouteSegments.value.image.data as Float32Array;
    let row = 0;
    for (let i = 0; i < route.pts.length - 1; i++) {
      const a = route.pts[i]!;
      const b = route.pts[i + 1]!;
      const start = dirOf([a[0], a[1]]);
      const end = dirOf([b[0], b[1]]);
      if (start.distanceTo(end) < 1e-10) continue;
      expect(segments[row * 16 + 12]).toBe(a[3]);
      expect(segments[row * 16 + 13]).toBe(i);
      // Densified arcs are short: normalized chord samples stay inside the same padded cap.
      for (const f of [0, 0.5, 1]) {
        const at = start.clone().lerp(end, f).normalize();
        const lon = (Math.atan2(at.x, at.z) * 180) / Math.PI;
        const lat = (Math.asin(at.y) * 180) / Math.PI;
        const x = Math.floor((lon + 180) / 5) % ROUTE_COLUMNS;
        const y = Math.min(35, Math.floor((lat + 90) / 5));
        const cell = y * ROUTE_COLUMNS + x;
        const offset = cells[cell * 2]!;
        const count = cells[cell * 2 + 1]!;
        expect(
          Array.from(indices.slice(offset, offset + count)),
          `segment ${i}, fraction ${f}`,
        ).toContain(row);
      }
      row += 1;
    }
    disposeRouteTextures(u);
  });

  it('lists the same segments in every cell with the cells at the head of the index table', () => {
    const route = magellan();
    const apart = createRouteUniforms();
    const headed = createRouteUniforms({ cellsInIndices: true });
    setRouteData(apart, [route]);
    setRouteData(headed, [route]);
    expect(headed.lookRouteCells).toBeUndefined();
    const cells = apart.lookRouteCells?.value.image.data as Float32Array;
    const indices = apart.lookRouteIndices.value.image.data as Float32Array;
    const table = headed.lookRouteIndices.value.image.data as Float32Array;
    const list = (from: Float32Array, offset: number, count: number) =>
      Array.from(from.slice(offset, offset + count));
    let listed = 0;
    for (let cell = 0; cell < ROUTE_COLUMNS * ROUTE_ROWS; cell++) {
      const [offset, count] = [cells[cell * 2]!, cells[cell * 2 + 1]!];
      const [start, headedCount] = [table[cell * 2]!, table[cell * 2 + 1]!];
      expect(list(table, start, headedCount), `cell ${cell}`).toEqual(list(indices, offset, count));
      listed += count;
    }
    expect(listed).toBeGreaterThan(0);
    disposeRouteTextures(apart);
    disposeRouteTextures(headed);
  });
});
