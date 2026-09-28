import { describe, expect, it } from 'vitest';
import tamboraLock from '../../../stories/tambora/story.lock.json';
import magellanLock from '../../../stories/magellan/story.lock.json';
import type { StoryLock } from './lock';
import { stories, storyNamed } from './catalog';
import { dayFromIso } from './dates';
import { scrubbedEntries } from './meanwhile';
import { yearsLabel } from './ui/format';
import { storyYears } from './ui/rulerScale';

describe('the shipped stories', () => {
  it('keeps plaque order and resolves either dev story, rejecting an unknown choice', () => {
    expect(stories.map(({ story }) => story.id)).toEqual(['tambora', 'magellan']);
    for (const source of stories) expect(storyNamed(source.story.id)).toBe(source);
    expect(storyNamed(null)).toBeNull();
    expect(() => storyNamed('unknown')).toThrow("no story 'unknown'");
    expect(() => storyNamed('toString')).toThrow();
  });

  it('joins each story to its own baked images and Meanwhile, including scrubbing', () => {
    const locks: StoryLock[] = [tamboraLock, magellanLock];
    for (const [i, { story, meanwhile }] of stories.entries()) {
      const lock = locks[i]!;
      for (const beat of story.beats) {
        expect(beat.image.locked?.sha1).toBe(beat.image.sha1);
        expect(beat.image.locked?.files.length).toBeGreaterThan(0);
        expect(meanwhile.beats[beat.id]?.map((entry) => entry.qid)).toEqual(
          lock.meanwhile?.beats[beat.id]?.map((entry) => entry.qid),
        );
      }
      for (const [month, entries] of Object.entries(lock.meanwhile?.months ?? {})) {
        expect(
          scrubbedEntries(meanwhile, dayFromIso(`${month}-01`)).map((entry) => entry.qid),
        ).toEqual(entries.map((entry) => entry.qid));
      }
    }
  });

  it('gives Magellan its whole 1519–1522 ruler span and ten beats', () => {
    const { story } = storyNamed('magellan')!;
    expect(story.beats).toHaveLength(10);
    expect(yearsLabel(story.beats)).toBe('1519–1522');
    expect(storyYears(story.beats)).toEqual({
      start: dayFromIso('1519-01-01'),
      end: dayFromIso('1523-01-01'),
    });
  });
});
