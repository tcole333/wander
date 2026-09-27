import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseStory } from '../story/story';
import { isCueName } from './cues';

const stories = new URL('../../../stories/', import.meta.url);

describe('the cues', () => {
  it('has a sound for every cue a story names', () => {
    const named = readdirSync(stories, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const markdown = readFileSync(new URL(`${entry.name}/story.md`, stories), 'utf8');
        return parseStory(markdown).beats.flatMap((beat) => beat.audioCues);
      });
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((name) => !isCueName(name))).toEqual([]);
  });
});
