// Read the real ModE-RA fixture through the browser's decoder and month blender.
import { gunzipSync } from 'node:zlib';
import { expect, test } from 'vitest';
import { readFixtureFile, readStageRecord } from '../test/fixture';
import { blendMonths, climateKey, parseClimate } from './climate';
import type { ModeraRelease } from './release';

test('the built fixture has a cold 1816 summer in Europe and missing cells outside its excerpt', () => {
  const record = readStageRecord<ModeraRelease>('modera');
  const year = parseClimate(gunzipSync(readFixtureFile(climateKey(record, 1816))));
  expect(record.years).toEqual([1815, 1817]);
  expect([year.variable, year.firstYear, year.frames, year.nlat, year.nlon]).toEqual([
    0, 1816, 12, 96, 192,
  ]);
  // Between June and July, on the native Gaussian rows, against the 1901-2000 baseline.
  const field = blendMonths(year, 6, year, 7, 0.5, new Float32Array(year.nlat * year.nlon));
  const europe: number[] = [];
  for (let row = 0; row < year.nlat; row += 1) {
    const lat = record.lat[row] ?? 0;
    if (lat < 45 || lat > 55) continue;
    for (let col = 0; col < year.nlon; col += 1) {
      const lon = record.lon0 + col * record.dlon;
      if (lon >= 0 && lon <= 20) europe.push(field[row * year.nlon + col] ?? NaN);
    }
  }
  expect(europe.length).toBeGreaterThan(0);
  expect(europe.every(Number.isFinite)).toBe(true);
  expect(europe.reduce((sum, value) => sum + value, 0) / europe.length).toBeLessThan(-1.5);
  expect(field[0]).toBeNaN();
});
