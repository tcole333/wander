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

/** sources.toml's table for Cliopatria: its version, attribution and license's URL. */
const cliopatria = (() => {
  const toml = read('../../../pipeline/sources.toml');
  const table = /^\[cliopatria\]\n([\s\S]*?)\n\n/m.exec(toml)?.[1] ?? '';
  const field = (name: string) => new RegExp(`^${name} = "(.*)"$`, 'm').exec(table)?.[1] ?? '?';
  return {
    version: field('version'),
    attribution: field('attribution'),
    license: field('license_url'),
  };
})();

/** The page's entry for the border steps, from its term to the end of its text. */
const stepsEntry = /<dt data-release="borderSteps">[\s\S]*?<\/dd>/.exec(credits)?.[0] ?? '';

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

  it('links exactly the notices the bundled release publishes under lic/', () => {
    // The border steps' notice, where the release names the steps, is the one a release names.
    const release = bundled as Release;
    const keys = release.borderSteps ? [release.borderSteps.notice] : [];
    const linked = [...credits.matchAll(/href="([^"]*\/lic\/[^"]*)"/g)].map((match) => match[1]);
    expect(new Set(linked)).toEqual(new Set(keys.map((key) => `${release.dataHost}/${key}`)));
  });

  it('credits Cliopatria by the attribution sources.toml gives it, linking each DOI', () => {
    const { attribution, version } = cliopatria;
    const authors = /^(.+? \(\d{4}\))/.exec(attribution)?.[1] ?? '?';
    const text = plain(stepsEntry);
    for (const part of [authors, 'Cliopatria', 'Seshat Global History Databank', version]) {
      expect(text).toContain(part);
    }
    const dois = [...attribution.matchAll(/DOI (10\.\d+\/[^\s;]+?)[.;]?(?=\s|$)/g)];
    expect(dois.length).toBeGreaterThan(0);
    for (const [, doi] of dois) expect(stepsEntry).toContain(`href="https://doi.org/${doi}"`);
  });

  it("links Cliopatria's license as sources.toml names it", () => {
    expect(stepsEntry).toContain(`href="${cliopatria.license}"`);
  });

  it("marks Cliopatria's term and text for the release's border steps", () => {
    expect(stepsEntry).toMatch(
      /^<dt data-release="borderSteps">[\s\S]*<dd data-release="borderSteps">/,
    );
  });
});
