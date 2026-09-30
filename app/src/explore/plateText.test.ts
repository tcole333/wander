// What an event's plate says: its name, its date as history writes it, its parent and its source.
import { describe, expect, it } from 'vitest';
import { dayFromHistorical, dayFromIso } from '../story/dates';
import {
  describedText,
  eventDate,
  eventName,
  openingText,
  pinnedText,
  precisionOf,
  sourceOf,
  spoken,
} from './plateText';
import { openings } from './openings';

const on = (year: number, month: number, day: number) => dayFromHistorical({ year, month, day });

describe('an event’s plate', () => {
  it('names the event without its trailing parenthesis, capitalized, with curly quotes', () => {
    expect(eventName('Siege of Baghdad (1258)')).toBe('Siege of Baghdad');
    expect(eventName('battle of the "Nations"')).toBe('Battle of the “Nations”');
    expect(eventName('Battle of Leipzig')).toBe('Battle of Leipzig');
    // A label that is all parenthesis keeps it.
    expect(eventName('(unnamed)')).toBe('(unnamed)');
  });

  it('dates Hastings as its sources do, in the Julian calendar', () => {
    const exported = dayFromIso('1066-10-20');
    expect(eventDate(exported, exported, 11)).toBe('14 October 1066');
  });

  it('dates Caesar’s death in BCE', () => {
    const day = on(-43, 3, 15);
    expect(eventDate(day, day, 11)).toBe('15 March 44 BCE');
  });

  it('dates a year, a month and a span of years at their precisions', () => {
    expect(eventDate(on(-700, 1, 1), on(-700, 12, 31), 9)).toBe('701 BCE');
    expect(eventDate(on(1816, 6, 1), on(1816, 6, 30), 10)).toBe('June 1816');
    expect(eventDate(on(1756, 5, 17), on(1763, 2, 15), 11)).toBe('1756–1763');
    // A decade reads as its years.
    expect(eventDate(on(1750, 1, 1), on(1759, 12, 31), 8)).toBe('1750–1759');
  });

  it('reads Wikidata’s precision as a day, a month or a year', () => {
    expect([14, 11, 10, 9, 7].map(precisionOf)).toEqual(['day', 'day', 'month', 'year', 'year']);
  });

  it('adds a child’s parent, and reads it all as one line', () => {
    const day = on(1815, 6, 18);
    const text = describedText({
      row: 3,
      qid: 48314,
      label: 'Battle of Waterloo',
      parent: 'Hundred Days (1815)',
      t0: day,
      t1: day,
      prec: 11,
    });
    expect(text).toEqual({
      name: 'Battle of Waterloo',
      date: '18 June 1815',
      parent: 'Hundred Days',
    });
    expect(spoken(text)).toBe('Battle of Waterloo, 18 June 1815, Part of: Hundred Days');
  });

  it('links an event’s source to the Wikipedia article Wikidata gives it', () => {
    expect(sourceOf(48314)).toEqual({
      title: 'Wikipedia',
      url: 'https://www.wikidata.org/wiki/Special:GoToLinkedPage/enwiki/Q48314',
    });
  });

  it('pins an opening with its written line and the source the line rests on', () => {
    const waterloo = openings.find((opening) => opening.qid === 'Q48314')!;
    const text = pinnedText(openingText(waterloo), 48314, waterloo);
    expect(text).toEqual({
      name: 'Battle of Waterloo',
      date: '18 June 1815',
      line: waterloo.label,
      source: waterloo.source,
    });
    expect(text.line).toMatch(/Waterloo/);
    // A line's straight quotes read as typographer's.
    const fire = openings.find((opening) => opening.qid === 'Q164679')!;
    expect(pinnedText(openingText(fire), 164679, fire).line).toContain('Old St Paul’s');
    expect(pinnedText({ name: 'Battle of Ligny', date: '16 June 1815' }, 207318)).toEqual({
      name: 'Battle of Ligny',
      date: '16 June 1815',
      source: sourceOf(207318),
    });
  });
});
