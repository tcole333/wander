import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { civilFromDay, dayFromCivil, dayFromIso, formatDay, isoFromDay } from './dates';
import { parseStory } from './story';

describe('story dates', () => {
  it('counts days from 0001-01-01', () => {
    expect(dayFromIso('0001-01-01')).toBe(0);
    expect(dayFromIso('0001-03-01')).toBe(59);
    expect(dayFromIso('1815-04-10') - dayFromIso('1815-04-05')).toBe(5);
    expect(dayFromIso('1816-03-01') - dayFromIso('1816-02-28')).toBe(2);
  });

  it('round-trips dates across eras, BC included', () => {
    for (const iso of ['1815-04-10', '1816-06-06', '2000-02-29', '0000-12-31', '-0099-03-01']) {
      expect(isoFromDay(dayFromIso(iso))).toBe(iso);
    }
    for (let day = -800_000; day < 800_000; day += 9_973) {
      expect(dayFromCivil(civilFromDay(day))).toBe(day);
    }
  });

  it('prints historical dates', () => {
    expect(formatDay(dayFromIso('1815-04-10'))).toBe('10 April 1815');
    expect(formatDay(dayFromIso('1815-04-10') + 0.6, 'month')).toBe('April 1815');
    expect(formatDay(dayFromIso('0000-07-01'), 'year')).toBe('1 BC');
  });
});

describe('the Tambora story', () => {
  const markdown = readFileSync(
    new URL('../../../stories/tambora/story.md', import.meta.url),
    'utf8',
  );
  const story = parseStory(markdown);

  it('has its eight beats, in order, each with text, a camera and sources', () => {
    expect(story.beats.map((b) => b.id)).toEqual([
      'world-1815',
      'sunda',
      'sumbawa',
      'ash',
      'veil',
      'europe-1816',
      'new-england-1816',
      'yunnan-bengal-1817',
    ]);
    for (const beat of story.beats) {
      expect(beat.paragraphs.join(' ').split(/\s+/).length).toBeGreaterThan(60);
      expect(beat.camera.viewKm).toBeGreaterThan(0);
      expect(beat.sources.length).toBeGreaterThan(0);
    }
  });

  it('reads the effects with their dates as day numbers', () => {
    const sumbawa = story.beats.find((b) => b.id === 'sumbawa');
    const plume = sumbawa?.effects.find((e) => e.kind === 'plume');
    expect(plume?.kind === 'plume' && plume.peak).toBe(dayFromIso('1815-04-10'));
  });
});
