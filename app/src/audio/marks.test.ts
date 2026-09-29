import { describe, expect, it } from 'vitest';
import { dayFromHistorical, dayFromIso, HISTORICAL } from '../story/dates';
import { HISTORY } from '../time/exploreTime';
import { markAt, marksPassed } from './marks';

/** The day history writes as `year`-`month`-`day`, astronomical years. */
const on = (year: number, month = 1, day = 1) => dayFromHistorical({ year, month, day });

describe("the ruler's marks", () => {
  it('passes the marks the ruler engraves, each weighted by what it begins', () => {
    const [from, to] = [dayFromIso('1815-12-30') + 0.5, dayFromIso('1816-01-02') + 0.5];
    const weights = (finest: 'day' | 'month' | 'year') =>
      marksPassed(from, to, finest).map((mark) => mark.weight);
    expect(weights('day')).toEqual(['day', 'year', 'day']);
    expect(weights('month')).toEqual(['year']);
    expect(marksPassed(to, from, 'day').map((mark) => mark.day)).toEqual([
      dayFromIso('1816-01-02'),
      dayFromIso('1816-01-01'),
      dayFromIso('1815-12-31'),
    ]);
  });

  it('walks months and years the same as it walks days', () => {
    const [from, to] = [dayFromIso('1812-03-14') + 0.5, dayFromIso('1817-11-02') + 0.5];
    const byDay = marksPassed(from, to, 'day');
    for (const finest of ['month', 'year'] as const) {
      const rank = finest === 'month' ? ['month', 'year'] : ['year'];
      expect(marksPassed(from, to, finest)).toEqual(
        byDay.filter((mark) => rank.includes(mark.weight)),
      );
    }
  });
});

describe("the free ruler's marks", () => {
  const history = { calendar: HISTORICAL };

  it('passes the months history writes, across the reform', () => {
    const marks = marksPassed(on(1582, 9, 20), on(1582, 11, 5), 'month', history);
    expect(marks).toEqual([
      { day: on(1582, 10, 1), weight: 'month' },
      { day: on(1582, 11, 1), weight: 'month' },
    ]);
    // Julian 4 October is followed by Gregorian 15 October, a day and not a month's first.
    expect(markAt(on(1582, 10, 4) + 1, HISTORICAL)).toEqual({
      day: on(1582, 10, 15),
      weight: 'day',
    });
  });

  it('passes each labelled year of the step the ruler labels, in the order it passes them', () => {
    const centuries = (from: number, to: number) =>
      marksPassed(from, to, 'year', { ...history, yearStep: 100 }).map((mark) => mark.day);
    expect(centuries(on(1750, 6), on(1950, 6))).toEqual([on(1800), on(1900)]);
    expect(centuries(on(1950, 6), on(1750, 6))).toEqual([on(1900), on(1800)]);
    // Before the era, labelled years count back from 1 CE: 2000 BCE is astronomical -1999.
    const millennia = marksPassed(on(-2499, 6), on(1500, 6), 'year', {
      ...history,
      yearStep: 1000,
    });
    expect(millennia.map((mark) => mark.day)).toEqual([on(-1999), on(-999), on(1), on(1000)]);
    expect(millennia.every((mark) => mark.weight === 'year')).toBe(true);
  });

  it('walks coarser marks through a leap across all of history, and at most `most` of them', () => {
    const most = 400;
    // Twelve thousand years pass: too many years, and decades, for `most`, but not centuries.
    const labelled = (year: number) =>
      year <= 0 ? (1 - year) % 100 === 0 : year === 1 || year % 100 === 0;
    for (const finest of ['day', 'month', 'year'] as const) {
      const marks = marksPassed(HISTORY.start, HISTORY.end, finest, { ...history, most });
      expect(marks).toHaveLength(99 + 1 + 20);
      expect(marks.every((mark) => mark.weight === 'year')).toBe(true);
      expect(marks.every((mark) => labelled(HISTORICAL.civil(mark.day).year))).toBe(true);
      expect(marks.every((mark) => HISTORICAL.civil(mark.day).day === 1)).toBe(true);
    }
    // A drag within the bound keeps every day.
    const days = marksPassed(on(1815, 3, 1), on(1815, 6, 1), 'day', { ...history, most });
    expect(days).toHaveLength(on(1815, 6, 1) - on(1815, 3, 1));
  });
});
