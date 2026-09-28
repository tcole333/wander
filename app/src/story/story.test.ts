import { readdirSync, readFileSync } from 'node:fs';
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

describe('the story schema', () => {
  const stories = new URL('../../../stories/', import.meta.url);
  const folders = readdirSync(stories, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  it.each(folders)('holds for %s, which its folder names', (folder) => {
    const story = parseStory(readFileSync(new URL(`${folder}/story.md`, stories), 'utf8'));
    expect(story.id).toBe(folder);
  });

  const BEAT = `id: one
date: "1815-04-10"
precision: day
window: "1815-04-05..1815-04-12"
camera: {target: [118.0, -8.25], viewKm: 300}
focal: {qid: Q3591483}
image: {commons: "File:A map.jpg", alt: "A map of Sumbawa."}
layers: [labels, relief]
meanwhile: auto
sources:
  - {title: A history, author: A historian, url: "https://example.org/history"}`;
  const storyWith = (beat: string) =>
    `---\nid: test\ntitle: Test\nblurb: A test.\n---\n\n## One\n\n\`\`\`beat\n${beat}\n\`\`\`\n\nWords.\n`;

  it('reads a beat that keeps to it, its layers in the canonical order', () => {
    const [beat] = parseStory(storyWith(BEAT)).beats;
    expect(beat?.layers).toEqual(['relief', 'labels']);
    expect(beat?.window).toEqual([dayFromIso('1815-04-05'), dayFromIso('1815-04-12')]);
  });

  it.each([
    ['a key it does not name', `${BEAT}\nmood: grim`, /unknown key 'mood'/],
    ['a misspelled camera field', BEAT.replace('viewKm', 'viewkm'), /unknown key 'viewkm'/],
    ['a layer the constants do not list', BEAT.replace('labels', 'rivers'), /layer 'rivers'/],
    ['climate without its mode', BEAT.replace('labels', 'climate'), /climate needs its mode/],
    [
      'a precision of a week',
      BEAT.replace('precision: day', 'precision: week'),
      /day, month, year/,
    ],
    [
      'a date outside its window',
      BEAT.replace('1815-04-05..', '1815-04-11..'),
      /outside its window/,
    ],
    ['no window', BEAT.replace(/^window: .*\n/m, ''), /window must be text/],
    ['no source with an https link', BEAT.replace('https:', 'http:'), /an https link/],
    ['no sources', BEAT.replace(/^sources:[\s\S]*/m, ''), /sources must be a list/],
    ['an image without alt text', BEAT.replace('"A map of Sumbawa."', '""'), /needs alt text/],
    ['no image', BEAT.replace(/^image: .*\n/m, ''), /image must be a mapping/],
    [
      'Meanwhile of neither kind',
      BEAT.replace('meanwhile: auto', 'meanwhile: often'),
      /auto or a list/,
    ],
  ])('rejects %s', (_, beat, message) => {
    expect(() => parseStory(storyWith(beat))).toThrow(message);
  });
});
