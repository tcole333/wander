import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  civilFromDay,
  dayFromCivil,
  dayFromHistorical,
  dayFromIso,
  GREGORIAN,
  HISTORICAL,
  historicalCivil,
  type Calendar,
} from '../dates';
import { parseStory } from '../story';
import { beatSpan, type Span } from './format';
import {
  anchored,
  arcFor,
  engraveHistoryTier,
  engraveScale,
  engravedUnit,
  labelledYearStep,
  LOWER_ROW,
  storyYears,
  TIER_REACH,
  tierAngle,
  type Label,
} from './rulerScale';
import { ExploreTime, HISTORY } from '../../time/exploreTime';
import { WorldClock } from '../../time/worldClock';

const story = parseStory(
  readFileSync(new URL('../../../../stories/tambora/story.md', import.meta.url), 'utf8'),
);
const arc = arcFor(1440);

function engrave(span: Span, calendar?: Calendar): Label[] {
  const angle = (day: number) =>
    ((2 * (day - span.start)) / (span.end - span.start) - 1) * arc.reach;
  return engraveScale(arc, span, angle, calendar).labels;
}

/** The day number of a date history writes as this ISO day, in the Julian before the reform. */
function historical(iso: string): number {
  return dayFromHistorical(civilFromDay(dayFromIso(iso)));
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
  const broadSpans = [
    { unit: 'millennium', span: HISTORY },
    { unit: 'century', span: { start: dayFromIso('-0999-01-01'), end: dayFromIso('0600-01-01') } },
    { unit: 'decade', span: { start: dayFromIso('-0099-01-01'), end: dayFromIso('0040-01-01') } },
    { unit: 'year', span: { start: dayFromIso('-0009-01-01'), end: dayFromIso('0003-01-01') } },
    { unit: 'month', span: { start: dayFromIso('0000-07-01'), end: dayFromIso('0001-07-01') } },
    { unit: 'day', span: { start: dayFromIso('0000-12-28'), end: dayFromIso('0001-01-04') } },
  ];

  it.each(
    [GREGORIAN, HISTORICAL].flatMap((calendar) =>
      broadSpans.map((spans) => ({ ...spans, calendar })),
    ),
  )('engraves $unit ticks and labels across BCE and CE', ({ unit, span, calendar }) => {
    expect(engravedUnit(arc, span, calendar)).toBe(unit);
    const labels = engrave(span, calendar);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.some((label) => label.text.includes('BCE'))).toBe(true);
    expect(labels.some((label) => label.text.includes('CE') && !label.text.includes('BCE'))).toBe(
      true,
    );
    for (const label of labels) {
      expect(label.text).not.toMatch(/\d\.\d|^0(?: BCE| CE)?$/);
      expect(label.angle).toBeGreaterThanOrEqual(-arc.reach);
      expect(label.angle).toBeLessThanOrEqual(arc.reach);
    }
    const angle = (day: number) =>
      ((2 * (day - span.start)) / (span.end - span.start) - 1) * arc.reach;
    const scale = engraveScale(arc, span, angle, calendar);
    expect(scale.full + scale.major + scale.minor).not.toBe('');
    // Calendar marks are bounded by the visible resolution, including the full 12,000 years.
    expect((scale.full + scale.major + scale.minor).split('M').length).toBeLessThan(500);
    expect(labels.length).toBeLessThan(100);
  });

  it.each(broadSpans)(
    'gives the step of the years it labels at $unit, which the detents follow',
    ({ unit, span }) => {
      const step = labelledYearStep(arc, span, HISTORICAL);
      const least = { day: 1, month: 1, year: 1, decade: 10, century: 100, millennium: 1000 };
      expect(step).toBeGreaterThanOrEqual(least[unit as keyof typeof least]);
      expect(step).toBeLessThan(least[unit as keyof typeof least] * 10);
      // Each year the band labels by its step is one the step reaches from 1 CE.
      const years = engrave(span, HISTORICAL)
        .filter((label) => label.key.startsWith('c'))
        .map((label) => HISTORICAL.civil(Number(label.key.slice(1))).year);
      if (step > 1) expect(years.length).toBeGreaterThan(1);
      for (const year of years) {
        expect(year <= 0 ? (1 - year) % step : year === 1 ? 0 : year % step).toBe(0);
      }
    },
  );

  it('labels both full-history ends and keeps the overview bounded too', () => {
    const labels = engrave(HISTORY, HISTORICAL);
    expect(labels[0]?.text).toBe('10000 BCE');
    expect(labels.at(-1)?.text).toBe('2000 CE');
    expect(engraveHistoryTier(arc, HISTORY).labels.length).toBeLessThan(20);
    for (const width of [1024, 1440, 1920]) {
      const sized = arcFor(width);
      const angle = (day: number) =>
        ((2 * (day - HISTORY.start)) / (HISTORY.end - HISTORY.start) - 1) * sized.reach;
      const labels = engraveScale(sized, HISTORY, angle, HISTORICAL, HISTORY).labels;
      expect(labels[0]?.text).toBe('10000 BCE');
      expect(labels.at(-1)?.text).toBe('2000 CE');
      const tier = engraveHistoryTier(sized, new ExploreTime(new WorldClock()).extent).labels;
      expect([tier[0]?.text, tier.at(-1)?.text], `the tier at ${width}px`).toEqual([
        '10000 BCE',
        '2000 CE',
      ]);
    }
    for (const edge of [HISTORY.start, HISTORY.end]) {
      const span = {
        start: edge === HISTORY.start ? edge : edge - 3,
        end: edge === HISTORY.start ? edge + 4 : edge + 1,
      };
      const texts = engrave(span, HISTORICAL).map((label) => label.text);
      const civil = historicalCivil(edge);
      expect(texts).toContain(civil.year < 0 ? 'JANUARY 10000 BCE' : 'DECEMBER 2000');
      expect(texts).toContain(civil.year < 0 ? '1' : '31');
    }
  });

  it('keeps BCE and CE labels apart at intermediate zooms and desktop widths', () => {
    for (const width of [1024, 1440, 1920]) {
      const sized = arcFor(width);
      for (const years of [12, 25, 60, 120, 250, 600, 1200, 2500, 6000, 12000]) {
        const span = {
          start: dayFromIso('-9999-01-01'),
          end: dayFromIso('-9999-01-01') + years * 365.2425,
        };
        const angle = (day: number) =>
          ((2 * (day - span.start)) / (span.end - span.start) - 1) * sized.reach;
        const labels = engraveScale(sized, span, angle).labels.filter(
          (label) => label.row === LOWER_ROW,
        );
        let right = -Infinity;
        for (const label of labels) {
          const size = length(label);
          const center = label.angle * sized.r;
          const left =
            center - (label.anchor === 'start' ? 0 : label.anchor === 'end' ? size : size / 2);
          expect(left, `${width}px, ${years} years, ${label.text}`).toBeGreaterThan(right);
          right = left + size;
        }
      }
    }
  });

  it('shows adjacent calendar years 1 BCE and 1 CE and the leap day of astronomical zero', () => {
    const span = { start: dayFromIso('0000-01-01'), end: dayFromIso('0002-01-01') };
    expect(engrave(span).map((label) => label.text)).toEqual(
      expect.arrayContaining(['1 BCE', '1 CE']),
    );
    const leap = { start: dayFromIso('0000-02-27'), end: dayFromIso('0000-03-03') };
    expect(engrave(leap).map((label) => label.text)).toContain('29');
    expect(
      dayFromCivil({ year: 1, month: 1, day: 1 }) - dayFromCivil({ year: 0, month: 1, day: 1 }),
    ).toBe(366);
  });

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

  it('gives each key one label, so a label kept through a zoom never keeps stale words', () => {
    const newYear = dayFromIso('1816-01-01');
    const around = (days: number) => ({ start: newYear - days / 2, end: newYear + days / 2 });
    const named = new Map<string, string>();
    for (const span of [...SPANS, around(60), around(300), around(3000)]) {
      for (const label of engrave(span)) {
        const face = `${label.text} / ${label.cls}`;
        expect(named.get(label.key) ?? face, label.key).toBe(face);
        named.set(label.key, face);
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

describe("the free ruler's ends", () => {
  /** Explore's band over `years` ending on `end`, as history dates it, `width` px wide. */
  function band(end: { year: number; month: number; day: number }, years: number, width = 1440) {
    const sized = arcFor(width);
    const last = dayFromHistorical(end);
    const span = { start: last - years * 365.2425, end: last };
    const angle = (day: number) =>
      ((2 * (day - span.start)) / (span.end - span.start) - 1) * sized.reach;
    const labels = engraveScale(sized, span, angle, HISTORICAL, HISTORY).labels.filter(
      (label) => label.row === LOWER_ROW,
    );
    return { arc: sized, labels };
  }

  /** How much bare rule lies between two labels, px, from their faces' lengths. */
  function bare(r: number, a: Label, b: Label): number {
    const [left, right] = [a, b].toSorted((x, y) => x.angle - y.angle) as [Label, Label];
    return (right.angle - left.angle) * r - (length(left) + length(right)) / 2;
  }

  /**
   * Each end's label where the rule's end turns it inward off its tick, an edge's or a round
   * year's, with the next label in.
   */
  function ends(r: number, labels: Label[]): [Label, Label][] {
    const sorted = labels.toSorted((a, b) => a.angle - b.angle);
    const pairs = [
      [sorted[0], sorted[1]],
      [sorted.at(-1), sorted.at(-2)],
    ];
    return pairs.flatMap(([end, next]) =>
      end && next && Math.abs(end.angle - (end.tickAngle ?? end.angle)) * r > 0.5
        ? [[end, next] as [Label, Label]]
        : [],
    );
  }

  it("leaves off Waterloo's 200-year ruler its end, 1915, beside 1900", () => {
    const texts = band({ year: 1915, month: 6, day: 18 }, 200).labels.map((label) => label.text);
    expect(texts).toEqual([
      '1720',
      '1740',
      '1760',
      '1780',
      '1800',
      '1820',
      '1840',
      '1860',
      '1880',
      '1900',
    ]);
  });

  it('keeps each end label its own length of bare rule from the year beside it', () => {
    for (const width of [1024, 1280, 1440, 1920]) {
      for (const years of [30, 100, 200, 400, 1000, 3000]) {
        for (let k = 0; k < 120; k += 1) {
          // Ends that sweep back through history, never past its own ends.
          const year = 1990 - Math.round(k * years * 0.173);
          if (year - years < -9998) break;
          const { arc: sized, labels } = band({ year, month: 7, day: 1 }, years, width);
          for (const [end, next] of ends(sized.r, labels)) {
            expect(
              bare(sized.r, end, next),
              `${width}px, ${years} years to ${year}: ${end.text} | ${next.text}`,
            ).toBeGreaterThanOrEqual(length(end));
          }
        }
      }
    }
  });

  it("names history's ends, clear of the years beside them, wherever the view stops at one", () => {
    for (const width of [1024, 1280, 1440, 1920]) {
      const sized = arcFor(width);
      for (let k = 0; k <= 80; k += 1) {
        // Zoomed to every width of view from 20 years to all of history, then taken to its
        // start by the tier and to its end by the playhead, where the extent stops the view.
        const explore = new ExploreTime(new WorldClock());
        const full = explore.extent.end - explore.extent.start;
        explore.zoom((20 * 365.2425 * (12001 / 20) ** (k / 80)) / full, 0.5);
        for (const [go, day, text] of [
          ['seek', HISTORY.start, /^10000 BCE$/],
          ['scrub', HISTORY.end, /^2000( CE)?$/],
        ] as const) {
          explore[go](day);
          const span = explore.span;
          if (labelledYearStep(sized, span, HISTORICAL) === 1) continue;
          const angle = (at: number) =>
            ((2 * (at - span.start)) / (span.end - span.start) - 1) * sized.reach;
          const labels = engraveScale(sized, span, angle, HISTORICAL, explore.extent)
            .labels.filter((label) => label.row === LOWER_ROW)
            .toSorted((a, b) => a.angle - b.angle);
          const years = Math.round((span.end - span.start) / 365.2425);
          const where = `${width}px, ${years} years at ${go === 'seek' ? 'the start' : 'the end'}`;
          expect((go === 'seek' ? labels[0] : labels.at(-1))?.text, where).toMatch(text);
          for (const [end, next] of ends(sized.r, labels)) {
            expect(
              bare(sized.r, end, next),
              `${where}: ${end.text} | ${next.text}`,
            ).toBeGreaterThanOrEqual(length(end));
          }
        }
      }
    }
  });

  it('names an end that a long stretch of rule would otherwise leave unnamed', () => {
    const { labels } = band({ year: 1944, month: 7, day: 1 }, 400);
    const end = labels.at(-1);
    expect([end?.text, end?.key.startsWith('e')]).toEqual(['1944', true]);
  });

  it('keeps the name of a round year that clears the end by its length: 1 CE on all of history', () => {
    const sized = arcFor(1440);
    const angle = (day: number) =>
      ((2 * (day - HISTORY.start)) / (HISTORY.end - HISTORY.start) - 1) * sized.reach;
    const labels = engraveScale(sized, HISTORY, angle, HISTORICAL, HISTORY).labels.filter(
      (label) => label.row === LOWER_ROW,
    );
    expect(labels.slice(-2).map((label) => label.text)).toEqual(['1 CE', '2000 CE']);
  });
});

describe('the calendars the ruler engraves', () => {
  /** The labels in the lower and upper rows, each with the day at its angle. */
  function rows(span: Span, calendar?: Calendar) {
    const labels = engrave(span, calendar);
    const dayAt = (label: Label) =>
      span.start + ((label.angle / arc.reach + 1) / 2) * (span.end - span.start);
    return {
      lower: labels.filter((label) => label.row === LOWER_ROW),
      upper: labels.filter((label) => label.row !== LOWER_ROW).map((label) => label.text),
      dayAt,
    };
  }

  it('engraves Explore’s October 1066 as history dates it: Hastings on the 14th', () => {
    const hastings = dayFromIso('1066-10-20');
    const span = { start: hastings - 6, end: hastings + 6 };
    const { lower, upper, dayAt } = rows(span, HISTORICAL);
    expect(upper).toEqual(['OCTOBER 1066']);
    const fourteenth = lower.find((label) => label.text === '14')!;
    expect(Math.floor(dayAt(fourteenth))).toBe(hastings);
    expect(lower.map((label) => label.text)).toEqual(
      Array.from({ length: 12 }, (_, i) => String(8 + i)),
    );
  });

  it('names 15 March 44 BCE on Explore’s ruler', () => {
    const ides = dayFromIso('-0043-03-13');
    const { lower, upper, dayAt } = rows({ start: ides - 5, end: ides + 5 }, HISTORICAL);
    expect(upper).toEqual(['MARCH 44 BCE']);
    expect(Math.floor(dayAt(lower.find((label) => label.text === '15')!))).toBe(ides);
  });

  it('steps from 4 to 15 October 1582, a month of 21 days', () => {
    const first = historical('1582-10-01');
    const { lower, upper } = rows({ start: first, end: first + 8 }, HISTORICAL);
    expect(lower.map((label) => label.text)).toEqual(['1', '2', '3', '4', '15', '16', '17', '18']);
    expect(upper).toEqual(['OCTOBER 1582']);
    const october = rows({ start: first - 20, end: first + 41 }, HISTORICAL);
    expect(october.upper).toEqual(['SEPTEMBER 1582', 'OCTOBER 1582', 'NOVEMBER 1582']);
    const november = dayFromIso('1582-11-01');
    const lengths = october.lower.filter((label) => label.text === '1').map(october.dayAt);
    expect(lengths.map(Math.floor)).toEqual([first, november]);
  });

  it('begins Explore’s years on the historical 1 January', () => {
    const span = { start: historical('1060-01-01'), end: historical('1072-01-01') };
    const labels = engrave(span, HISTORICAL).filter((label) => label.row === LOWER_ROW);
    const angle = (day: number) =>
      ((2 * (day - span.start)) / (span.end - span.start) - 1) * arc.reach;
    const year1066 = labels.find((label) => label.text === '1066')!;
    const [a0, a1] = [angle(historical('1066-01-01')), angle(historical('1067-01-01'))];
    expect(year1066.angle).toBeCloseTo((a0 + a1) / 2);
  });

  it('keeps the walks’ proleptic Gregorian dates: Mactan on 27 April 1521', () => {
    const mactan = dayFromIso('1521-04-27');
    const span = { start: mactan - 6, end: mactan + 6 };
    const walk = rows(span);
    expect(walk.upper).toEqual(['APRIL 1521', 'MAY 1521']);
    expect(Math.floor(walk.dayAt(walk.lower.find((label) => label.text === '27')!))).toBe(mactan);
    expect(engrave(span, GREGORIAN)).toEqual(engrave(span));
    const explore = rows(span, HISTORICAL);
    expect(Math.floor(explore.dayAt(explore.lower.find((label) => label.text === '17')!))).toBe(
      mactan,
    );
  });
});
