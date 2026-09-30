import { describe, expect, it } from 'vitest';
import { dayFromHistorical, dayFromIso, HISTORICAL } from '../story/dates';
import { HISTORY } from './exploreTime';
import {
  lensExtent,
  middleDay,
  overviewNames,
  overviewTicks,
  overviewWarp,
  riderYear,
  YEAR_DAYS,
} from './overviewScale';

const EXTENT = { start: HISTORY.start, end: HISTORY.end + 1 };
const WARP = overviewWarp(EXTENT, 100);
/** The overview's length at 1440, 1024 and 390 px wide, px (explore/timeRuler.ts). */
const LENGTHS = { 1440: 1262, 1024: 882, 390: 304 } as const;
const L = LENGTHS[1440];
const year = (y: number) => dayFromHistorical({ year: y, month: 1, day: 1 });

describe("the overview's warp", () => {
  it('runs from history’s first day to the end of its last', () => {
    expect(WARP.u(EXTENT.start)).toBe(0);
    expect(WARP.u(EXTENT.end)).toBeCloseTo(1, 12);
    expect(WARP.day(0)).toBeCloseTo(EXTENT.start, 6);
    expect(WARP.day(1)).toBeCloseTo(EXTENT.end, 6);
  });

  it('turns a day into a place and back within a pixel', () => {
    for (let day = EXTENT.start; day < EXTENT.end; day += 97_331) {
      const back = WARP.day(WARP.u(day));
      const px = (back - day) / (WARP.daysPerU(day) / L);
      expect(Math.abs(px)).toBeLessThan(1);
    }
  });

  it('only ever rises', () => {
    let last = -Infinity;
    for (let day = EXTENT.start; day <= EXTENT.end; day += 10_007) {
      const u = WARP.u(day);
      expect(u).toBeGreaterThan(last);
      last = u;
    }
  });

  it('sets 1 CE about a third of the way along and 1500 near two thirds', () => {
    expect(Math.abs(WARP.u(year(1)) - 0.36)).toBeLessThan(0.01);
    expect(Math.abs(WARP.u(year(1500)) - 0.63)).toBeLessThan(0.01);
  });

  it('holds the recent past open and the deep past close', () => {
    const yearsPerPx = (iso: string) => WARP.daysPerU(dayFromIso(iso)) / L / YEAR_DAYS;
    expect(yearsPerPx('1815-06-18')).toBeCloseTo(1.1, 0);
    expect(yearsPerPx('1066-06-01')).toBeCloseTo(4, 0);
    expect(yearsPerPx('-0499-06-01')).toBeCloseTo(10, 0);
    expect(yearsPerPx('-7999-06-01')).toBeCloseTo(39, -1);
  });
});

describe("the overview's engraving", () => {
  it('cuts each millennium, 1 CE as the era’s seam, and history’s ends', () => {
    const ticks = overviewTicks(WARP, EXTENT, L);
    expect(ticks.filter((t) => t.kind === 'end').map((t) => t.day)).toEqual([
      EXTENT.start,
      EXTENT.end,
    ]);
    expect(ticks.filter((t) => t.kind === 'era').map((t) => t.day)).toEqual([year(1)]);
    const millennia = ticks.filter((t) => t.kind === 'millennium').map((t) => t.day);
    expect(millennia).toContain(year(-999));
    expect(millennia).toContain(year(1000));
  });

  it('cuts centuries and decades only where they stay 4.5 px apart', () => {
    for (const kind of ['century', 'decade'] as const) {
      const days = overviewTicks(WARP, EXTENT, L)
        .filter((t) => t.kind === kind)
        .map((t) => t.day);
      expect(days.length).toBeGreaterThan(0);
      const px = days.map((d) => WARP.u(d) * L);
      const step = kind === 'century' ? 100 : 10;
      for (const d of days) {
        const y = HISTORICAL.civil(d).year;
        const next = y <= 0 ? Math.min(1, y + step) : y + step;
        expect((WARP.u(year(next)) - WARP.u(d)) * L).toBeGreaterThanOrEqual(4.5);
      }
      expect(px.every((x, i) => i === 0 || x > px[i - 1]!)).toBe(true);
    }
  });

  it.each(Object.entries(LENGTHS))('names nothing that overlaps at %s px', (width, length) => {
    const names = overviewNames(WARP, EXTENT, length, HISTORICAL, width === '390' ? 6.2 : 6.8);
    for (let i = 1; i < names.length; i += 1) {
      expect(names[i]!.left).toBeGreaterThan(names[i - 1]!.right);
    }
    expect(names[0]!.text).toBe('10,000 BCE');
    expect(names.at(-1)!.text).toBe('2000');
  });

  it('names 17 dates at 1440, 13 at 1024 and 6 at 390, 1 CE among them from 1024 up', () => {
    const count = (length: number, charPx = 6.8) =>
      overviewNames(WARP, EXTENT, length, HISTORICAL, charPx).map((n) => n.text);
    expect(count(LENGTHS[1440])).toHaveLength(17);
    expect(count(LENGTHS[1024])).toHaveLength(13);
    expect(count(LENGTHS[1024])).toContain('1 CE');
    expect(count(LENGTHS[1440])).toContain('1 CE');
    expect(count(LENGTHS[390], 6.2)).toEqual([
      '10,000 BCE',
      '1 CE',
      '1000',
      '1500',
      '1800',
      '2000',
    ]);
  });
});

describe('the lens', () => {
  it('spans the tape’s days on the warp', () => {
    const day = dayFromIso('1066-10-14');
    const span = 200 * YEAR_DAYS;
    const { u0, u1, u } = lensExtent(WARP, day, span, L);
    expect(u0).toBeCloseTo(WARP.u(day - span / 2), 12);
    expect(u1).toBeCloseTo(WARP.u(day + span / 2), 12);
    expect(u).toBeCloseTo(WARP.u(day), 12);
  });

  it('stays at least 12 px wide, within the strip', () => {
    for (const day of [EXTENT.start, dayFromIso('1815-06-18'), EXTENT.end - 1]) {
      const { u0, u1 } = lensExtent(WARP, day, 10, L);
      expect((u1 - u0) * L).toBeCloseTo(12, 6);
      expect(u0).toBeGreaterThanOrEqual(0);
      expect(u1).toBeLessThanOrEqual(1);
    }
  });
});

describe('the rider', () => {
  const riderAt = (iso: string) => riderYear(WARP, EXTENT, WARP.u(dayFromIso(iso)), L);

  it('names the exact year where a pixel holds 6 years or fewer', () => {
    expect(riderAt('1066-10-14')).toMatchObject({ year: 1066, step: 1, text: '1066' });
    expect(riderAt('0950-06-01')).toMatchObject({ step: 1, text: '950 CE' });
  });

  it('rounds to 5, 10 or 50 years as the scale closes, in history’s numbering', () => {
    const bce500 = riderAt('-0499-06-01');
    expect(bce500.step).toBe(5);
    expect(bce500.text).toBe('500 BCE');
    const deep = riderAt('-7999-06-01');
    expect(deep.step).toBe(50);
    expect(deep.text).toBe('8000 BCE');
    const mid = riderAt('-3000-06-01');
    expect(mid.step).toBe(10);
  });

  it('flies to its year’s middle day and never names year 0', () => {
    const r = riderAt('-0001-06-01');
    expect(r.day).toBe(middleDay(r.year));
    for (let u = 0; u <= 1; u += 0.001) {
      const { text } = riderYear(WARP, EXTENT, u, L);
      expect(text).not.toMatch(/^0\b/);
    }
    expect(riderYear(WARP, EXTENT, 0, L).text).toBe('10,000 BCE');
    expect(riderYear(WARP, EXTENT, 1, L).text).toBe('2000');
  });
});
