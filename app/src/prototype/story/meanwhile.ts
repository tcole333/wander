// Meanwhile's stand-in entries (meanwhile.tambora.json) as the walk's UI takes them. The file
// gives each date as an ISO string; the UI's entries carry day numbers (dates.ts).
import type { MeanwhileByBeat, MeanwhileEntry } from './contract';
import { dayFromIso } from './dates';

/** An entry as the JSON file holds it. */
export type MeanwhileJsonEntry = Omit<MeanwhileEntry, 'day' | 'at'> & {
  day: string;
  at: number[];
};

export function meanwhileFromJson(json: Record<string, MeanwhileJsonEntry[]>): MeanwhileByBeat {
  const byBeat: MeanwhileByBeat = {};
  for (const [beatId, entries] of Object.entries(json)) {
    byBeat[beatId] = entries.map((entry) => {
      const [lon, lat] = entry.at;
      if (lon === undefined || lat === undefined) {
        throw new RangeError(`Meanwhile entry '${entry.label}' has no [lon, lat]`);
      }
      return { ...entry, day: dayFromIso(entry.day), at: [lon, lat] };
    });
  }
  return byBeat;
}
