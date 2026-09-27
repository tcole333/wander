import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseStory } from '../story/story';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const credits = read('../../credits.html');
const story = parseStory(read('../../../stories/tambora/story.md'));

/** The Commons files credits.html links to, by their titles ('File:...'). */
const linkedFiles = [
  ...credits.matchAll(/href="https:\/\/commons\.wikimedia\.org\/wiki\/([^"]+)"/g),
].map((match) => decodeURIComponent(match[1] ?? '').replaceAll('_', ' '));

/** The page's text, one space between words. */
const text = credits
  .replace(/<[^>]*>/g, ' ')
  .replaceAll('&amp;', '&')
  .replace(/\s+/g, ' ');

describe('credits.html', () => {
  it("links every beat's image to its file on Commons", () => {
    const images = story.beats.flatMap((beat) => (beat.image ? [beat.image.commons] : []));
    expect(linkedFiles).toEqual(images);
  });

  it("carries every line of the story's own credits", () => {
    const missing = story.credits.filter((line) => !text.includes(line));
    expect(missing).toEqual([]);
  });
});
