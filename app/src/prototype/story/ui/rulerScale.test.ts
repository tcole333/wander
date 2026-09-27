import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dayFromIso } from '../dates';
import { parseStory } from '../story';
import { beatSpan, type Span } from './format';
import {
  anchored,
  arcFor,
  engraveScale,
  LOWER_ROW,
  storyYears,
  TIER_REACH,
  tierAngle,
  type Label,
} from './rulerScale';

const story = parseStory(
  readFileSync(new URL('../../../../../stories/tambora/story.md', import.meta.url), 'utf8'),
);
const arc = arcFor(1440);

function engrave(span: Span): Label[] {
  const angle = (day: number) =>
    ((2 * (day - span.start)) / (span.end - span.start) - 1) * arc.reach;
  return engraveScale(arc, span, angle).labels;
}

/** A span of `days` from 1 March 1815. */
function daysFrom(days: number): Span {
  const start = dayFromIso('1815-03-01');
  return { start, end: start + days };
}

/** A label's length along the band, px, from its face's size and spacing (rulerCraft.css), generously. */
function length(label: Label): number {
  const [size, spacing] = label.cls.includes('is-year')
    ? [15, 0.1]
    : label.cls.includes('rc-upper')
      ? [11, 0.24]
      : label.cls.includes('rc-month')
        ? [11, 0.16]
        : label.cls.includes('rc-year')
          ? [16, 0.05]
          : [12.5, 0];
  return label.text.length * size * (0.66 + spacing);
}

const SPANS = [
  ...story.beats.map(beatSpan),
  daysFrom(40),
  daysFrom(90),
  daysFrom(200),
  daysFrom(500),
  daysFrom(1100),
  daysFrom(4000),
];

describe('the crafted ruler', () => {
  it('engraves every span in calendar words and numbers, never decimals', () => {
    const calendar = /^(\d{1,2}|[A-Z]{3}|[A-Z]+ \d{4}|\d{4})$/;
    for (const span of SPANS) {
      for (const label of engrave(span)) expect(label.text).toMatch(calendar);
    }
  });

  it('numbers days, names months, or names years, as the span allows', () => {
    const lower = (span: Span) =>
      engrave(span)
        .filter((label) => label.row === LOWER_ROW)
        .map((label) => label.text);
    expect(lower(beatSpan(story.beats[2]!))).toContain('10');
    expect(engrave(beatSpan(story.beats[2]!)).map((label) => label.text)).toContain('APRIL 1815');
    expect(lower(daysFrom(500))).toContain('JUL');
    expect(lower(daysFrom(4000))).toContain('1820');
  });

  it('keeps each row clear: no label runs into its neighbor', () => {
    for (const span of SPANS) {
      const rows = new Map<number, Label[]>();
      for (const label of engrave(span))
        rows.set(label.row, [...(rows.get(label.row) ?? []), label]);
      for (const row of rows.values()) {
        row.sort((a, b) => a.angle - b.angle);
        for (let k = 1; k < row.length; k += 1) {
          const [a, b] = [row[k - 1]!, row[k]!];
          const apart = (b.angle - a.angle) * arc.r;
          expect(apart, `${a.text} | ${b.text}`).toBeGreaterThan((length(a) + length(b)) / 2);
        }
      }
    }
  });

  it('moves the span only as far as it must to keep the playhead off the ends', () => {
    const span = { start: 0, end: 100 };
    expect(anchored(span, 50, 0.1)).toBe(span);
    expect(anchored(span, 3, 0.1)).toEqual({ start: -7, end: 93 });
    expect(anchored(span, 99, 0.1)).toEqual({ start: 9, end: 109 });
  });

  it('lays the story in whole years along the tier', () => {
    const years = storyYears(story.beats);
    expect(years).toEqual({ start: dayFromIso('1815-01-01'), end: dayFromIso('1818-01-01') });
    expect(tierAngle(arc, years, years.start)).toBeCloseTo(-arc.reach * TIER_REACH);
    expect(tierAngle(arc, years, years.end)).toBeCloseTo(arc.reach * TIER_REACH);
  });
});
