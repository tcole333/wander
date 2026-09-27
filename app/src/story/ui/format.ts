// Pure helpers for the walk's UI: the card's date line, the time ruler's calendar and beat pips,
// Meanwhile's compass bearings, and plain credits from Commons metadata.
import { civilFromDay, dayFromCivil, formatDay, monthName, yearLabel } from '../dates';
import type { LonLat, StoryBeat } from '../story';

const DASH = '–';

/**
 * The card's date line: the beat's date at its precision, or its window where that says more: a
 * few days at day precision ('5–10 April 1815'), or whole months at month precision ('June–August
 * 1816'). Long windows (an aftermath, a season of famine) fall back to the beat's own date.
 */
export function dateLine(beat: StoryBeat): string {
  const [start, end] = beat.window ?? [beat.day, beat.day];
  if (beat.precision === 'day' && end > start && end - start <= 31) return dayRange(start, end);
  if (beat.precision === 'month' && wholeMonths(start, end)) return monthRange(start, end);
  return formatDay(beat.day, beat.precision);
}

function dayRange(start: number, end: number): string {
  const a = civilFromDay(start);
  const b = civilFromDay(end);
  if (a.year !== b.year) return `${formatDay(start)} ${DASH} ${formatDay(end)}`;
  if (a.month !== b.month) {
    return `${a.day} ${monthName(a.month)} ${DASH} ${b.day} ${monthName(b.month)} ${yearLabel(b.year)}`;
  }
  return `${a.day}${DASH}${b.day} ${monthName(b.month)} ${yearLabel(b.year)}`;
}

function monthRange(start: number, end: number): string {
  const a = civilFromDay(start);
  const b = civilFromDay(end);
  if (a.year !== b.year) return `${formatDay(start, 'month')} ${DASH} ${formatDay(end, 'month')}`;
  if (a.month === b.month) return formatDay(start, 'month');
  return `${monthName(a.month)}${DASH}${monthName(b.month)} ${yearLabel(b.year)}`;
}

/** Whether [start, end] runs from the first of a month to the last day of a month. */
function wholeMonths(start: number, end: number): boolean {
  return civilFromDay(start).day === 1 && civilFromDay(end + 1).day === 1 && end > start;
}

export interface Span {
  start: number;
  end: number;
}

/** The least span of the ruler, days: an eruption's days stay days wide. */
const MIN_SPAN_DAYS = 40;

/**
 * A beat's stretch of the ruler: its window and date with a tenth of their length either side,
 * and at least MIN_SPAN_DAYS, so each beat shows its own time in days, months or years.
 */
export function beatSpan(beat: StoryBeat): Span {
  const [from, to] = beat.window ?? [beat.day, beat.day];
  const first = Math.min(from, beat.day);
  const last = Math.max(to, beat.day);
  const width = Math.max(MIN_SPAN_DAYS, 1.2 * (last - first));
  const center = (first + last) / 2;
  return { start: center - width / 2, end: center + width / 2 };
}

/**
 * The ruler's span `t` of the way from `a` to `b`, with the playhead at `day`: the width eases in
 * log space, and the playhead's place along the rule moves from `aAt` (its share of `a` when the
 * move began) to where `day` falls on `b`, so the playhead stays on the rule as it zooms.
 */
export function mixSpans(a: Span, b: Span, aAt: number, day: number, t: number): Span {
  const [widthA, widthB] = [a.end - a.start, b.end - b.start];
  const width = widthA * (widthB / widthA) ** t;
  const bAt = (day - b.start) / widthB;
  const at = Math.min(1, Math.max(0, aAt + (bAt - aAt) * t));
  return { start: day - at * width, end: day + (1 - at) * width };
}

export interface MonthMark {
  year: number;
  /** 1-12. */
  month: number;
  /** The month's first day, which may lie before the span. */
  start: number;
  /** The next month's first day. */
  end: number;
}

/** Every month the span touches, in order. */
export function monthsIn(span: Span): MonthMark[] {
  const months: MonthMark[] = [];
  let { year, month } = civilFromDay(span.start);
  let start = dayFromCivil({ year, month, day: 1 });
  while (start < span.end) {
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const end = dayFromCivil({ year: nextYear, month: nextMonth, day: 1 });
    months.push({ year, month, start, end });
    [year, month, start] = [nextYear, nextMonth, end];
  }
  return months;
}

/** 'Jan', 'Feb', ... */
export function monthAbbrev(month: number): string {
  return monthName(month).slice(0, 3);
}

/**
 * Pip positions for points at `xs`, spread to at least `gap` apart and kept in [lo, hi]: crowded
 * points fan out around where they fall, in their order along the axis.
 */
export function spreadPips(xs: number[], gap: number, lo: number, hi: number): number[] {
  const order = xs.map((_, i) => i).sort((a, b) => (xs[a] ?? 0) - (xs[b] ?? 0));
  const p = order.map((i) => xs[i] ?? 0);
  const n = p.length;
  for (let pass = 0; pass < 200; pass += 1) {
    let moved = false;
    for (let k = 1; k < n; k += 1) {
      const overlap = gap - ((p[k] ?? 0) - (p[k - 1] ?? 0));
      if (overlap > 1e-6) {
        p[k - 1] = (p[k - 1] ?? 0) - overlap / 2;
        p[k] = (p[k] ?? 0) + overlap / 2;
        moved = true;
      }
    }
    for (let k = 0; k < n; k += 1) {
      p[k] = Math.min(hi - (n - 1 - k) * gap, Math.max(lo + k * gap, p[k] ?? 0));
    }
    if (!moved) break;
  }
  const spread = new Array<number>(n);
  order.forEach((i, k) => (spread[i] = p[k] ?? 0));
  return spread;
}

const DEG = Math.PI / 180;

/** The initial great-circle bearing from `from` to `to`, degrees clockwise from north, 0-360. */
export function bearingDeg([lon1, lat1]: LonLat, [lon2, lat2]: LonLat): number {
  const [p1, p2] = [lat1 * DEG, lat2 * DEG];
  const dLon = (lon2 - lon1) * DEG;
  const y = Math.sin(dLon) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLon);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** The nearest of the eight compass points. */
export function compassPoint(deg: number): string {
  return POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8] ?? 'N';
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Text from a Commons metadata value, which is HTML: tags dropped, entities decoded. */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (whole, code: string) => {
      if (code.startsWith('#x') || code.startsWith('#X')) {
        return String.fromCodePoint(parseInt(code.slice(2), 16));
      }
      if (code.startsWith('#')) return String.fromCodePoint(Number(code.slice(1)));
      return ENTITIES[code] ?? whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** A catalog name as people write it: 'Pinkerton, John, 1758-1826' is 'John Pinkerton'. */
export function personName(name: string): string {
  const bare = name.replace(/,\s*(c\.\s*)?[\d?]{3,4}\s*[-–]\s*[\d?]{0,4}\s*$/, '').trim();
  const inverted = /^([^,]+),\s*([^,]+)$/.exec(bare);
  return inverted ? `${inverted[2]} ${inverted[1]}` : bare;
}

/**
 * The image card's one-line credit from Commons' Artist, Credit and LicenseShortName values:
 * the artists (each list item a name), or failing that the credit, then the license.
 */
export function creditLine(artistHtml: string, creditHtml: string, license: string): string {
  const names = artistHtml
    .split(/<\/(?:dd|li)>/i)
    .map((part) => personName(plainText(part)))
    .filter((name) => name.length > 0);
  const who = names.length > 0 ? names.join(', ') : plainText(creditHtml);
  return [who, plainText(license)].filter((part) => part.length > 0).join(' · ');
}

/** Typographer's quotes for straight ones: "like fire" becomes “like fire”, Tambora's Tambora’s. */
export function curlyQuotes(text: string): string {
  return text
    .replace(/(^|[\s([–—])"/g, '$1“')
    .replace(/"/g, '”')
    .replace(/(^|[\s([–—])'/g, '$1‘')
    .replace(/'/g, '’');
}
