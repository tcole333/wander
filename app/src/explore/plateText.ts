// What an event's plate says (spec section 3): the event's name as the index labels it, its date as
// history writes it (story/dates.ts, formatHistorical: Julian before 15 October 1582, BCE before
// 1 CE), and for a child, the event it is part of. A pinned plate adds its source; an opening's
// adds the line its writers give it (openings.ts), the only lines Explore has until every label
// gets one (#82). The index holds no Wikipedia title, so an event's source is the English
// Wikipedia article Wikidata links it to.
import type { EventDescription } from '../events/describe';
import { formatHistorical, type Precision } from '../story/dates';
import { curlyQuotes } from '../story/ui/format';
import { PART_OF, SOURCE_NAME } from './copy';
import type { Opening } from './openings';

/** Wikidata's precision of a day; a month's is one less, a year's two less. */
const DAY_PRECISION = 11;
const MONTH_PRECISION = 10;

export interface PlateText {
  /** The event's name. */
  name: string;
  /** Its date, or its span, as history writes it. */
  date: string;
  /** The name of the event it is part of, if it is a child and that event is resident. */
  parent?: string;
}

/** A pinned plate's words: its written line, where it has one, and its source. */
export interface PinnedText extends PlateText {
  line?: string;
  source: { title: string; url: string };
}

/** How finely Wikidata's precision dates an event, as the calendar prints it; coarser is 'year'. */
export function precisionOf(prec: number): Precision {
  if (prec >= DAY_PRECISION) return 'day';
  return prec === MONTH_PRECISION ? 'month' : 'year';
}

/**
 * An index label as a plate prints it: without a trailing parenthesis ('Siege of Baghdad (1258)'
 * reads 'Siege of Baghdad'), its first letter capitalized, with typographer's quotes.
 */
export function eventName(label: string): string {
  const whole = label.trim();
  const cut = whole.replace(/\s*\([^()]*\)$/, '');
  const name = cut === '' ? whole : cut;
  return curlyQuotes(name.charAt(0).toUpperCase() + name.slice(1));
}

/** An event's inclusive days at its precision, as its plate dates them. */
export function eventDate(t0: number, t1: number, prec: number): string {
  return formatHistorical(t0, precisionOf(prec), t1);
}

/** The English Wikipedia article Wikidata links the event with Q number `qid` to. */
export function sourceOf(qid: number): { title: string; url: string } {
  return {
    title: SOURCE_NAME,
    url: `https://www.wikidata.org/wiki/Special:GoToLinkedPage/enwiki/Q${qid}`,
  };
}

/** A described event's plate. */
export function describedText(event: EventDescription): PlateText {
  return {
    name: eventName(event.label),
    date: eventDate(event.t0, event.t1, event.prec),
    ...(event.parent === undefined ? {} : { parent: eventName(event.parent) }),
  };
}

/** An opening's plate, from the openings lock: its name and its date at its precision. */
export function openingText(opening: Opening): PlateText {
  return { name: opening.name, date: formatHistorical(opening.day, opening.precision) };
}

/**
 * A plate's words once pinned: an opening's line and the source its line rests on, or any other
 * event's Wikipedia article.
 */
export function pinnedText(text: PlateText, qid: number, opening?: Opening): PinnedText {
  if (!opening) return { ...text, source: sourceOf(qid) };
  const line = opening.label === opening.name ? {} : { line: opening.label };
  return { ...text, ...line, source: opening.source };
}

/** The plate's words as one line, for the live region and the listbox. */
export function spoken(text: PlateText & { line?: string }): string {
  const parts = [text.name, text.date];
  if (text.parent) parts.push(`${PART_OF} ${text.parent}`);
  if (text.line) parts.push(text.line);
  return parts.join(', ');
}
