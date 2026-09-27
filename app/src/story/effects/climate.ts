// The globe's climate in the walk (streaming.md 3.5): ModE-RA's monthly temperature anomalies
// under the story day, on the beats whose layers show climate monthly. The years those beats reach
// load at the start, from the beat before each (a flight sweeps story time from its date) to the
// end of the beat's window: each year's mean file is fetched from the data host, inflated and read
// (data/climate.ts). A year a scrub reaches beyond them loads when first asked for, and past the
// data's years the layer eases out. Each frame the two months around the story day blend into the
// look's field (look/climateHook.ts), uploaded when the blend changes, and the look's strength
// eases in and out over half a second as beats change, once a field has loaded. Annual means wait
// for the ruler's wide spans (monthly only here). Without a modera section in the release, or once
// a file fails, it logs once and draws no climate: the walk never breaks over climate.
import { DataUtils } from 'three';
import {
  climateKey,
  CLIMATE_YEAR_BYTES,
  ClimateError,
  blendMonths,
  monthsAround,
  parseClimate,
  type ClimateFile,
  type Month,
  type MonthBlend,
} from '../../data/climate';
import type { ModeraRelease } from '../../data/release';
import { fetchData } from '../../data/surfaceLayer';
import { CLIMATE_GRID, type ClimateUniforms } from '../../look/climateHook';
import { inflate } from '../../surface/wst';
import type { WalkState } from '../contract';
import { civilFromDay } from '../dates';
import type { Story, StoryBeat } from '../story';
import { smoothstep } from './timeline';

/** Where the climate files are: the release's data host and its modera section, if it has one. */
export interface ClimateSource {
  dataHost: string;
  modera?: ModeraRelease;
}

/** Fetches and reads one year's mean file. */
export type LoadClimateYear = (url: string) => Promise<ClimateFile>;

/** Seconds the climate takes to ease in or out. */
const EASE_S = 0.5;

const HALF_ONE = DataUtils.toHalfFloat(1);

export async function loadClimateYear(url: string): Promise<ClimateFile> {
  return parseClimate(await inflate(await fetchData(url), CLIMATE_YEAR_BYTES));
}

/** Whether the beat's layers show climate as monthly frames. */
export function showsMonthly(beat: StoryBeat | undefined): boolean {
  return beat !== undefined && beat.layers.includes('climate') && beat.climate === 'monthly';
}

/** The years of monthly frames the story's climate beats reach, and the flights into them. */
export function climateYears(story: Story): number[] {
  const years = new Set<number>();
  story.beats.forEach((beat, i) => {
    if (!showsMonthly(beat)) return;
    const days = [beat.day, ...(beat.window ?? []), story.beats[i - 1]?.day ?? beat.day];
    const first = monthsAround(Math.min(...days)).from.year;
    const last = monthsAround(Math.max(...days)).to.year;
    for (let year = first; year <= last; year += 1) years.add(year);
  });
  return [...years].sort((a, b) => a - b);
}

export class WalkClimate {
  readonly #uniforms: ClimateUniforms | undefined;
  readonly #source: ClimateSource;
  readonly #load: LoadClimateYear;
  readonly #years = new Map<number, ClimateFile | null>();
  readonly #field = new Float32Array(CLIMATE_GRID.nlat * CLIMATE_GRID.nlon);
  /** The blend drawn, and the month of the story day it was last drawn for. */
  #blend: MonthBlend | null = null;
  #month: Month | null = null;
  /** 0 to 1, before its easing curve. */
  #shown = 0;
  #off: boolean;

  constructor(
    story: Story,
    source: ClimateSource,
    uniforms: ClimateUniforms | undefined,
    load: LoadClimateYear = loadClimateYear,
  ) {
    this.#uniforms = uniforms;
    this.#source = source;
    this.#load = load;
    const years = climateYears(story);
    this.#off = uniforms === undefined || years.length === 0;
    if (this.#off) return;
    const { modera } = source;
    if (!modera) {
      this.#stop('the release has no modera section');
      return;
    }
    const { lat, lon0, dlon } = modera;
    const [north = 90, south = -90] = [lat[0], lat[lat.length - 1]];
    uniforms?.lookClimateGrid.value.set(lon0, dlon, north, (north - south) / (lat.length - 1));
    for (const year of years) this.#request(year);
  }

  /** How strongly climate data is drawn now, 0 to 1: 0 until a field has loaded. */
  get drawn(): number {
    return this.#blend ? smoothstep(0, 1, this.#shown) : 0;
  }

  /** The month drawn, while any climate is. */
  get month(): Month | null {
    return this.drawn > 0 ? this.#month : null;
  }

  /** Every frame: the blend for the story day on a climate beat, and the eased strength. */
  update(state: WalkState, dtS: number, strength: number): void {
    const uniforms = this.#uniforms;
    if (this.#off || !uniforms) return;
    const wanted = showsMonthly(state.story.beats[state.beat]) && this.#covers(state.day);
    if (wanted && this.#blendFor(state.day, uniforms)) {
      const { year, month } = civilFromDay(state.day);
      this.#month = { year, month };
    }
    const target = wanted && this.#blend ? 1 : 0;
    const step = dtS / EASE_S;
    this.#shown += Math.max(-step, Math.min(step, target - this.#shown));
    uniforms.lookClimateStrength.value = this.drawn * strength;
  }

  /**
   * Blends the months around `day` into the field once both years have loaded, uploading it when
   * the blend changes; true when the field is `day`'s.
   */
  #blendFor(day: number, uniforms: ClimateUniforms): boolean {
    const blend = monthsAround(day);
    const from = this.#request(blend.from.year);
    const to = this.#request(blend.to.year);
    if (!from || !to) return false;
    const last = this.#blend;
    const same = (a: Month, b: Month) => a.year === b.year && a.month === b.month;
    if (
      last &&
      same(last.from, blend.from) &&
      same(last.to, blend.to) &&
      Math.abs(last.w - blend.w) < 1e-4
    ) {
      return true;
    }
    blendMonths(from, blend.from.month, to, blend.to.month, blend.w, this.#field);
    const texture = uniforms.lookClimateField.value;
    const data = texture.image.data as Uint16Array;
    for (let i = 0; i < this.#field.length; i += 1) {
      const k = this.#field[i] ?? NaN;
      const present = !Number.isNaN(k);
      data[2 * i] = present ? DataUtils.toHalfFloat(k) : 0;
      data[2 * i + 1] = present ? HALF_ONE : 0;
    }
    texture.needsUpdate = true;
    this.#blend = blend;
    return true;
  }

  /** Whether the data's years hold both months around `day`. */
  #covers(day: number): boolean {
    const [first = 0, last = -1] = this.#source.modera?.years ?? [];
    const { from, to } = monthsAround(day);
    return from.year >= first && to.year <= last;
  }

  /** A year's file once loaded; the first ask starts its load. */
  #request(year: number): ClimateFile | null {
    const modera = this.#source.modera;
    if (!modera || this.#off) return null;
    const [first = 0, last = -1] = modera.years;
    if (year < first || year > last) return null;
    if (this.#years.has(year)) return this.#years.get(year) ?? null;
    this.#years.set(year, null);
    const url = `${this.#source.dataHost}/${climateKey(modera, year)}`;
    this.#load(url)
      .then((file) => {
        const { nlat, nlon } = CLIMATE_GRID;
        if (file.nlat !== nlat || file.nlon !== nlon || file.frames !== 12) {
          throw new ClimateError(`${url} holds ${file.frames} frames of ${file.nlat}x${file.nlon}`);
        }
        this.#years.set(year, file);
      })
      .catch((error: unknown) => this.#stop(String(error)));
    return null;
  }

  /** Draws no more climate. */
  dispose(): void {
    this.#stop('');
  }

  /** Logs why, once, and draws no climate from here on. */
  #stop(why: string): void {
    if (!this.#off && why) console.warn(`The globe shows no climate: ${why}`);
    this.#off = true;
    this.#blend = null;
    if (this.#uniforms) this.#uniforms.lookClimateStrength.value = 0;
  }
}
