import { describe, expect, it } from 'vitest';
import { dayFromHistorical, HISTORICAL } from '../story/dates';
import { HISTORY } from './exploreTime';
import { overviewWarp, YEAR_DAYS } from './overviewScale';
import {
  coastStep,
  flick,
  flightAt,
  glideRate,
  nearestTick,
  nextDetent,
  nextTick,
  peakSpan,
  planFlight,
  REDUCED_FLIGHT_S,
  SPAN_DETENTS,
  takeOver,
  type Pose,
} from './timeMotion';

const EXTENT = { start: HISTORY.start, end: HISTORY.end + 1 };
const WARP = overviewWarp(EXTENT, 100);
const TIMING = { minS: 0.22, maxS: 0.9, maxSpan: 5000 * YEAR_DAYS };
const year = (y: number, month = 1, day = 1) => dayFromHistorical({ year: y, month, day });
const Y200 = 200 * YEAR_DAYS;

describe('a flight', () => {
  it('ends exactly on its day and span', () => {
    const from: Pose = { day: year(1571, 10, 7), span: Y200 };
    const to: Pose = { day: year(-499, 7, 2), span: 20 * YEAR_DAYS };
    const flight = planFlight(from, to, TIMING);
    expect(flightAt(flight, 0, WARP)).toEqual(from);
    expect(flightAt(flight, 1, WARP)).toEqual(to);
    expect(flightAt(flight, 1.3, WARP)).toEqual(to);
  });

  it('takes 0.61 s from 1571 to 500 BCE, rising to about 814 years', () => {
    const flight = planFlight(
      { day: year(1571), span: Y200 },
      { day: year(-499), span: Y200 },
      TIMING,
    );
    expect(flight.durationS).toBeCloseTo(0.61, 2);
    expect(peakSpan(flight, WARP) / YEAR_DAYS).toBeCloseTo(814, -1);
  });

  it('lasts 0.22 to 0.9 s, however far', () => {
    for (const [a, b] of [
      [year(1815), year(1815)],
      [year(1815), year(1816)],
      [year(1815), year(1066)],
      [HISTORY.start, HISTORY.end],
    ] as const) {
      for (const span of [10, 30, YEAR_DAYS, Y200, 5000 * YEAR_DAYS]) {
        const { durationS } = planFlight({ day: a, span }, { day: b, span }, TIMING);
        expect(durationS).toBeGreaterThanOrEqual(0.22);
        expect(durationS).toBeLessThanOrEqual(0.9);
      }
    }
  });

  it('never rises past 5,000 years', () => {
    const flight = planFlight(
      { day: HISTORY.start, span: 2000 * YEAR_DAYS },
      { day: HISTORY.end, span: 2000 * YEAR_DAYS },
      TIMING,
    );
    expect(flight.rise).toBeGreaterThan(0);
    expect(peakSpan(flight, WARP)).toBeLessThanOrEqual(5000 * YEAR_DAYS + 1e-6);
  });

  it('moves the date evenly on the overview’s warp, and a zoom not at all', () => {
    const flight = planFlight(
      { day: year(1), span: Y200 },
      { day: year(1900), span: Y200 },
      TIMING,
    );
    const half = flightAt(flight, 0.5, WARP).day;
    expect(WARP.u(half)).toBeCloseTo((WARP.u(year(1)) + WARP.u(year(1900))) / 2, 9);
    const zoom = planFlight(
      { day: year(1815), span: Y200 },
      { day: year(1815), span: 500 * YEAR_DAYS },
      TIMING,
    );
    for (const t of [0.1, 0.5, 0.9]) expect(flightAt(zoom, t, WARP).day).toBe(year(1815));
  });

  it('hands a hand that takes it the tape at its target span', () => {
    const flight = planFlight(
      { day: year(1571), span: Y200 },
      { day: year(-499), span: 20 * YEAR_DAYS },
      TIMING,
    );
    const taken = takeOver(flight, 0.4, WARP);
    expect(taken.span).toBe(20 * YEAR_DAYS);
    expect(taken.day).toBe(flightAt(flight, 0.4, WARP).day);
  });

  it('with reduced motion takes 150 ms and never rises', () => {
    const flight = planFlight(
      { day: year(1571), span: Y200 },
      { day: year(-499), span: Y200 },
      { ...TIMING, reduced: true },
    );
    expect(flight.durationS).toBe(REDUCED_FLIGHT_S);
    expect(flight.rise).toBe(0);
    expect(peakSpan(flight, WARP)).toBeCloseTo(Y200, 6);
  });
});

describe('a flick', () => {
  it('coasts at most 2 spans', () => {
    const coast = flick(1e9, Y200, 0.3, 2);
    let day = year(1000);
    let left: typeof coast | null = coast;
    for (let i = 0; i < 600 && left; i += 1)
      ({ day, coast: left } = coastStep(day, left, 1 / 60, EXTENT, Y200));
    expect(left).toBeNull();
    expect(day - year(1000)).toBeLessThanOrEqual(2 * Y200 + 1e-6);
    expect(day - year(1000)).toBeGreaterThan(1.9 * Y200);
  });

  it('stops at history’s ends', () => {
    for (const dir of [-1, 1]) {
      let day = dir < 0 ? HISTORY.start + 0.3 * Y200 : HISTORY.end - 0.3 * Y200;
      let coast: ReturnType<typeof flick> | null = flick(dir * 1e9, Y200, 0.3, 2);
      let met = null;
      for (let i = 0; i < 600 && coast; i += 1) {
        const step = coastStep(day, coast, 1 / 60, EXTENT, Y200);
        [day, coast] = [step.day, step.coast];
        met ??= step.end;
      }
      expect(met).not.toBeNull();
      expect(day).toBe(dir < 0 ? HISTORY.start : HISTORY.end);
    }
  });
});

describe('a held arrow', () => {
  const GLIDE = { delayS: 0.3, from: 0.25, to: 0.85, rampS: 2 };
  it('waits 300 ms, then glides from a quarter of a span a second to 0.85 over 2 s', () => {
    expect(glideRate(0.1, GLIDE)).toBe(0);
    expect(glideRate(0.3, GLIDE)).toBeCloseTo(0.25, 9);
    expect(glideRate(1.3, GLIDE)).toBeCloseTo(0.55, 9);
    expect(glideRate(2.3, GLIDE)).toBeCloseTo(0.85, 9);
    expect(glideRate(9, GLIDE)).toBeCloseTo(0.85, 9);
  });
});

describe('steps', () => {
  it('land on the next tick either way, from a tick or between them', () => {
    const decades = { unit: 'year', every: 10 } as const;
    expect(nextTick(year(1815, 6, 18), 1, decades)).toBe(year(1820));
    expect(nextTick(year(1815, 6, 18), -1, decades)).toBe(year(1810));
    expect(nextTick(year(1820), 1, decades)).toBe(year(1830));
    expect(nextTick(year(1820), -1, decades)).toBe(year(1810));
    const days = { unit: 'day', every: 1 } as const;
    expect(nextTick(year(1815, 6, 18) + 0.4, 1, days)).toBe(year(1815, 6, 19));
    expect(nextTick(year(1815, 6, 18) + 0.4, -1, days)).toBe(year(1815, 6, 18));
  });

  it('land on BCE ticks in history’s numbering, across the era', () => {
    const twenty = { unit: 'year', every: 20 } as const;
    // 500 BCE is -499; 520 BCE and 480 BCE either side.
    expect(HISTORICAL.civil(nextTick(year(-499, 6, 1), 1, twenty)).year).toBe(-479);
    expect(HISTORICAL.civil(nextTick(year(-499, 6, 1), -1, twenty)).year).toBe(-499);
    expect(HISTORICAL.civil(nextTick(year(-499), -1, twenty)).year).toBe(-519);
    // From 20 BCE on: 1 CE, then 20 CE.
    expect(nextTick(year(-19), 1, twenty)).toBe(year(1));
    expect(nextTick(year(1), 1, twenty)).toBe(year(20));
    expect(nearestTick(year(-510), twenty)).toBe(year(-519));
  });
});

describe('the span’s detents', () => {
  it('run in order from 10 days to 5,000 years', () => {
    expect(SPAN_DETENTS[0]).toBe(10);
    expect(SPAN_DETENTS.at(-1)).toBe(5000 * YEAR_DAYS);
    for (let i = 1; i < SPAN_DETENTS.length; i += 1) {
      expect(SPAN_DETENTS[i]!).toBeGreaterThan(SPAN_DETENTS[i - 1]!);
    }
  });

  it('step one at a time from 200 years: 4 to the widest, 10 to the closest', () => {
    let span = Y200;
    let wider = 0;
    while (span < 5000 * YEAR_DAYS) [span, wider] = [nextDetent(span, 1), wider + 1];
    expect(wider).toBe(4);
    span = Y200;
    let closer = 0;
    while (span > 10) [span, closer] = [nextDetent(span, -1), closer + 1];
    expect(closer).toBe(10);
  });

  it('hold at either end, and treat within 2% as on a detent', () => {
    expect(nextDetent(5000 * YEAR_DAYS, 1)).toBe(5000 * YEAR_DAYS);
    expect(nextDetent(10, -1)).toBe(10);
    expect(nextDetent(Y200 * 1.01, 1)).toBe(500 * YEAR_DAYS);
    expect(nextDetent(Y200 * 0.99, -1)).toBe(100 * YEAR_DAYS);
    expect(nextDetent(300 * YEAR_DAYS, -1)).toBe(Y200);
  });
});
