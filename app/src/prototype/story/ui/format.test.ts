import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dayFromIso } from '../dates';
import { parseStory } from '../story';
import {
  bearingDeg,
  compassPoint,
  creditLine,
  curlyQuotes,
  dateLine,
  monthsIn,
  spreadPips,
  storySpan,
} from './format';

const story = parseStory(
  readFileSync(new URL('../../../../../stories/tambora/story.md', import.meta.url), 'utf8'),
);

describe('the walk UI', () => {
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

  it('spans the story with a margin, month by month', () => {
    const span = storySpan(story);
    expect(span.start).toBeLessThan(dayFromIso('1815-03-20'));
    expect(span.end).toBeGreaterThan(dayFromIso('1817-12-31'));
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

  it('credits Commons images by artist, else by credit, with the license', () => {
    const artists =
      '<div class="fn value">\n<dl><dd>Pinkerton, John, 1758-1826</dd>\n<dd>Hebert, L.</dd></dl></div>';
    expect(creditLine(artists, '', 'Public domain')).toBe(
      'John Pinkerton, L. Hebert · Public domain',
    );
    const turner =
      '<bdi><a href="x"><span title="English painter">J. M. W. Turner</span></a></bdi>';
    expect(creditLine(turner, '', 'Public domain')).toBe('J. M. W. Turner · Public domain');
    expect(creditLine('', 'Bibliothèque&nbsp;nationale &amp; Co', 'CC0')).toBe(
      'Bibliothèque nationale & Co · CC0',
    );
  });

  it('curls straight quotes', () => {
    expect(curlyQuotes('the whole mountain become "like a body of liquid fire". Tambora\'s')).toBe(
      'the whole mountain become “like a body of liquid fire”. Tambora’s',
    );
  });
});
