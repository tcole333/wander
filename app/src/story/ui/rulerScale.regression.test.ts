import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { civilFromDay, dayFromHistorical, dayFromIso, HISTORICAL } from '../dates';
import { parseStory } from '../story';
import {
  arcFor,
  engraveHistoryTier,
  engraveScale,
  engraveTier,
  LOWER_ROW,
  storyYears,
} from './rulerScale';
import { ExploreTime, HISTORY } from '../../time/exploreTime';
import { WorldClock } from '../../time/worldClock';
import type { Span } from './format';

function yearsOf(id: string) {
  const story = parseStory(
    readFileSync(new URL(`../../../../stories/${id}/story.md`, import.meta.url), 'utf8'),
  );
  return storyYears(story.beats);
}

describe('review: narrow story tiers', () => {
  it.each([
    { id: 'magellan', width: 640, labels: ['1519', '1520', '1521', '1522'] },
    { id: 'tambora', width: 560, labels: ['1815', '1816', '1817'] },
  ])('$id keeps every story year at $width px', ({ id, width, labels }) => {
    expect(engraveTier(arcFor(width), yearsOf(id)).labels.map((label) => label.text)).toEqual(
      labels,
    );
  });

  it('never names the exclusive end of a story tier', () => {
    for (const id of ['magellan', 'tambora']) {
      const span = yearsOf(id);
      for (const width of [560, 640, 720, 1440]) {
        const labels = engraveTier(arcFor(width), span).labels.map((label) => label.text);
        expect(labels, `${id} at ${width}px`).not.toContain(String(civilFromDay(span.end).year));
      }
    }
  });
});

/** Explore's band: the historical calendar. */
function band(span: Span, width = 1440) {
  const arc = arcFor(width);
  const angle = (day: number) =>
    ((2 * (day - span.start)) / (span.end - span.start) - 1) * arc.reach;
  return engraveScale(arc, span, angle, HISTORICAL).labels.filter(
    (label) => label.row === LOWER_ROW,
  );
}

/** The day number of a date history writes as this ISO day, in the Julian before the reform. */
function historical(iso: string): number {
  return dayFromHistorical(civilFromDay(dayFromIso(iso)));
}

describe('review: free ruler calendar', () => {
  it('gives 31 December its full cell at the four-day limit', () => {
    const explore = new ExploreTime(new WorldClock());
    explore.zoom(1e-9, 1);
    explore.seek(HISTORY.end);
    expect(band(explore.span).map((label) => label.text)).toEqual(['28', '29', '30', '31']);
    expect(explore.clock.state().day).toBe(HISTORY.end);
    expect(explore.span.end).toBe(HISTORY.end + 1);
    explore.scrub(HISTORY.end + 1);
    expect(explore.clock.state().day).toBe(HISTORY.end);
  });

  it('keeps round decades instead of the exact view edges', () => {
    const span = { start: historical('-0069-01-01'), end: historical('0071-01-01') };
    expect(band(span).map((label) => label.text)).toEqual([
      '60 BCE',
      '40 BCE',
      '20 BCE',
      '1 CE',
      '20 CE',
      '40 CE',
      '60 CE',
    ]);
  });

  it('keeps 800 CE beside an unround 801 CE view end', () => {
    const span = { start: historical('-0799-01-01'), end: historical('0801-01-01') };
    expect(band(span).at(-1)?.text).toBe('800 CE');
  });

  it('keeps both 10000 BCE and 9000 BCE at 1920 px without overlap', () => {
    const span = new ExploreTime(new WorldClock()).extent;
    const labels = band(span, 1920);
    expect(labels.map((label) => label.text)).toEqual(
      expect.arrayContaining(['10000 BCE', '9000 BCE']),
    );
    const arc = arcFor(1920);
    let right = -arc.reach * arc.r;
    for (const label of labels) {
      const center = label.angle * arc.r;
      const half = label.text.length * 6;
      expect(center - half).toBeGreaterThanOrEqual(right);
      right = center + half;
    }
    expect(right).toBeLessThanOrEqual(arc.reach * arc.r);
    const round = labels.find((label) => label.text === '9000 BCE')!;
    expect(round.tickAngle).toBeCloseTo(
      ((2 * (historical('-8999-01-01') - span.start)) / (span.end - span.start) - 1) * arc.reach,
    );
  });

  it('never labels the exclusive year 2001 on the history tier', () => {
    const span = new ExploreTime(new WorldClock()).extent;
    for (const width of [560, 640, 720, 1024, 1440, 1920]) {
      const labels = engraveHistoryTier(arcFor(width), span).labels.map((label) => label.text);
      expect(labels).not.toContain('2001 CE');
      if (width >= 1440) expect(labels).toContain('2000 CE');
    }
  });
});
