// The date a visitor types on the ruler's plaque (explore/timeRuler.ts): a year, a month or a day,
// read as history writes it (story/dates.ts, HISTORICAL), so 1066 is the Julian year and 18 June
// 1815 the Gregorian day. A year lands on its middle day, a month on its 15th and a day on itself;
// a month narrows the tape to two years at most and a day to 60 days, so what was asked for shows.
// Pure, so it can be tested without a page.
import { HISTORICAL, type Calendar, type Precision } from '../story/dates';
import type { Span } from '../story/ui/format';
import { middleDay, YEAR_DAYS } from './overviewScale';

export type EntryRefusal = 'empty' | 'unread' | 'no-year-zero' | 'no-such-date' | 'outside';

export type Entry =
  | {
      ok: true;
      day: number;
      precision: Precision;
      /** The widest span that shows what was typed, days; none for a year. */
      maxSpan?: number;
    }
  | { ok: false; why: EntryRefusal };

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;

/** A month's number from its name, or its first three letters or more, or 0. */
function monthOf(word: string): number {
  if (word.length < 3) return 0;
  return MONTHS.findIndex((name) => name.startsWith(word)) + 1;
}

/**
 * Reads what was typed: "1066", "1066 CE" or "AD 1066", "500 BCE", "500 BC" or "500b", "-500"
 * (500 BCE), "June 1815", "18 June 1815", "June 18, 1815" and "1815-06-18" (ISO, astronomical
 * years). `history` is inclusive; years outside it, year 0, and days that never were (5-14 October
 * 1582) are refused.
 */
export function parseEntry(typed: string, history: Span, calendar: Calendar = HISTORICAL): Entry {
  let text = typed
    .trim()
    .toLowerCase()
    .replace(/[−–—]/g, '-')
    .replace(/(\d)[,\u202f](?=\d{3}\b)/g, '$1')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return { ok: false, why: 'empty' };
  let bce = false;
  let ce = false;
  const tail = /^(.*\d)\s*(b\.?\s?c\.?\s?e\.?|b\.?\s?c\.?|b|c\.?\s?e\.?|a\.?\s?d\.?)$/.exec(text);
  const leading = /^(a\.?\s?d\.?)\s*(?=\d)/;
  if (tail) {
    bce = tail[2]!.startsWith('b');
    ce = !bce;
    text = tail[1]!.trim();
  } else if (leading.test(text)) {
    ce = true;
    text = text.replace(leading, '');
  }

  let y: number;
  let m: number | null = null;
  let d: number | null = null;
  let astronomical = false;
  let match: RegExpExecArray | null;
  if ((match = /^(-?\d{1,5})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(text))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), match[3] ? Number(match[3]) : null];
    astronomical = true;
  } else if ((match = /^(\d{1,2}) ([a-z]+)\.? (-?\d{1,5})$/.exec(text))) {
    [d, m, y] = [Number(match[1]), monthOf(match[2]!), Number(match[3])];
  } else if ((match = /^([a-z]+)\.? (\d{1,2}) (-?\d{1,5})$/.exec(text))) {
    [m, d, y] = [monthOf(match[1]!), Number(match[2]), Number(match[3])];
  } else if ((match = /^([a-z]+)\.? (-?\d{1,5})$/.exec(text))) {
    [m, y] = [monthOf(match[1]!), Number(match[2])];
  } else if ((match = /^(-?)(\d{1,5})$/.exec(text))) {
    y = Number(match[2]);
    if (match[1]) bce = true;
  } else return { ok: false, why: 'unread' };

  if (m !== null && (m < 1 || m > 12)) return { ok: false, why: 'unread' };
  if (d !== null && (d < 1 || d > 31)) return { ok: false, why: 'no-such-date' };
  if (y < 0 && !astronomical) [y, bce] = [-y, true];
  if (bce && ce) return { ok: false, why: 'unread' };
  if (!astronomical && y === 0) return { ok: false, why: 'no-year-zero' };
  // History's numbering to the calendar's: 1 BCE is year 0.
  const year = astronomical ? y : bce ? 1 - y : y;
  const [first, last] = [calendar.civil(history.start).year, calendar.civil(history.end).year];
  if (year < first || year > last) return { ok: false, why: 'outside' };

  if (m === null) return { ok: true, day: middleDay(year, calendar), precision: 'year' };
  const date = { year, month: m, day: d ?? 15 };
  let day: number;
  try {
    day = calendar.day(date);
  } catch {
    return { ok: false, why: 'no-such-date' };
  }
  // A day past the month's end rolls into the next month, which names another date.
  const back = calendar.civil(day);
  if (back.month !== m || back.day !== date.day) return { ok: false, why: 'no-such-date' };
  if (day < history.start || day > history.end) return { ok: false, why: 'outside' };
  return d === null
    ? { ok: true, day, precision: 'month', maxSpan: 2 * YEAR_DAYS }
    : { ok: true, day, precision: 'day', maxSpan: 60 };
}
