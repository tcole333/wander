// The Tambora story against its committed lock (streaming.md 3.9): the stand-in for the check
// `npm run stories` will make, that the media stage has baked every image story.md names.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lockedImage, withLock, type StoryLock } from './lock';
import { parseStory } from './story';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const lock = JSON.parse(read('../../../stories/tambora/story.lock.json')) as StoryLock;
const story = withLock(parseStory(read('../../../stories/tambora/story.md')), lock);

describe("Tambora's lock", () => {
  it('holds every beat image as story.md crops it, at 1024 and 256 px wide, credited', () => {
    for (const beat of story.beats) {
      const locked = beat.image.locked;
      expect(locked, `beat ${beat.id}: run uv run prebuild media --story tambora`).toBeDefined();
      expect(locked?.files.map((file) => file.key.replace(/^img\/[\da-f]{16}/, ''))).toEqual([
        '-1024.jpg',
        '-256.jpg',
      ]);
      expect(locked?.credit).not.toBe('');
      expect(locked?.license).not.toBe('');
    }
  });

  it('finds no entry for an image cropped otherwise than the lock records', () => {
    const image = story.beats[0]?.image;
    if (!image) throw new Error('beat 1 has no image');
    expect(lockedImage(lock, image)).toBe(image.locked);
    expect(lockedImage(lock, { ...image, crop: [0, 0, 0.5, 0.5] })).toBeUndefined();
  });

  it('credits the maps from the David Rumsey Map Collection with its whole credit line', () => {
    const held = story.beats
      .filter((beat) => beat.image.locked?.collection !== undefined)
      .map((beat) => [beat.id, beat.image.locked?.collection]);
    const rumsey = 'David Rumsey Map Collection, David Rumsey Map Center, Stanford Libraries';
    expect(held).toEqual([
      ['world-1815', rumsey],
      ['sunda', rumsey],
      ['ash', rumsey],
    ]);
  });
});
