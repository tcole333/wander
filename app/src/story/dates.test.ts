import { describe, expect, it } from 'vitest';
import {
  civilFromDay,
  dayFromHistorical,
  dayFromIso,
  dayFromJulian,
  formatDay,
  formatHistorical,
  historicalCivil,
  isoFromDay,
  julianFromDay,
  REFORM_DAY,
  type Civil,
} from './dates';

/**
 * Proleptic Gregorian days, as Wikidata's export and the event index hold them, and the dates
 * history writes for them; pipeline/tests/test_events.py mirrors these.
 */
const HISTORICAL_DATES: [string, Civil][] = [
  ['1066-10-20', { year: 1066, month: 10, day: 14 }], // Hastings
  ['-0043-03-13', { year: -43, month: 3, day: 15 }], // Caesar's death
  ['-0030-08-31', { year: -30, month: 9, day: 2 }], // Actium
  ['1571-10-17', { year: 1571, month: 10, day: 7 }], // Lepanto
  ['1500-03-10', { year: 1500, month: 2, day: 29 }], // a Julian leap day
  ['0000-12-30', { year: 1, month: 1, day: 1 }],
  ['0001-01-01', { year: 1, month: 1, day: 3 }],
  ['-9999-01-01', { year: -9999, month: 3, day: 19 }],
  ['1582-10-14', { year: 1582, month: 10, day: 4 }], // the last Julian day
  ['1582-10-15', { year: 1582, month: 10, day: 15 }], // the first Gregorian day
  ['1815-06-18', { year: 1815, month: 6, day: 18 }], // Waterloo
  ['2000-12-31', { year: 2000, month: 12, day: 31 }],
];

describe('the historical calendar', () => {
  it.each(HISTORICAL_DATES)('writes the day %s as history does', (iso, historical) => {
    const day = dayFromIso(iso);
    expect(historicalCivil(day)).toEqual(historical);
    expect(historicalCivil(day + 0.75)).toEqual(historical);
    expect(dayFromHistorical(historical)).toBe(day);
  });

  it('reads Hastings as 14 October 1066 and Caesar’s death as 15 March 44 BCE', () => {
    expect(formatHistorical(dayFromIso('1066-10-20'))).toBe('14 October 1066');
    expect(formatHistorical(dayFromIso('-0043-03-13'))).toBe('15 March 44 BCE');
  });

  it('switches from 4 to 15 October 1582, and 5-14 October never were', () => {
    expect(formatHistorical(REFORM_DAY - 1)).toBe('4 October 1582');
    expect(formatHistorical(REFORM_DAY)).toBe('15 October 1582');
    expect(dayFromHistorical({ year: 1582, month: 10, day: 4 }) + 1).toBe(REFORM_DAY);
    for (const day of [5, 10, 14]) {
      expect(() => dayFromHistorical({ year: 1582, month: 10, day })).toThrow(RangeError);
    }
  });

  it('counts Julian days without a gap across the era seam, a leap day every four years', () => {
    const start = dayFromJulian({ year: -200, month: 1, day: 1 });
    let previous = julianFromDay(start);
    let leapDays = 0;
    for (let day = start + 1; day < start + 100 * 1461; day += 1) {
      const date = julianFromDay(day);
      if (date.month === 2 && date.day === 29) {
        expect(((date.year % 4) + 4) % 4).toBe(0);
        leapDays += 1;
      }
      if (date.day !== 1) expect(date.day).toBe(previous.day + 1);
      expect(dayFromJulian(date)).toBe(day);
      previous = date;
    }
    expect(leapDays).toBe(100);
  });

  it('leaves the stories’ Gregorian dates as they are written', () => {
    const mactan = dayFromIso('1521-04-27');
    expect(formatDay(mactan)).toBe('27 April 1521');
    expect(formatHistorical(mactan)).toBe('17 April 1521');
    expect(civilFromDay(mactan)).toEqual({ year: 1521, month: 4, day: 27 });
    expect(isoFromDay(mactan)).toBe('1521-04-27');
  });

  it('names a month or a year at its precision', () => {
    const march = dayFromHistorical({ year: -43, month: 3, day: 1 });
    expect(formatHistorical(march, 'month')).toBe('March 44 BCE');
    expect(formatHistorical(dayFromHistorical({ year: -700, month: 1, day: 1 }), 'year')).toBe(
      '701 BCE',
    );
    expect(formatHistorical(dayFromHistorical({ year: 1066, month: 1, day: 1 }), 'year')).toBe(
      '1066',
    );
  });

  it('reads a span that stays within its precision as its one date', () => {
    const year = (y: number): [number, number] => [
      dayFromHistorical({ year: y, month: 1, day: 1 }),
      dayFromHistorical({ year: y, month: 12, day: 31 }),
    ];
    const [a, b] = year(-700);
    expect(formatHistorical(a, 'year', b)).toBe('701 BCE');
    const [c, d] = year(1066);
    expect(formatHistorical(c, 'year', d)).toBe('1066');
    const july = dayFromIso('1816-07-01');
    expect(formatHistorical(july, 'month', dayFromIso('1816-07-31'))).toBe('July 1816');
    expect(formatHistorical(july + 0.5, 'day', july + 0.9)).toBe('1 July 1816');
  });

  it('writes spans in days, months or years as their length allows', () => {
    /** A historical date written as an ISO day, as history dates it. */
    const historical = (iso: string) => {
      const civil = civilFromDay(dayFromIso(iso));
      return dayFromHistorical(civil);
    };
    const span = (from: string, to: string, precision: 'day' | 'month' | 'year' = 'day') =>
      formatHistorical(historical(from), precision, historical(to));
    expect(span('1815-04-05', '1815-04-10')).toBe('5–10 April 1815');
    expect(span('1453-04-06', '1453-05-29')).toBe('6 April – 29 May 1453');
    expect(span('1944-12-16', '1945-01-25')).toBe('16 December 1944 – 25 January 1945');
    expect(span('1816-06-01', '1816-08-31', 'month')).toBe('June–August 1816');
    expect(span('1917-11-01', '1918-03-31', 'month')).toBe('November 1917 – March 1918');
    expect(span('1756-05-17', '1763-02-15')).toBe('1756–1763');
    expect(span('-0263-01-01', '-0240-12-31', 'year')).toBe('264–241 BCE');
    expect(span('-0026-01-01', '0014-08-19', 'year')).toBe('27 BCE – 14 CE');
    expect(span('0000-12-27', '0001-01-12')).toBe('27 December 1 BCE – 12 January 1 CE');
    expect(formatHistorical(historical('1763-02-15'), 'day', historical('1756-05-17'))).toBe(
      '1756–1763',
    );
  });
});
