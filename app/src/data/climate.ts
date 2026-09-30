// The climate layer's files (streaming.md 3.5), the inverse of pipeline/src/prebuild/modera.py:
// ModE-RA's monthly 2 m temperature anomalies, in K against 1901-2000, one WCY1 file of 12 frames
// per year on the native grid (row 0 northmost, column 0 centered at the release's lon0), stored
// gzip. parseClimate reads an inflated file; monthsAround names the two monthly frames a day falls
// between, each month's frame standing at its middle, in the calendar that names the months (a
// story's Gregorian, or the historical one Explore's ruler engraves); blendMonths mixes them into
// one field. Pure and without three, like the surface decoder.
import constants from '@shared/constants.json' with { type: 'json' };
import { GREGORIAN, type Calendar } from '../story/dates';
import type { ModeraRelease } from './release';

export const CLIMATE_MAGIC: string = constants.formats.climate.magic;
export const CLIMATE_VERSION: number = constants.formats.climate.version;
/** The code a missing value takes. */
export const CLIMATE_MISSING: number = constants.sentinels.climateMissing;
/** 'WCY1' u8 version | u8 variable | i16 firstYear | u16 frames | u16 nlat | u16 nlon | u16 pad. */
const HEADER_BYTES = 16;

export class ClimateError extends Error {
  override name = 'ClimateError';
}

/** One climate file: u8 codes per frame on the native grid, with each frame's scale and offset. */
export interface ClimateFile {
  /** 0 mean, 1 spread, 2 annual mean. */
  variable: number;
  firstYear: number;
  frames: number;
  nlat: number;
  nlon: number;
  /** Per frame: K = code·scale + offset. */
  scale: Float32Array;
  offset: Float32Array;
  /** frames × nlat × nlon codes, row 0 northmost; CLIMATE_MISSING where the source has none. */
  codes: Uint8Array;
}

/** The largest inflated year file: 12 frames of 96 × 192 codes and their scales and offsets. */
export const CLIMATE_YEAR_BYTES = HEADER_BYTES + 12 * (8 + 96 * 192);

/** A year file's key under the data host. */
export function climateKey(modera: ModeraRelease, year: number): string {
  return `fd/modera/${modera.ver}/mean/${year}.bin`;
}

/** Reads an inflated climate file, checking its magic, version and length. */
export function parseClimate(raw: Uint8Array): ClimateFile {
  if (raw.length < HEADER_BYTES) {
    throw new ClimateError(`${raw.length} bytes hold no climate header`);
  }
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const magic = String.fromCharCode(...raw.subarray(0, 4));
  const version = view.getUint8(4);
  if (magic !== CLIMATE_MAGIC || version !== CLIMATE_VERSION) {
    throw new ClimateError(`not a version ${CLIMATE_VERSION} climate file: ${magic} ${version}`);
  }
  const frames = view.getUint16(8, true);
  const nlat = view.getUint16(10, true);
  const nlon = view.getUint16(12, true);
  const expected = HEADER_BYTES + 8 * frames + frames * nlat * nlon;
  if (raw.length !== expected) {
    throw new ClimateError(`${raw.length} bytes do not hold ${frames} frames of ${nlat}x${nlon}`);
  }
  const scale = new Float32Array(frames);
  const offset = new Float32Array(frames);
  for (let f = 0; f < frames; f += 1) {
    scale[f] = view.getFloat32(HEADER_BYTES + 4 * f, true);
    offset[f] = view.getFloat32(HEADER_BYTES + 4 * (frames + f), true);
  }
  return {
    variable: view.getUint8(5),
    firstYear: view.getInt16(6, true),
    frames,
    nlat,
    nlon,
    scale,
    offset,
    codes: raw.subarray(HEADER_BYTES + 8 * frames),
  };
}

/** A month: its year and 1-12. */
export interface Month {
  year: number;
  month: number;
}

/** The two months whose middles a day falls between, and how far it has gone from one to the other. */
export interface MonthBlend {
  from: Month;
  to: Month;
  /** 0 at the middle of `from`, 1 at the middle of `to`. */
  w: number;
}

/** Month `index` of the count year·12 + month − 1. */
function monthAt(index: number): Month {
  return { year: Math.floor(index / 12), month: (((index % 12) + 12) % 12) + 1 };
}

/** A month's middle, as a day number: halfway between its first day and the next month's. */
function middle(index: number, calendar: Calendar): number {
  const start = (i: number) => calendar.day({ ...monthAt(i), day: 1 });
  return (start(index) + start(index + 1)) / 2;
}

/**
 * The months around `day`, as `calendar` names them: each month's frame stands at its middle, and
 * days between blend.
 */
export function monthsAround(day: number, calendar: Calendar = GREGORIAN): MonthBlend {
  const { year, month } = calendar.civil(day);
  let index = year * 12 + month - 1;
  if (day < middle(index, calendar)) index -= 1;
  const [a, b] = [middle(index, calendar), middle(index + 1, calendar)];
  const w = (day - a) / (b - a);
  return { from: monthAt(index), to: monthAt(index + 1), w: Math.min(1, Math.max(0, w)) };
}

/**
 * Month `a.month` of file `a` blended with month `b.month` of file `b` (the same grid) by `w`, as
 * K per cell into `out`, NaN where neither has a value; where only one does, it holds.
 */
export function blendMonths(
  a: ClimateFile,
  aMonth: number,
  b: ClimateFile,
  bMonth: number,
  w: number,
  out: Float32Array,
): Float32Array {
  const cells = a.nlat * a.nlon;
  if (b.nlat * b.nlon !== cells || out.length !== cells) {
    throw new ClimateError('the frames and the field are on different grids');
  }
  const fa = aMonth - 1;
  const fb = bMonth - 1;
  const [sa, oa] = [a.scale[fa] ?? 0, a.offset[fa] ?? 0];
  const [sb, ob] = [b.scale[fb] ?? 0, b.offset[fb] ?? 0];
  const ca = a.codes.subarray(fa * cells, (fa + 1) * cells);
  const cb = b.codes.subarray(fb * cells, (fb + 1) * cells);
  for (let i = 0; i < cells; i += 1) {
    const codeA = ca[i] ?? CLIMATE_MISSING;
    const codeB = cb[i] ?? CLIMATE_MISSING;
    const kA = codeA * sa + oa;
    const kB = codeB * sb + ob;
    if (codeA === CLIMATE_MISSING) out[i] = codeB === CLIMATE_MISSING ? NaN : kB;
    else out[i] = codeB === CLIMATE_MISSING ? kA : kA + (kB - kA) * w;
  }
  return out;
}
