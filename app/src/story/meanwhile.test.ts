import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import tambora from '../../../stories/tambora/story.lock.json';
import { dayFromIso } from './dates';
import type { LockedEvent } from './lock';
import { meanwhileFromLock, scrubbedEntries } from './meanwhile';
import { parseStory } from './story';

const waterloo: LockedEvent = {
  qid: 'Q48314',
  label: 'Battle of Waterloo',
  date: '1815-06-18',
  precision: 'day',
  at: [4.41222, 50.67806],
  line: 'Wellington and Blücher defeat Napoleon at Waterloo',
  source: { title: 'Battle of Waterloo (Wikipedia)', url: 'https://example.org' },
};

describe('Meanwhile entries', () => {
  it('read a beat’s entry as its written line, its ISO date as a day number', () => {
    const meanwhile = meanwhileFromLock({
      images: [],
      meanwhile: { beats: { veil: [waterloo] }, months: {} },
    });
    const [entry] = meanwhile.beats.veil ?? [];
    expect(entry?.label).toBe('Wellington and Blücher defeat Napoleon at Waterloo');
    expect(entry?.day).toBe(dayFromIso('1815-06-18'));
  });

  it('print their dates at the precision the lock gives', () => {
    const entries = [waterloo, { ...waterloo, date: '1816-01-01', precision: 'year' }];
    const meanwhile = meanwhileFromLock({
      images: [],
      meanwhile: { beats: { veil: entries }, months: {} },
    });
    expect(meanwhile.beats.veil?.map((entry) => entry.dateLabel)).toEqual(['18 June 1815', '1816']);
  });

  it('scrubbed to a day, are the entries of its month, or of the nearest month', () => {
    const month = (label: string): LockedEvent[] => [
      {
        qid: 'Q1',
        label,
        date: '1815-06-18',
        precision: 'day',
        at: [0, 0],
        source: waterloo.source,
      },
    ];
    const meanwhile = meanwhileFromLock({
      images: [],
      meanwhile: { beats: {}, months: { '1815-07': month('July'), '1815-06': month('June') } },
    });
    const labels = (iso: string) => scrubbedEntries(meanwhile, dayFromIso(iso)).map((e) => e.label);
    expect(labels('1815-06-30')).toEqual(['June']);
    expect(labels('1815-07-01')).toEqual(['July']);
    expect(labels('1814-01-01')).toEqual(['June']);
    expect(labels('1820-01-01')).toEqual(['July']);
  });

  it('give every beat of the Tambora story three entries, each with its written line', () => {
    const story = parseStory(
      readFileSync(new URL('../../../stories/tambora/story.md', import.meta.url), 'utf8'),
    );
    const beats = tambora.meanwhile.beats as Record<string, LockedEvent[]>;
    expect(Object.keys(beats)).toEqual(story.beats.map((beat) => beat.id));
    for (const entries of Object.values(beats)) {
      expect(entries.map((entry) => Boolean(entry.line))).toEqual([true, true, true]);
    }
  });
});
