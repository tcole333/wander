// The events Explore opens on (streaming.md 3.4): the list in the repo-root explore/openings.yaml,
// which the prebuild's openings stage checks against the event index into openings.lock.json,
// bundled here, and whose events event-files forces into the overview. Each opening reads as
// Meanwhile's entries do (story/meanwhile.ts), with its name for its plate and its class for its
// mark, so the lock can draw the opening's mark until the overview decodes, or if it fails. Each
// visit opens on one the visitor has not seen among their last `openingsRecent`, remembered in
// localStorage where the browser allows it; ?opening=Q… on a page served from this machine pins
// one.
import bundledLock from '../../../explore/openings.lock.json';
import { tunables } from '../config/tunables';
import { LOOPBACK } from '../page/dataOrigin';
import type { MeanwhileEntry } from '../story/contract';
import type { Precision } from '../story/dates';
import type { LockedEvent } from '../story/lock';
import { fromLock, lockedPrecision } from '../story/meanwhile';

/** An opening as the lock gives it: an event of the index with its line, source and class. */
export type LockedOpening = LockedEvent & { class: string };

export interface OpeningsLock {
  /** The sha256 of the event index the openings stage checked the list against. */
  table: string;
  /** In date order. */
  openings: LockedOpening[];
}

/**
 * An event Explore opens on: its line as `label`, its day, place and source, as Meanwhile's
 * entries give them, but without their `dateLabel`, which reads the day in the proleptic Gregorian
 * calendar: an opening's plate prints its day at its precision in the calendar its sources use
 * (Julian before 15 October 1582).
 */
export interface Opening extends Omit<MeanwhileEntry, 'dateLabel'> {
  qid: string;
  /** The event's name, as its plate prints it. */
  name: string;
  /** How finely its date is known: 'day', 'month' or 'year'. */
  precision: Precision;
  /** Its class in pipeline/config/event-classes.yaml, which gives its mark. */
  class: string;
}

/** Where a visitor's recent openings are remembered, oldest first. */
export const RECENT_KEY = 'wander.openings.recent';

const QID = /^Q[1-9][0-9]*$/;

export function openingsFromLock(lock: OpeningsLock): Opening[] {
  return lock.openings.map((event) => {
    const { label, day, at, source } = fromLock(event);
    return {
      label,
      day,
      at,
      source,
      qid: event.qid,
      name: event.label,
      precision: lockedPrecision(event),
      class: event.class,
    };
  });
}

/** The bundled openings. */
export const openings: readonly Opening[] = openingsFromLock(bundledLock);

/**
 * The opening a page on this machine pins with ?opening=Q…, as given, or null without one; public
 * URLs never pin one. A value the list lacks, well-formed or not, reaches `pickOpening`, which
 * throws on it.
 */
export function openingRequested(page: { hostname: string; search: string }): string | null {
  if (!LOOPBACK.has(page.hostname)) return null;
  return new URLSearchParams(page.search).get('opening')?.trim() ?? null;
}

export interface PickOptions {
  /** The pinned opening's qid (`openingRequested`), or null to choose one. */
  pinned?: string | null;
  /** The visitor's storage; one that throws, or refuses, leaves the pick unremembered. */
  storage?: () => Storage;
  random?: () => number;
}

/**
 * The opening this visit dives to: the pinned one, else one at random that is not among the
 * visitor's last `openingsRecent`, which it joins. A pin the list lacks throws, so a typo never
 * opens on another event.
 */
export function pickOpening(
  choices: readonly Opening[],
  { pinned = null, storage = () => localStorage, random = Math.random }: PickOptions = {},
): Opening {
  if (choices.length === 0) throw new RangeError('the openings lock lists no openings');
  const recent = readRecent(storage);
  const pick = pinned === null ? chooseUnseen(choices, recent, random) : named(choices, pinned);
  const seen = [...recent.filter((qid) => qid !== pick.qid), pick.qid];
  writeRecent(storage, seen.slice(-tunables.openingsRecent));
  return pick;
}

function named(choices: readonly Opening[], qid: string): Opening {
  const found = choices.find((opening) => opening.qid === qid);
  if (!found) throw new Error(`no opening '${qid}'`);
  return found;
}

/** One not seen lately, or, when the list is too short for that, any but the last seen. */
function chooseUnseen(
  choices: readonly Opening[],
  recent: string[],
  random: () => number,
): Opening {
  const lately = new Set(recent.slice(-tunables.openingsRecent));
  let pool = choices.filter((opening) => !lately.has(opening.qid));
  if (pool.length === 0) pool = choices.filter((opening) => opening.qid !== recent.at(-1));
  if (pool.length === 0) pool = [...choices];
  const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
  const pick = pool[index];
  if (!pick) throw new RangeError('no opening to choose');
  return pick;
}

function readRecent(storage: () => Storage): string[] {
  try {
    const parsed: unknown = JSON.parse(storage().getItem(RECENT_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((qid): qid is string => typeof qid === 'string' && QID.test(qid));
  } catch {
    return [];
  }
}

function writeRecent(storage: () => Storage, recent: string[]): void {
  try {
    storage().setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    // Storage refused (a private window, blocked site data): this visit's pick goes unremembered.
  }
}
