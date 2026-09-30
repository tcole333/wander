import { describe, expect, it } from 'vitest';
import { dayFromHistorical, dayFromIso, HISTORICAL, REFORM_DAY } from '../story/dates';
import { HISTORY } from './exploreTime';
import { YEAR_DAYS } from './overviewScale';
import {
  engraveTape,
  graduation,
  seriesTicks,
  TAPE_FADE_PX,
  tapeFade,
  type TapeEngraving,
} from './tapeScale';

const EXTENT = { start: HISTORY.start, end: HISTORY.end + 1 };
/** The tape's rule at 1440 px wide (explore/timeRuler.ts). */
const RULE_PX = 1262;
const WATERLOO = dayFromIso('1815-06-18');

/** The tape as the ruler engraves it: three spans about `center`. */
function engrave(center: number, span: number, rulePx = RULE_PX): TapeEngraving {
  return engraveTape(
    { start: center - 1.5 * span, end: center + 1.5 * span },
    span,
    rulePx,
    EXTENT,
  );
}

describe("the tape's tiers", () => {
  it('labels every 20 years at 200 years across 1440 px, with 10- and 2-year ticks', () => {
    const { label, mid, fine } = graduation(200 * YEAR_DAYS, RULE_PX, WATERLOO);
    expect([label, mid, fine]).toEqual([
      { unit: 'year', every: 20 },
      { unit: 'year', every: 10 },
      { unit: 'year', every: 2 },
    ]);
  });

  it.each([
    [5000 * YEAR_DAYS, 'year', 500],
    [200 * YEAR_DAYS, 'year', 20],
    [20 * YEAR_DAYS, 'year', 2],
    [2 * YEAR_DAYS, 'month', 1],
    [30, 'day', 1],
  ] as const)('tells the sound what it labels at %s days', (span, unit, yearStep) => {
    expect(graduation(span, RULE_PX, WATERLOO)).toMatchObject({ unit, yearStep });
  });

  it('keeps its fine ticks at least 6 px apart and each tier off the others', () => {
    for (const years of [5000, 1000, 200, 20, 5, 2, 1, 0.25]) {
      const span = years * YEAR_DAYS;
      const { ticks } = engrave(WATERLOO, span);
      const all = [...ticks.label, ...ticks.mid, ...ticks.fine];
      expect(new Set(all).size).toBe(all.length);
      const px = RULE_PX / span;
      const fine = [...ticks.fine].sort((a, b) => a - b);
      for (let i = 1; i < fine.length; i += 1) {
        // Months and years vary in length; none is under 28 days or 365.
        expect((fine[i]! - fine[i - 1]!) * px).toBeGreaterThanOrEqual(6 * 0.9);
      }
    }
  });
});

describe("the tape's labels", () => {
  it('fade over the last 46 px at each reel, so none stands whole there', () => {
    expect(tapeFade(0, RULE_PX)).toBe(0);
    expect(tapeFade(RULE_PX, RULE_PX)).toBe(0);
    expect(tapeFade(TAPE_FADE_PX / 2, RULE_PX)).toBeCloseTo(0.5, 6);
    expect(tapeFade(TAPE_FADE_PX - 0.5, RULE_PX)).toBeLessThan(1);
    expect(tapeFade(TAPE_FADE_PX, RULE_PX)).toBe(1);
    expect(tapeFade(RULE_PX / 2, RULE_PX)).toBe(1);
  });

  it('never names a year 0 across 1 BCE and 1 CE', () => {
    const era = dayFromHistorical({ year: 1, month: 1, day: 1 });
    for (const years of [2000, 200, 20, 5, 2]) {
      const texts = engrave(era, years * YEAR_DAYS).labels.map((l) => l.text);
      expect(texts.some((t) => /^0( |$)/.test(t))).toBe(false);
    }
    const texts = engrave(era, 20 * YEAR_DAYS).labels.map((l) => l.text);
    expect(texts).toEqual(expect.arrayContaining(['2 BCE', '1 CE', '2 CE']));
  });

  it('goes from 4 October 1582 to the 15th at days, as history does', () => {
    const texts = engrave(REFORM_DAY, 20).labels.map((l) => l.text);
    const at = texts.indexOf('4');
    expect(at).toBeGreaterThan(-1);
    expect(texts.slice(at - 1, at + 3)).toEqual(['3', '4', '15', '16']);
  });

  it('names months, and January by its year, at month scale', () => {
    const { labels } = engrave(WATERLOO, 2 * YEAR_DAYS);
    const texts = labels.map((l) => l.text);
    expect(texts).toEqual(expect.arrayContaining(['1815', 'FEB', 'JUN', 'DEC', '1816']));
    expect(texts).not.toContain('JAN');
    const january = labels.find((l) => l.text === '1816')!;
    expect(HISTORICAL.civil(january.day)).toEqual({ year: 1816, month: 1, day: 1 });
  });

  it('numbers days, each 1st carrying its month, at day scale', () => {
    const { labels } = engrave(WATERLOO, 30);
    const texts = labels.map((l) => l.text);
    expect(texts).toEqual(expect.arrayContaining(['JUNE', '17', '18', '19', 'JULY']));
    const june = labels.find((l) => l.text === 'JUNE')!;
    expect(june.day).toBe(dayFromIso('1815-06-01'));
    expect(june.face).toBe('caps');
  });

  it('keeps every label clear of its neighbours', () => {
    for (const span of [5000 * YEAR_DAYS, 200 * YEAR_DAYS, 2 * YEAR_DAYS, 0.5 * YEAR_DAYS, 30]) {
      const { labels } = engrave(WATERLOO, span);
      const px = RULE_PX / span;
      for (let i = 1; i < labels.length; i += 1) {
        expect((labels[i]!.day - labels[i - 1]!.day) * px).toBeGreaterThan(10);
      }
    }
  });
});

describe("the tape past history's ends", () => {
  it('runs on as leader from exactly history’s first day and its end', () => {
    const span = 200 * YEAR_DAYS;
    const start = engrave(HISTORY.start + 10 * YEAR_DAYS, span);
    expect(start.leaders[0]).toEqual({ start: start.leaders[0]!.start, end: HISTORY.start });
    expect(start.stops).toEqual([{ day: HISTORY.start, side: 'start' }]);
    const end = engrave(HISTORY.end - 10 * YEAR_DAYS, span);
    expect(end.leaders.at(-1)).toEqual({ start: HISTORY.end + 1, end: end.leaders.at(-1)!.end });
    expect(end.stops).toEqual([{ day: HISTORY.end + 1, side: 'end' }]);
  });

  it('cuts nothing past history, and names each stop on history’s side', () => {
    const span = 200 * YEAR_DAYS;
    const start = engrave(HISTORY.start, span);
    const cut = [...start.ticks.label, ...start.ticks.mid, ...start.ticks.fine];
    expect(Math.min(...cut)).toBeGreaterThanOrEqual(HISTORY.start);
    expect(start.labels[0]).toMatchObject({ text: '10,000 BCE', anchor: 'start' });
    const end = engrave(HISTORY.end, span);
    const endCut = [...end.ticks.label, ...end.ticks.mid, ...end.ticks.fine];
    expect(Math.max(...endCut)).toBeLessThan(HISTORY.end + 1);
    expect(end.labels.at(-1)).toMatchObject({ text: '2000', anchor: 'end' });
  });
});

describe('a series’ ticks', () => {
  it('fall on history’s years, months and days', () => {
    const range = { start: dayFromIso('1814-12-01'), end: dayFromIso('1816-02-01') };
    expect(seriesTicks({ unit: 'year', every: 1 }, range)).toEqual([
      dayFromIso('1815-01-01'),
      dayFromIso('1816-01-01'),
    ]);
    expect(seriesTicks({ unit: 'month', every: 6 }, range)).toEqual([
      dayFromIso('1815-01-01'),
      dayFromIso('1815-07-01'),
      dayFromIso('1816-01-01'),
    ]);
    const june = { start: dayFromIso('1815-06-01'), end: dayFromIso('1815-06-30') };
    expect(
      seriesTicks({ unit: 'day', every: 10 }, june).map((d) => HISTORICAL.civil(d).day),
    ).toEqual([1, 10, 20]);
  });
});
