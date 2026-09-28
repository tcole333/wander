// Meanwhile's entries as the walk's UI takes them, from the story's lock (lock.ts), where the
// prebuild's meanwhile stage puts them (streaming.md 3.9): each beat's, which show the lines the
// story's writers give them, and each month's for scrubbing, which show the Wikidata label. The
// lock gives each date as an ISO string with its precision; the UI's entries carry day numbers and
// the date as the panel prints it (dates.ts).
import type { Meanwhile, MeanwhileEntry, MeanwhileMonth } from './contract';
import { civilFromDay, dayFromCivil, dayFromIso, formatDay, type Precision } from './dates';
import type { LockedEvent, StoryLock } from './lock';
import type { LonLat } from './story';

export function meanwhileFromLock(lock: StoryLock): Meanwhile {
  const beats: Meanwhile['beats'] = {};
  for (const [beatId, entries] of Object.entries(lock.meanwhile?.beats ?? {})) {
    beats[beatId] = entries.map(fromLock);
  }
  const months = Object.entries(lock.meanwhile?.months ?? {}).map(([key, entries]) => {
    const start = dayFromIso(`${key}-01`);
    const { year, month } = civilFromDay(start);
    const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
    return { start, end: dayFromCivil({ ...next, day: 1 }) - 1, entries: entries.map(fromLock) };
  });
  return { beats, months: months.sort((a, b) => a.start - b.start) };
}

/** The entries of the month `day` falls in, or of the month nearest it. */
export function scrubbedEntries({ months }: Meanwhile, day: number): MeanwhileEntry[] {
  const away = (month: MeanwhileMonth) => Math.max(month.start - day, day - month.end, 0);
  let nearest: MeanwhileMonth | undefined;
  for (const month of months) if (!nearest || away(month) < away(nearest)) nearest = month;
  return nearest?.entries ?? [];
}

/** Where the lobby's glows are. */
export function glowsFromLock(lock: StoryLock): LonLat[] {
  return (lock.glows ?? []).map((glow) => lonLat(glow.at, glow.label));
}

function fromLock(event: LockedEvent): MeanwhileEntry {
  const day = dayFromIso(event.date);
  return {
    label: event.line ?? event.label,
    day,
    dateLabel: formatDay(day, precision(event.precision, event.label)),
    at: lonLat(event.at, event.label),
    qid: event.qid,
    source: event.source,
  };
}

function precision(value: string, label: string): Precision {
  if (value === 'day' || value === 'month' || value === 'year') return value;
  throw new RangeError(`Meanwhile's '${label}' has no precision day, month or year: ${value}`);
}

function lonLat(at: number[], label: string): LonLat {
  const [lon, lat] = at;
  if (lon === undefined || lat === undefined) {
    throw new RangeError(`Meanwhile's '${label}' has no [lon, lat]`);
  }
  return [lon, lat];
}
