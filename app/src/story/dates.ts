// Story time (streaming.md 3.0, Time): a day number since 0001-01-01 in the proleptic Gregorian
// calendar with astronomical years (1 BC is year 0), by integer arithmetic, since JS Date does not
// reach deep time. Fractional days are times within a day.
//
// Stories write their dates in that calendar (formatDay). Explore reads the same day numbers as
// history writes them (formatHistorical): in the Julian calendar before 15 October 1582, as
// sources date the events before the reform (Hastings on 14 October 1066, which Wikidata's export
// holds as 20 October), and in the Gregorian from then on, with years before 1 CE in BCE.

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

/** How a calendar names a day number, and the day number of a date it names. */
export interface Calendar {
  civil(dayNumber: number): Civil;
  day(date: Civil): number;
}

/** The proleptic Gregorian calendar, which day numbers count in and stories write. */
export const GREGORIAN: Calendar = { civil: civilFromDay, day: dayFromCivil };

/** Days from 0000-03-01 to 0001-01-03 in the Julian scheme below: 1 January 1 CE is 3 January. */
const JULIAN_EPOCH = 308;

/** The first Gregorian day, 15 October 1582, which follows 4 October 1582 in the Julian calendar. */
export const REFORM_DAY = dayFromCivil({ year: 1582, month: 10, day: 15 });

/** The day number of a date in the proleptic Julian calendar, astronomical years. */
export function dayFromJulian({ year, month, day }: Civil): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 4);
  const yoe = y - era * 4;
  const doy = Math.floor((153 * ((month + 9) % 12) + 2) / 5) + day - 1;
  return era * 1461 + yoe * 365 + doy - JULIAN_EPOCH;
}

/** The proleptic Julian date of a day number; a fractional day falls on the day it begins. */
export function julianFromDay(dayNumber: number): Civil {
  const z = Math.floor(dayNumber) + JULIAN_EPOCH;
  const era = Math.floor(z / 1461);
  const doe = z - era * 1461;
  const yoe = Math.floor((doe - Math.floor(doe / 1460)) / 365);
  const doy = doe - 365 * yoe;
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 4 + (month <= 2 ? 1 : 0), month, day };
}

/** A date as history writes it: Julian before 15 October 1582, Gregorian from then on. */
export function historicalCivil(dayNumber: number): Civil {
  return Math.floor(dayNumber) < REFORM_DAY ? julianFromDay(dayNumber) : civilFromDay(dayNumber);
}

/**
 * The day number of a historical date. 5-14 October 1582 never were, so they throw, as a date
 * that names no day should rather than stand for a neighbor.
 */
export function dayFromHistorical(date: Civil): number {
  const { year, month, day } = date;
  const order = year * 10000 + month * 100 + day;
  if (order >= 15821015) return dayFromCivil(date);
  if (order <= 15821004) return dayFromJulian(date);
  throw new RangeError(`${day} October 1582 fell in the calendar reform's gap`);
}

/** The calendar Explore reads: Julian before 15 October 1582, Gregorian from then on. */
export const HISTORICAL: Calendar = { civil: historicalCivil, day: dayFromHistorical };

const DASH = '–';

/** A historical year, BCE before 1 CE: '1066', '44 BCE', or '14 CE' beside a BCE year. */
function historicalYear(year: number, era = false): string {
  return year > 0 ? `${year}${era ? ' CE' : ''}` : `${1 - year} BCE`;
}

/**
 * A date as history writes it (historicalCivil), at its precision: '14 October 1066', 'March 44
 * BCE', '701 BCE'. Given its last day, a span: '5–10 April 1815', '3 March – 20 July 1453',
 * '16 December 1944 – 25 January 1945' or 'June–August 1816' while it runs less than a year, and
 * its years ('1756–1763', '264–241 BCE', '27 BCE – 14 CE') once longer. A span that stays within
 * one day, month or year at its precision (a year-dated event's 1 January to 31 December) reads
 * as that one date.
 */
export function formatHistorical(
  dayNumber: number,
  precision: Precision = 'day',
  lastDay = dayNumber,
): string {
  const [first, last] = [Math.min(dayNumber, lastDay), Math.max(dayNumber, lastDay)];
  const a = historicalCivil(first);
  const b = historicalCivil(last);
  const sameYear = a.year === b.year;
  const sameMonth = sameYear && a.month === b.month;
  const era = a.year <= 0 && b.year > 0;
  if (
    sameYear &&
    (precision === 'year' || (sameMonth && (precision === 'month' || a.day === b.day)))
  ) {
    return historicalDate(a, precision);
  }
  if (!sameYear && (precision === 'year' || Math.floor(last) - Math.floor(first) >= 365)) {
    if (era) return `${historicalYear(a.year)} ${DASH} ${historicalYear(b.year, true)}`;
    return b.year <= 0
      ? `${1 - a.year}${DASH}${historicalYear(b.year)}`
      : `${a.year}${DASH}${b.year}`;
  }
  if (precision === 'month') {
    if (sameYear)
      return `${monthName(a.month)}${DASH}${monthName(b.month)} ${historicalYear(b.year)}`;
    return `${historicalDate(a, 'month')} ${DASH} ${historicalDate(b, 'month', era)}`;
  }
  if (sameMonth) return `${a.day}${DASH}${b.day} ${monthName(b.month)} ${historicalYear(b.year)}`;
  if (sameYear) {
    return `${a.day} ${monthName(a.month)} ${DASH} ${b.day} ${monthName(b.month)} ${historicalYear(b.year)}`;
  }
  return `${historicalDate(a, 'day')} ${DASH} ${historicalDate(b, 'day', era)}`;
}

function historicalDate({ year, month, day }: Civil, precision: Precision, era = false): string {
  const y = historicalYear(year, era);
  if (precision === 'year') return y;
  return precision === 'month' ? `${monthName(month)} ${y}` : `${day} ${monthName(month)} ${y}`;
}
