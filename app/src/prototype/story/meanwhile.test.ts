import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dayFromIso } from './dates';
import { meanwhileFromJson } from './meanwhile';
import tambora from './meanwhile.tambora.json';
import { parseStory } from './story';

describe('Meanwhile entries', () => {
  it('turn the file’s ISO dates into day numbers', () => {
    const byBeat = meanwhileFromJson({
      veil: [
        {
          label: 'The Battle of Waterloo',
          day: '1815-06-18',
          dateLabel: '18 June 1815',
          at: [4.4122, 50.6781],
          source: { title: 'Battle of Waterloo', url: 'https://example.org' },
        },
      ],
    });
    expect(byBeat.veil?.[0]?.day).toBe(dayFromIso('1815-06-18'));
    expect(byBeat.veil?.[0]?.at).toEqual([4.4122, 50.6781]);
  });

  it('cover every beat of the Tambora story', () => {
    const story = parseStory(
      readFileSync(new URL('../../../../stories/tambora/story.md', import.meta.url), 'utf8'),
    );
    const byBeat = meanwhileFromJson(tambora);
    expect(Object.keys(byBeat)).toEqual(story.beats.map((beat) => beat.id));
  });
});
