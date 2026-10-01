import { describe, expect, it } from 'vitest';
import { dayFromHistorical, dayFromIso, HISTORICAL } from '../story/dates';
import { parseEntry, refusalText } from './dateEntry';
import { HISTORY } from './exploreTime';
import { middleDay, YEAR_DAYS } from './overviewScale';

const parse = (text: string) => parseEntry(text, HISTORY);
const dayOf = (text: string) => {
  const entry = parse(text);
  if (!entry.ok) throw new Error(`${text}: ${entry.why}`);
  return entry.day;
};

describe('a typed date', () => {
  it('reads a year in every common form, landing on its middle day', () => {
    const middle = middleDay(1066);
    for (const text of ['1066', '1066 CE', '1066 AD', 'AD 1066', '1066ce', ' 1066 ']) {
      expect(parse(text)).toEqual({ ok: true, day: middle, precision: 'year' });
    }
  });

  it('reads BCE years by name, by b, and by a minus', () => {
    const middle = middleDay(-499);
    for (const text of ['500 BCE', '500 BC', '500 B.C.', '500b', '500 b', '-500', '−500']) {
      expect(dayOf(text)).toBe(middle);
    }
    expect(HISTORICAL.civil(middle)).toMatchObject({ year: -499, month: 7 });
  });

  it('reads 1066 as history writes it, in the Julian calendar', () => {
    const start = dayFromHistorical({ year: 1066, month: 1, day: 1 });
    expect(start).toBe(dayFromIso('1066-01-07'));
    expect(dayOf('1066')).toBe(
      Math.floor((start + dayFromHistorical({ year: 1067, month: 1, day: 1 })) / 2),
    );
    expect(dayOf('14 October 1066')).toBe(dayFromIso('1066-10-20'));
  });

  it('reads months and days, narrowing the tape to show them', () => {
    expect(parse('June 1815')).toEqual({
      ok: true,
      day: dayFromIso('1815-06-15'),
      precision: 'month',
      maxSpan: 2 * YEAR_DAYS,
    });
    for (const text of ['18 June 1815', 'June 18, 1815', '18 jun 1815', '1815-06-18']) {
      expect(parse(text)).toEqual({
        ok: true,
        day: dayFromIso('1815-06-18'),
        precision: 'day',
        maxSpan: 60,
      });
    }
    expect(dayOf('Sept 1752')).toBe(dayFromIso('1752-09-15'));
  });

  it.each([
    ['0', 'no-year-zero'],
    ['0 BCE', 'no-year-zero'],
    ['2001', 'outside'],
    ['10,001 BCE', 'outside'],
    ['−10001', 'outside'],
    ['', 'empty'],
    ['soon', 'unread'],
    ['31 February 1815', 'no-such-date'],
    ['10 October 1582', 'no-such-date'],
    ['June 2001', 'outside'],
  ])('refuses %j (%s)', (text, why) => {
    expect(parse(text)).toEqual({ ok: false, why });
  });

  it('reaches history’s first and last years', () => {
    expect(HISTORICAL.civil(dayOf('10,000 BCE')).year).toBe(-9999);
    expect(HISTORICAL.civil(dayOf('2000')).year).toBe(2000);
    expect(dayOf('31 December 2000')).toBe(HISTORY.end);
  });
});

describe('a refused date', () => {
  it.each([
    ['hello', 'hello is not a date. Type a year, as 1066 or 500 BCE, or a day, as 18 June 1815.'],
    ['0', 'There is no year 0: 1 BCE runs into 1 CE.'],
    ['31 February 1815', 'There is no 31 February 1815 in the calendar.'],
    ['12000 BCE', '12000 BCE is outside 10,000 BCE to 2000.'],
    [' 3000 ', '3000 is outside 10,000 BCE to 2000.'],
  ])('says what is wrong with %j', (text, words) => {
    const entry = parse(text);
    if (entry.ok || entry.why === 'empty') throw new Error(`${text} was not refused`);
    expect(refusalText(entry.why, text, HISTORY)).toBe(words);
  });
});
