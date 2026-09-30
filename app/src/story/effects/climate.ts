// The globe's climate in a story (streaming.md 3.5): ModE-RA's monthly temperature anomalies under
// the story day, on the beats whose layers show climate monthly. The years those beats reach load
// once asked (the boot asks the first time the view settles with the tiles in view loaded), from
// the beat before each (a flight sweeps story time from its date) to the end of the beat's window:
// each year's mean file is fetched from the data host, inflated and read (climate/years.ts). A year
// a scrub reaches beyond them loads when first asked for, and past the data's years the layer eases
// out. Each frame the two months around the story day blend into the look's field
// (climate/field.ts), which uploads it when the blend differs from what it holds, Explore's
// included, and the look's strength eases in and out over half a second as beats change, once a
// field has loaded. Annual means wait for the ruler's wide spans (monthly only here). Without a
// modera section in the release, or once a file fails, it logs once and draws no climate: the walk
// never breaks over climate.
import { monthsAround, type ClimateFile, type Month } from '../../data/climate';
import type { ClimateField } from '../../climate/field';
import {
  checkClimateYear,
  climateUrl,
  coversBlend,
  loadClimateYear,
  type ClimateSource,
  type LoadClimateYear,
} from '../../climate/years';
import type { WalkState } from '../contract';
import { civilFromDay } from '../dates';
import type { Story, StoryBeat } from '../story';
import { smoothstep } from './timeline';
import type { MemoryAccount } from '../../perf/memory';

/** Seconds the climate takes to ease in or out. */
const EASE_S = 0.5;

/** Whether the beat's layers show climate as monthly frames. */
export function showsMonthly(beat: StoryBeat | undefined): boolean {
  return beat !== undefined && beat.layers.includes('climate') && beat.climate === 'monthly';
}

/** The years of monthly frames the story's climate beats reach, and the flights into them. */
export function climateYears(story: Story): number[] {
  const years = new Set<number>();
  story.beats.forEach((beat, i) => {
    if (!showsMonthly(beat)) return;
    const days = [...beat.window, story.beats[i - 1]?.day ?? beat.day];
    const first = monthsAround(Math.min(...days)).from.year;
    const last = monthsAround(Math.max(...days)).to.year;
    for (let year = first; year <= last; year += 1) years.add(year);
  });
  return [...years].sort((a, b) => a - b);
}

export class StoryClimate {
  readonly #field: ClimateField | undefined;
  readonly #source: ClimateSource;
  readonly #load: LoadClimateYear;
  /** The years the story's climate beats reach, which load() fetches. */
  readonly #reach: number[];
  readonly #years = new Map<number, ClimateFile | null>();
  /** Whether a blend has been drawn, and the month of the story day it was last drawn for. */
  #loaded = false;
  #month: Month | null = null;
  /** 0 to 1, before its easing curve. */
  #shown = 0;
  #off: boolean;

  constructor(
    story: Story,
    source: ClimateSource,
    field: ClimateField | undefined,
    load: LoadClimateYear = loadClimateYear,
  ) {
    this.#field = field;
    this.#source = source;
    this.#load = load;
    this.#reach = climateYears(story);
    this.#off = field === undefined || this.#reach.length === 0;
    if (this.#off) return;
    const { modera } = source;
    if (!modera) {
      this.#stop('the release has no modera section');
      return;
    }
    field?.useGrid(modera);
  }

  inspectMemory(account: MemoryAccount): void {
    this.#field?.inspectMemory(account);
    for (const [year, file] of this.#years) {
      if (!file) continue;
      for (const array of [file.codes, file.scale, file.offset])
        account.array(`climate.year.${year}`, array);
    }
  }

  /** Starts loading the years the story's climate beats reach. */
  load(): void {
    for (const year of this.#reach) this.#request(year);
  }

  /** How strongly climate data is drawn now, 0 to 1: 0 until a field has loaded. */
  get drawn(): number {
    return this.#loaded ? smoothstep(0, 1, this.#shown) : 0;
  }

  /** The month drawn, while any climate is. */
  get month(): Month | null {
    return this.drawn > 0 ? this.#month : null;
  }

  /** Every frame: the blend for the story day on a climate beat, and the eased strength. */
  update(state: WalkState, dtS: number, strength: number): void {
    const field = this.#field;
    if (this.#off || !field) return;
    const blend = monthsAround(state.day);
    const wanted =
      showsMonthly(state.story.beats[state.beat]) && coversBlend(this.#source.modera, blend);
    if (wanted) {
      const from = this.#request(blend.from.year);
      const to = this.#request(blend.to.year);
      if (from && to) {
        field.draw(from, to, blend);
        this.#loaded = true;
        const { year, month } = civilFromDay(state.day);
        this.#month = { year, month };
      }
    }
    const target = wanted && this.#loaded ? 1 : 0;
    const step = dtS / EASE_S;
    this.#shown += Math.max(-step, Math.min(step, target - this.#shown));
    field.strength = this.drawn * strength;
  }

  /** A year's file once loaded; the first ask starts its load. */
  #request(year: number): ClimateFile | null {
    const modera = this.#source.modera;
    if (!modera || this.#off) return null;
    const [first = 0, last = -1] = modera.years;
    if (year < first || year > last) return null;
    if (this.#years.has(year)) return this.#years.get(year) ?? null;
    this.#years.set(year, null);
    const url = climateUrl(this.#source, modera, year);
    this.#load(url)
      .then((file) => this.#years.set(year, checkClimateYear(file, url)))
      .catch((error: unknown) => this.#stop(String(error)));
    return null;
  }

  /** Clears the lobby while retaining the loaded years for the next walk. */
  hide(): void {
    this.#shown = 0;
    if (this.#field) this.#field.strength = 0;
  }

  /** Draws no more climate. */
  dispose(): void {
    this.#stop('');
  }

  /** Logs why, once, and draws no climate from here on. */
  #stop(why: string): void {
    if (!this.#off && why) console.warn(`The globe shows no climate: ${why}`);
    this.#off = true;
    this.#loaded = false;
    if (this.#field) this.#field.strength = 0;
  }
}
