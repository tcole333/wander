// The free ruler's viewport and gestures. The globe need not know about time yet.
import { dayFromHistorical } from '../story/dates';
import type { Span } from '../story/ui/format';
import { anchored } from '../story/ui/rulerScale';
import {
  nowWindow,
  worldClock,
  type DayWindow,
  type WorldClock,
  type WorldTime,
} from './worldClock';

/**
 * Inclusive day limits: all of 10,000 BCE through the last day of 2000 CE, in the historical
 * calendar the ruler engraves (1 January 10,000 BCE in the Julian).
 */
export const HISTORY: Span = Object.freeze({
  start: dayFromHistorical({ year: -9999, month: 1, day: 1 }),
  end: dayFromHistorical({ year: 2000, month: 12, day: 31 }),
});
export const MIN_EXPLORE_DAYS = 4;

/**
 * `window` with each end kept within `history`. Near either end of history the ruler's width
 * reaches days Explore does not hold, so whatever asks for events by date asks within it: nothing
 * after 2000 or before 10,000 BCE is marked, kept focal or picked for Meanwhile.
 */
export function withinHistory(window: DayWindow, history: Span = HISTORY): DayWindow {
  return {
    start: clamp(window.start, history.start, history.end),
    end: clamp(window.end, history.start, history.end),
  };
}

/** Explore's now window: the clock's (worldClock.ts, nowWindow), within history. */
export function exploreWindow(time: WorldTime): DayWindow {
  return withinHistory(nowWindow(time));
}

/** Mean Gregorian days in a year. */
const YEAR_DAYS = 365.2425;

export interface ExploreTimeOptions {
  /**
   * How many years the ruler first shows, centered on the opening day and kept within the bounds;
   * all of them when absent.
   */
  openYears?: number;
}

export class ExploreTime {
  readonly clock: WorldClock;
  readonly bounds: Span;
  /** Half-open drawing extent: the last selectable day owns a full cell too. */
  readonly extent: Span;
  #span: Span;
  readonly #viewportListeners = new Set<() => void>();

  constructor(
    clock = worldClock,
    bounds = HISTORY,
    day = 0,
    { openYears }: ExploreTimeOptions = {},
  ) {
    if (
      !Number.isFinite(bounds.start) ||
      !Number.isFinite(bounds.end) ||
      bounds.end <= bounds.start
    ) {
      throw new RangeError('Exploration needs a finite, increasing span');
    }
    this.clock = clock;
    this.bounds = Object.freeze({ ...bounds });
    this.extent = Object.freeze({ start: bounds.start, end: bounds.end + 1 });
    this.#span = this.extent;
    if (openYears !== undefined && Number.isFinite(openYears) && Number.isFinite(day)) {
      const full = this.extent.end - this.extent.start;
      const width = clamp(openYears * YEAR_DAYS, Math.min(MIN_EXPLORE_DAYS, full), full);
      this.#span = this.#keep({ start: day - width / 2, end: day + width / 2 });
    }
    this.#publish(day);
  }

  get span(): Span {
    return this.#span;
  }

  /** The date, zoom or viewport moved. A recenter can move the view without changing the clock. */
  subscribe(listener: () => void): () => void {
    this.#viewportListeners.add(listener);
    const stopClock = this.clock.subscribe(listener);
    return () => {
      stopClock();
      this.#viewportListeners.delete(listener);
    };
  }

  /** Whole-day scrubbing; the view follows the playhead until a history limit stops it. */
  scrub(day: number): void {
    if (!Number.isFinite(day)) return;
    day = clamp(Math.floor(day), this.bounds.start, this.bounds.end);
    this.#span = this.#keep(anchored(this.#span, day, 0.1));
    this.#publish(day);
  }

  /** The overview tier jumps through history, preserving the current zoom. */
  seek(day: number): void {
    if (!Number.isFinite(day)) return;
    day = clamp(Math.floor(day), this.bounds.start, this.bounds.end);
    const width = this.#span.end - this.#span.start;
    this.#span = this.#keep({ start: day - width / 2, end: day + width / 2 });
    this.#publish(day);
  }

  /**
   * Zoom about the date under the pointer (share 0..1), except where a history limit stops the
   * view. Keep the selected day if visible; otherwise select the nearest whole day in view.
   */
  zoom(factor: number, share: number): void {
    if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(share)) return;
    share = clamp(share, 0, 1);
    const full = this.extent.end - this.extent.start;
    const old = this.#span.end - this.#span.start;
    const width = clamp(old * factor, Math.min(MIN_EXPLORE_DAYS, full), full);
    const pivot = this.#span.start + share * old;
    const start = pivot - share * width;
    this.#span = this.#keep({ start, end: start + width });
    const day = clamp(
      this.clock.state().day,
      Math.ceil(this.#span.start),
      Math.ceil(this.#span.end) - 1,
    );
    this.#publish(day);
  }

  #keep(span: Span): Span {
    const width = span.end - span.start;
    const start = clamp(span.start, this.extent.start, this.extent.end - width);
    return Object.freeze({ start, end: start + width });
  }

  #publish(day: number): void {
    const before = this.clock.state();
    this.clock.set(
      clamp(Math.floor(day), this.bounds.start, this.bounds.end),
      this.#span.end - this.#span.start,
    );
    if (this.clock.state() === before) {
      for (const listener of this.#viewportListeners) listener();
    }
  }
}

/** WheelEvent pixel, line and page deltas in one restrained exponential zoom. */
export function wheelZoom(delta: number, mode: number, pagePx: number): number {
  const pixels = delta * (mode === 1 ? 16 : mode === 2 ? pagePx : 1);
  return Math.exp(clamp(pixels, -600, 600) * 0.002);
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}
