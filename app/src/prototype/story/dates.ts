// Story time (streaming.md 3.0, Time): a day number since 0001-01-01 in the proleptic Gregorian
// calendar with astronomical years (1 BC is year 0), by integer arithmetic, since JS Date does not
// reach deep time. Fractional days are times within a day.

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Days from 0000-03-01 to 0001-01-01 in the civil-from-days scheme below. */
const EPOCH = 306;

export interface Civil {
  year: number;
  /** 1-12. */
  month: number;
  /** 1-31. */
  day: number;
}

export type Precision = 'day' | 'month' | 'year';

/** The day number of a civil date. */
export function dayFromCivil({ year, month, day }: Civil): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - EPOCH;
}

/** The civil date of a day number; a fractional day falls on the day it begins. */
export function civilFromDay(dayNumber: number): Civil {
  const z = Math.floor(dayNumber) + EPOCH;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

/** An ISO-8601 date, astronomical years, e.g. '1815-04-10' or '-0099-03-01'. */
export function dayFromIso(iso: string): number {
  const match = /^(-?\d{4,})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) throw new RangeError(`not an ISO date: ${iso}`);
  return dayFromCivil({ year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) });
}

export function isoFromDay(dayNumber: number): string {
  const { year, month, day } = civilFromDay(dayNumber);
  const y = year < 0 ? `-${String(-year).padStart(4, '0')}` : String(year).padStart(4, '0');
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** A historical year: astronomical 0 is 1 BC. */
export function yearLabel(year: number): string {
  return year > 0 ? String(year) : `${1 - year} BC`;
}

export function monthName(month: number): string {
  return MONTHS[month - 1] ?? '';
}

/** '10 April 1815', 'April 1815' or '1815'. */
export function formatDay(dayNumber: number, precision: Precision = 'day'): string {
  const { year, month, day } = civilFromDay(dayNumber);
  if (precision === 'year') return yearLabel(year);
  if (precision === 'month') return `${monthName(month)} ${yearLabel(year)}`;
  return `${day} ${monthName(month)} ${yearLabel(year)}`;
}
