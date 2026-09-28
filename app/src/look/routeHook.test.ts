import { describe, expect, it } from 'vitest';
import type { FxRelease } from '../data/release';
import { parseRoute } from '../data/route';
import { dirOf } from '../story/effects/geo';
import { readFixtureFile, readStageRecord } from '../test/fixture';
import {
  createRouteUniforms,
  disposeRouteTextures,
  ROUTE_COLUMNS,
  setRouteData,
} from './routeHook';

describe('the analytic route inlay index', () => {
  it('finds every built arc through either side of the dateline and at cell edges', () => {
    const fx = readStageRecord<FxRelease>('fx');
    const route = parseRoute(readFixtureFile(fx['magellan/route']!.key).buffer);
    const u = createRouteUniforms();
    setRouteData(u, [route]);
    const cells = u.lookRouteCells.value.image.data as Float32Array;
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
});
