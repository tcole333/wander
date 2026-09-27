import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { StoryLock } from '../story/lock';
import { parseStory } from '../story/story';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const credits = read('../../credits.html');
const story = parseStory(read('../../../stories/tambora/story.md'));
const lock = JSON.parse(read('../../../stories/tambora/story.lock.json')) as StoryLock;

/** Text from markup, one space between words. */
const plain = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replaceAll('&amp;', '&')
    .replace(/\s+/g, ' ');

/** The page's image entries, in order: each one's Commons link and its text. */
const entries = [...credits.matchAll(/<li>([\s\S]*?)<\/li>/g)]
  .map((match) => match[1] ?? '')
  .filter((item) => item.includes('credits-beat'))
  .map((item) => ({
    href: decodeURI(/href="([^"]+)"/.exec(item)?.[1] ?? ''),
    text: plain(item),
  }));

describe('credits.html', () => {
  it("lists the lock's images in the story's order, each linked to its page on Commons", () => {
    expect(entries.map((entry) => entry.href)).toEqual(
      lock.images.map((image) => decodeURI(image.source)),
    );
  });

  it('gives each image the license its lock records', () => {
    const wrong = entries.filter(
      (entry, i) => !entry.text.includes(lock.images[i]?.license ?? '?'),
    );
    expect(wrong).toEqual([]);
  });

  it('holds its sheet in the card the Credits panel shows over the globe', () => {
    expect(credits).toMatch(/<main class="[^"]*\bcredits-card\b[^"]*">\s*<div class="wu-sheet">/);
    expect(credits).toMatch(/class="credits-back"/);
  });

  it("carries every line of the story's own credits", () => {
    const text = plain(credits);
    const missing = story.credits.filter((line) => !text.includes(line));
    expect(missing).toEqual([]);
  });
});
