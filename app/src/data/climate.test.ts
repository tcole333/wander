// The climate files (streaming.md 3.5): a small WCY1 year as the modera stage writes one, read
// back and two of its months blended as the walk blends them for a story day.
import { describe, expect, test } from 'vitest';
import { dayFromIso } from '../story/dates';
import { blendMonths, CLIMATE_MISSING, monthsAround, parseClimate } from './climate';

const NLAT = 2;
const NLON = 3;
const FRAMES = 12;

/** A year of 12 frames: frame f's cell i holds code 10·i + f at scale 0.1 and offset f − 5. */
function syntheticYear(): Uint8Array {
  const cells = NLAT * NLON;
  const raw = new Uint8Array(16 + 8 * FRAMES + FRAMES * cells);
  const view = new DataView(raw.buffer);
  raw.set([...'WCY1'].map((c) => c.charCodeAt(0)));
  view.setUint8(4, 1);
  view.setUint8(5, 0);
  view.setInt16(6, 1816, true);
  view.setUint16(8, FRAMES, true);
  view.setUint16(10, NLAT, true);
  view.setUint16(12, NLON, true);
  for (let f = 0; f < FRAMES; f += 1) {
    view.setFloat32(16 + 4 * f, 0.1, true);
    view.setFloat32(16 + 4 * (FRAMES + f), f - 5, true);
    for (let i = 0; i < cells; i += 1) raw[16 + 8 * FRAMES + f * cells + i] = 10 * i + f;
  }
  return raw;
}

describe('climate files', () => {
  test('parse a year and blend two of its months by the weight between them', () => {
    const raw = syntheticYear();
    // July's first cell has no value.
    raw[16 + 8 * FRAMES + 6 * NLAT * NLON] = CLIMATE_MISSING;
    const year = parseClimate(raw);
    expect([year.firstYear, year.frames, year.nlat, year.nlon]).toEqual([1816, 12, 2, 3]);

    const field = blendMonths(year, 6, year, 7, 0.25, new Float32Array(NLAT * NLON));
    // June (frame 5): 0.1·(10i + 5) + 0; July (frame 6): 0.1·(10i + 6) + 1.
    const june = (i: number) => 0.1 * (10 * i + 5);
    const july = (i: number) => 0.1 * (10 * i + 6) + 1;
    expect(field[0]).toBeCloseTo(june(0), 5);
    for (let i = 1; i < NLAT * NLON; i += 1) {
      expect(field[i]).toBeCloseTo(june(i) + 0.25 * (july(i) - june(i)), 5);
    }
  });

  test('a day blends the months whose middles it falls between', () => {
    const { from, to, w } = monthsAround(dayFromIso('1816-07-01'));
    expect([from, to]).toEqual([
      { year: 1816, month: 6 },
      { year: 1816, month: 7 },
    ]);
    // June's middle is its 16th day; July's is halfway through its 16th.
    expect(w).toBeCloseTo(15 / 30.5, 6);
    expect(monthsAround(dayFromIso('1817-01-02')).from).toEqual({ year: 1816, month: 12 });
  });
});
