import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Release } from '../data/release';
import bundled from '../generated/release.json' with { type: 'json' };
import { lockedImage, type StoryLock } from '../story/lock';
import { parseStory } from '../story/story';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const credits = read('../../credits.html');
const stories = ['tambora', 'magellan'].map((id) => ({
  story: parseStory(read(`../../../stories/${id}/story.md`)),
  lock: JSON.parse(read(`../../../stories/${id}/story.lock.json`)) as StoryLock,
}));
const images = stories.flatMap(({ story, lock }) =>
  story.beats.map((beat) => lockedImage(lock, beat.image)!),
);

/** Text from markup, one space between words. */
const plain = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&#x27;', "'")
    .replaceAll('&quot;', '"')
    .replace(/\s+/g, ' ');

/** The page's image entries, in order: each one's Commons link and its text. */
const entries = [...credits.matchAll(/<li>([\s\S]*?)<\/li>/g)]
  .map((match) => match[1] ?? '')
  .filter((item) => item.includes('credits-beat'))
  .map((item) => ({
    href: plain(decodeURI(/href="([^"]+)"/.exec(item)?.[1] ?? '')),
    text: plain(item),
  }));

describe('credits.html', () => {
  it("lists the lock's images in the story's order, each linked to its page on Commons", () => {
    expect(entries.map((entry) => entry.href)).toEqual(
      images.map((image) => decodeURI(image.source)),
    );
  });

  it('gives each image the license its lock records', () => {
    const wrong = entries.filter((entry, i) => !entry.text.includes(images[i]?.license ?? '?'));
    expect(wrong).toEqual([]);
  });

  it('names in full the collection its lock credits, wherever the lock names one', () => {
    const wrong = entries.filter((entry, i) => !entry.text.includes(images[i]?.collection ?? ''));
    expect(wrong).toEqual([]);
  });

  it('holds its sheet in the card the Credits panel shows over the globe', () => {
    expect(credits).toMatch(/<main class="[^"]*\bcredits-card\b[^"]*">\s*<div class="wu-sheet">/);
    expect(credits).toMatch(/class="credits-back"/);
  });

  it("carries every line of the story's own credits", () => {
    const text = plain(credits);
    const missing = stories
      .flatMap(({ story }) => story.credits)
      .filter((line) => !text.includes(line));
    expect(missing).toEqual([]);
  });

  it('links every source cited under either story’s beats', () => {
    const links = new Set(
      [...credits.matchAll(/href="([^"]+)"/g)].map((match) => plain(match[1] ?? '')),
    );
    for (const { story } of stories) {
      for (const beat of story.beats) {
        for (const source of beat.sources)
          expect(links.has(source.url), `${story.id}: ${source.url}`).toBe(true);
      }
    }
  });

  it("links the borders' GPL notice and changed source as the bundled release publishes them", () => {
    const release = bundled as Release;
    const file = release.borders?.files['1815'];
    const links = [file?.notice, file?.source].map((key) => `${release.dataHost}/${key ?? '?'}`);
    for (const link of links) expect(credits).toContain(`href="${link}"`);
  });
});
