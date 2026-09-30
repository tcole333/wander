// Where the climate's year files are and how one is read (streaming.md 3.5): each year's mean file
// on the release's data host, fetched, inflated and read by data/climate.ts, and checked to hold
// the 12 monthly frames of the look's grid. A story's climate (story/effects/climate.ts) and
// Explore's (clock.ts) each keep their own years.
import {
  climateKey,
  CLIMATE_YEAR_BYTES,
  ClimateError,
  parseClimate,
  type ClimateFile,
  type MonthBlend,
} from '../data/climate';
import type { ModeraRelease } from '../data/release';
import { fetchData } from '../data/surfaceLayer';
import { CLIMATE_GRID } from '../look/climateHook';
import { inflate } from '../surface/wst';

/** Where the climate files are: the release's data host and its modera section, if it has one. */
export interface ClimateSource {
  dataHost: string;
  modera?: ModeraRelease;
}

/** Fetches and reads one year's mean file. */
export type LoadClimateYear = (url: string) => Promise<ClimateFile>;

/** A year's mean file on the data host. */
export function climateUrl({ dataHost }: ClimateSource, modera: ModeraRelease, year: number) {
  return `${dataHost}/${climateKey(modera, year)}`;
}

/** Inflates and reads a stored year file. */
export async function decodeClimateYear(stored: ArrayBuffer): Promise<ClimateFile> {
  return parseClimate(await inflate(stored, CLIMATE_YEAR_BYTES));
}

export async function loadClimateYear(url: string): Promise<ClimateFile> {
  return decodeClimateYear(await fetchData(url));
}

/** `file`, read from `url`, once it holds the 12 monthly frames of the look's grid. */
export function checkClimateYear(file: ClimateFile, url: string): ClimateFile {
  const { nlat, nlon } = CLIMATE_GRID;
  if (file.nlat !== nlat || file.nlon !== nlon || file.frames !== 12) {
    throw new ClimateError(`${url} holds ${file.frames} frames of ${file.nlat}x${file.nlon}`);
  }
  return file;
}

/** Whether the data's years hold both months of `blend`. */
export function coversBlend(modera: ModeraRelease | undefined, { from, to }: MonthBlend): boolean {
  const [first = 0, last = -1] = modera?.years ?? [];
  return from.year >= first && to.year <= last;
}
