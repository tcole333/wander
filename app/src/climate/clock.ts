// Climate at the clock's date (streaming.md 3.5): Explore's climate, read from the world clock
// rather than a story's beats. While the ruler's visible width is at most climateMonthlySpan years
// and both months around the day lie within the data's years (1421-2008), their frames blend into
// the look's field (field.ts), the months named as the ruler names them (Julian before the reform);
// otherwise the layer eases out, as annual means come later. It keeps its own years: the day's
// year and climatePrefetchYears either side (about 1.1 MiB), fetched nearest first, two at a time,
// and dropped as the day leaves them; end() empties them. At most one year is decoded and the field
// rewritten once a frame, so a scrub stacks no work into one frame. While the years a new day needs
// are on their way, the field drawn stays up only if it is within a month of the day; further, the
// layer eases out until they come. A failed year logs once and draws no more climate: Explore goes
// on without it until its next dive.
import { tunables } from '../config/tunables';
import { monthsAround, type ClimateFile, type Month, type MonthBlend } from '../data/climate';
import { fetchData } from '../data/surfaceLayer';
import type { MemoryAccount } from '../perf/memory';
import { HISTORICAL, type Calendar } from '../story/dates';
import { smoothstep } from '../story/effects/timeline';
import type { WorldTime } from '../time/worldClock';
import type { ClimateField } from './field';
import {
  checkClimateYear,
  climateUrl,
  coversBlend,
  decodeClimateYear,
  type ClimateSource,
} from './years';

/** Seconds the climate takes to ease in or out, as in a story. */
const EASE_S = 0.5;
/** Mean Gregorian days in a year. */
const YEAR_DAYS = 365.2425;
/** Year files fetched at once: the months the day needs come first, and a fast scrub queues few. */
const FETCHES = 2;

/** The memory account's owner for Explore's climate years. */
export const CLOCK_CLIMATE_OWNER = 'explore.climate';

export interface ClockClimateOptions {
  /** Years of ruler width at or under which monthly frames are drawn. */
  monthlySpanYears?: number;
  /** Years either side of the day's that stay resident. */
  prefetchYears?: number;
  /** Fetches a year's stored file, retrying while `stillWanted`. */
  fetch?: (url: string, stillWanted: () => boolean) => Promise<ArrayBuffer>;
  /** Inflates and reads a stored year file. */
  decode?: (stored: ArrayBuffer) => Promise<ClimateFile>;
  /** The calendar the months are named in. */
  calendar?: Calendar;
}

/** A resident year: on its way, fetched and waiting its turn to decode, decoding, or read. */
type Year =
  | { state: 'fetching' }
  | { state: 'fetched'; stored: ArrayBuffer }
  | { state: 'decoding' }
  | { state: 'ready'; file: ClimateFile };

/** A month as a count of months, to measure between two. */
const monthIndex = ({ year, month }: Month) => year * 12 + month - 1;

export class ClockClimate {
  readonly #field: ClimateField | undefined;
  readonly #source: ClimateSource;
  readonly #monthlySpanDays: number;
  readonly #prefetchYears: number;
  readonly #fetch: NonNullable<ClockClimateOptions['fetch']>;
  readonly #decode: NonNullable<ClockClimateOptions['decode']>;
  readonly #calendar: Calendar;
  readonly #years = new Map<number, Year>();
  #fetching = 0;
  #decoding = false;
  /** The months the field was last drawn with here, and the day's month they were drawn for. */
  #drawn: { from: number; month: Month } | null = null;
  /** 0 to 1, before its easing curve. */
  #shown = 0;
  #off: boolean;

  constructor(
    source: ClimateSource,
    field: ClimateField | undefined,
    {
      monthlySpanYears = tunables.climateMonthlySpan,
      prefetchYears = tunables.climatePrefetchYears,
      fetch = fetchData,
      decode = decodeClimateYear,
      calendar = HISTORICAL,
    }: ClockClimateOptions = {},
  ) {
    this.#field = field;
    this.#source = source;
    this.#monthlySpanDays = monthlySpanYears * YEAR_DAYS;
    this.#prefetchYears = prefetchYears;
    this.#fetch = fetch;
    this.#decode = decode;
    this.#calendar = calendar;
    this.#off = field === undefined;
    if (this.#off) return;
    if (!source.modera) {
      this.#stop('the release has no modera section');
      return;
    }
    field?.useGrid(source.modera);
  }

  /** How strongly climate data is drawn now, 0 to 1: 0 until a field has loaded. */
  get drawn(): number {
    return this.#drawn ? smoothstep(0, 1, this.#shown) : 0;
  }

  /** The month drawn, while any climate is. */
  get month(): Month | null {
    return this.drawn > 0 ? (this.#drawn?.month ?? null) : null;
  }

  /** The years resident or on their way, for tests and the memory account. */
  get years(): number[] {
    return [...this.#years.keys()].sort((a, b) => a - b);
  }

  /**
   * Every frame: keeps the years around the clock's day, decodes at most one, draws the day's
   * months while the ruler is close enough, and eases the strength, drawn at `strength`.
   */
  update({ day, spanDays }: WorldTime, dtS: number, strength = 1): void {
    const field = this.#field;
    if (this.#off || !field) return;
    const blend = monthsAround(day, this.#calendar);
    const wanted = spanDays <= this.#monthlySpanDays && coversBlend(this.#source.modera, blend);
    const order = this.#keep(this.#calendar.civil(day).year, blend, wanted);
    this.#decodeNext(order);
    if (wanted) this.#draw(field, blend, day);
    const near = this.#drawn !== null && Math.abs(this.#drawn.from - monthIndex(blend.from)) <= 1;
    const target = wanted && near ? 1 : 0;
    const step = dtS / EASE_S;
    this.#shown += Math.max(-step, Math.min(step, target - this.#shown));
    field.strength = this.drawn * strength;
  }

  /**
   * Drops the years the day has left, and while monthly frames are wanted, starts fetching those
   * it needs: the blend's own years first, then the nearest. Returns the years to keep, in order.
   */
  #keep(year: number, blend: MonthBlend, wanted: boolean): number[] {
    const [first = 0, last = -1] = this.#source.modera?.years ?? [];
    const reach = this.#prefetchYears;
    const around: number[] = [];
    for (let y = Math.max(first, year - reach); y <= Math.min(last, year + reach); y += 1) {
      around.push(y);
    }
    around.sort((a, b) => Math.abs(a - year) - Math.abs(b - year) || a - b);
    const order = [...new Set([blend.from.year, blend.to.year, ...around])].filter((y) =>
      around.includes(y),
    );
    for (const y of this.#years.keys()) if (!order.includes(y)) this.#years.delete(y);
    if (!wanted) return order;
    for (const y of order) {
      if (this.#fetching >= FETCHES) break;
      if (!this.#years.has(y)) this.#fetchYear(y);
    }
    return order;
  }

  #fetchYear(year: number): void {
    const modera = this.#source.modera;
    if (!modera) return;
    const url = climateUrl(this.#source, modera, year);
    const entry: Year = { state: 'fetching' };
    this.#years.set(year, entry);
    this.#fetching += 1;
    const current = () => !this.#off && this.#years.get(year) === entry;
    this.#fetch(url, current)
      .then((stored) => {
        if (current()) this.#years.set(year, { state: 'fetched', stored });
      })
      .catch((error: unknown) => {
        if (current()) this.#stop(String(error));
      })
      .finally(() => {
        this.#fetching -= 1;
      });
  }

  /** Starts decoding the first fetched year in `order`, unless one is decoding. */
  #decodeNext(order: number[]): void {
    const modera = this.#source.modera;
    if (this.#decoding || !modera) return;
    for (const year of order) {
      const entry = this.#years.get(year);
      if (entry?.state !== 'fetched') continue;
      const decoding: Year = { state: 'decoding' };
      this.#years.set(year, decoding);
      this.#decoding = true;
      const current = () => !this.#off && this.#years.get(year) === decoding;
      const url = climateUrl(this.#source, modera, year);
      this.#decode(entry.stored)
        .then((file) => {
          if (current())
            this.#years.set(year, { state: 'ready', file: checkClimateYear(file, url) });
        })
        .catch((error: unknown) => {
          if (current()) this.#stop(String(error));
        })
        .finally(() => {
          this.#decoding = false;
        });
      return;
    }
  }

  /** Draws the blend for `day` once both its years are read; the field skips a blend it holds. */
  #draw(field: ClimateField, blend: MonthBlend, day: number): void {
    const from = this.#file(blend.from.year);
    const to = this.#file(blend.to.year);
    if (!from || !to) return;
    field.draw(from, to, blend);
    const { year, month } = this.#calendar.civil(day);
    this.#drawn = { from: monthIndex(blend.from), month: { year, month } };
  }

  #file(year: number): ClimateFile | null {
    const entry = this.#years.get(year);
    return entry?.state === 'ready' ? entry.file : null;
  }

  inspectMemory(account: MemoryAccount): void {
    account.bytes(CLOCK_CLIMATE_OWNER, 'arrayBuffers', 0);
    this.#field?.inspectMemory(account);
    for (const entry of this.#years.values()) {
      if (entry.state === 'fetched') account.array(CLOCK_CLIMATE_OWNER, entry.stored);
      if (entry.state !== 'ready') continue;
      const { codes, scale, offset } = entry.file;
      for (const array of [codes, scale, offset]) account.array(CLOCK_CLIMATE_OWNER, array);
    }
  }

  /** Explore has ended: empties its years and draws no more climate. */
  end(): void {
    this.#off = true;
    this.#years.clear();
    this.#drawn = null;
    this.#shown = 0;
    if (this.#field) this.#field.strength = 0;
  }

  /** Logs why, once, and draws no climate from here on. */
  #stop(why: string): void {
    if (!this.#off) console.warn(`The globe shows no climate: ${why}`);
    this.#off = true;
    this.#years.clear();
    this.#drawn = null;
    if (this.#field) this.#field.strength = 0;
  }
}
