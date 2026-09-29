import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dayFromIso } from '../dates';
import { parseStory } from '../story';
import {
  bearingDeg,
  compassPoint,
  curlyQuotes,
  dateLine,
  beatSpan,
  mixSpans,
  monthsIn,
  platePrecision,
  spreadPips,
  yearsLabel,
  calendarYearLabel,
  yearsIn,
} from './format';

const story = parseStory(
  readFileSync(new URL('../../../../stories/tambora/story.md', import.meta.url), 'utf8'),
);

describe('the walk UI', () => {
  it('names historical years without a year zero and jumps to coarse calendar marks', () => {
    expect([-9999, -99, -9, 0, 1, 2000].map((year) => calendarYearLabel(year, true))).toEqual([
      '10000 BCE',
      '100 BCE',
      '10 BCE',
      '1 BCE',
      '1 CE',
      '2000 CE',
    ]);
    const span = { start: dayFromIso('-9999-01-01'), end: dayFromIso('2000-12-31') };
    const marks = yearsIn(span, 1000);
    expect(marks.map((mark) => calendarYearLabel(mark.year, true))).toEqual([
      '10000 BCE',
      '9000 BCE',
      '8000 BCE',
      '7000 BCE',
      '6000 BCE',
      '5000 BCE',
      '4000 BCE',
      '3000 BCE',
      '2000 BCE',
      '1000 BCE',
      '1 CE',
      '1000 CE',
      '2000 CE',
    ]);
    expect(marks[0]?.start).toBe(span.start);
    const crossing = monthsIn(
      { start: dayFromIso('0000-10-15'), end: dayFromIso('0001-04-01') },
      3,
    );
    expect(crossing.map(({ year, month }) => [year, month])).toEqual([
      [0, 10],
      [1, 1],
    ]);
    expect(crossing[0]?.end).toBe(0);
  });

  it('dates each Tambora beat, with short windows spelled out', () => {
    expect(story.beats.map(dateLine)).toEqual([
      'April 1815',
      '5–10 April 1815',
      '10–11 April 1815',
      '12 April 1815',
      '28 June 1815',
      'June–August 1816',
      '6 June 1816',
      '28 August 1817',
    ]);
  });

  it("names the beat's month on the plate while the day stands on it, flying in or landed", () => {
    const first = story.beats[0]!;
    const on = { story, beat: 0, mode: 'paused' as const, day: first.day, advanceIn: null };
    const flying = { flight: 0.4, flying: true };
    const landed = { flight: null, flying: false };
    expect(platePrecision({ ...on, ...flying })).toBe('month');
    expect(platePrecision({ ...on, ...landed })).toBe('month');
    expect(platePrecision({ ...on, ...flying, day: first.day - 3 })).toBe('day');
    expect(platePrecision({ ...on, ...landed, mode: 'breakout' })).toBe('day');
  });

  it("dates the story by its beats' first and last years", () => {
    expect(yearsLabel(story.beats)).toBe('1815–1817');
  });

  it('spans each beat with its window, at least 40 days, and zooms between spans', () => {
    const [sumbawa, ash] = [story.beats[2]!, story.beats[3]!];
    expect(beatSpan(sumbawa).end - beatSpan(sumbawa).start).toBe(40);
    expect(beatSpan(ash).start).toBeLessThan(dayFromIso('1815-04-11'));
    expect(beatSpan(ash).end).toBeGreaterThan(dayFromIso('1816-10-26'));
    const halfway = mixSpans({ start: 0, end: 10 }, { start: 100, end: 1100 }, 0.5, 5, 0.5);
    expect(halfway.end - halfway.start).toBeCloseTo(100, 9);
    expect(halfway.start).toBeLessThan(5);
    const landed = mixSpans(beatSpan(ash), beatSpan(sumbawa), 0.1, sumbawa.day, 1);
    expect(landed.start).toBeCloseTo(beatSpan(sumbawa).start, 6);
    const months = monthsIn({ start: dayFromIso('1815-12-15'), end: dayFromIso('1816-02-10') });
    expect(months.map((m) => `${m.year}-${m.month}`)).toEqual(['1815-12', '1816-1', '1816-2']);
  });

  it('fans crowded pips apart in order and leaves lone ones where they fall', () => {
    const spread = spreadPips([100, 104, 102, 400], 20, 0, 1000);
    expect(spread[3]).toBe(400);
    expect(spread[1]! - spread[2]!).toBeCloseTo(20);
    expect(spread[2]! - spread[0]!).toBeCloseTo(20);
    expect(spreadPips([2, 3], 20, 0, 1000)[0]).toBe(0);
  });

  it('points the compass from Tambora toward Europe and Bengal', () => {
    const tambora: [number, number] = [118, -8.25];
    expect(compassPoint(bearingDeg(tambora, [16.37, 48.21]))).toBe('NW');
    expect(compassPoint(bearingDeg(tambora, [89.22, 23.17]))).toBe('NW');
    expect(compassPoint(bearingDeg([0, 0], [90, 0]))).toBe('E');
    expect(compassPoint(359)).toBe('N');
  });

  it('curls straight quotes', () => {
    expect(curlyQuotes('the whole mountain become "like a body of liquid fire". Tambora\'s')).toBe(
      'the whole mountain become “like a body of liquid fire”. Tambora’s',
    );
  });
});
