// The time ruler's marks as its playhead passes them (PRD, Audio: gear detents as the ruler passes
// years and months): a mark stands at the start of each day, month and year, weighted by what it
// begins, and the playhead passes the ones the ruler engraves at that moment. Pure, for tests.
import { civilFromDay } from '../story/dates';
import type { DetentWeight } from './voices';

/** A mark on the ruler: the day it starts, and what it begins. */
export interface Mark {
  day: number;
  weight: DetentWeight;
}

const RANK: Record<DetentWeight, number> = { day: 0, month: 1, year: 2 };

/** The mark at the start of `day`: a year's on the first of January, a month's on any first. */
export function markAt(day: number): Mark {
  const date = civilFromDay(day);
  if (date.day !== 1) return { day, weight: 'day' };
  return { day, weight: date.month === 1 ? 'year' : 'month' };
}

/**
 * The marks the playhead passes moving from story day `from` to `to`, in the order it passes
 * them, none finer than `finest` (the ruler's engraved unit). Going forward it passes a mark as
 * it enters that day; going back, as it leaves it.
 */
export function marksPassed(from: number, to: number, finest: DetentWeight): Mark[] {
  const first = Math.floor(Math.min(from, to)) + 1;
  const last = Math.floor(Math.max(from, to));
  const marks: Mark[] = [];
  for (let day = first; day <= last; day += 1) {
    const mark = markAt(day);
    if (RANK[mark.weight] >= RANK[finest]) marks.push(mark);
  }
  return from <= to ? marks : marks.reverse();
}
