// Shared world time, in dates.ts's proleptic Gregorian day numbers. The active director or
// exploration ruler writes it; readers need no story, DOM or frame loop.

export interface WorldTime {
  readonly day: number;
  /** The width in days that counts as "now", centered on day; follows the ruler's zoom. */
  readonly spanDays: number;
}

export class WorldClock {
  #time: WorldTime;
  readonly #listeners = new Set<(time: WorldTime) => void>();

  constructor(day = 0, spanDays = 1) {
    this.#time = snapshot(day, spanDays);
  }

  state(): WorldTime {
    return this.#time;
  }

  /** Publishes day and width together, including fractional days during a story's flight. */
  set(day: number, spanDays = this.#time.spanDays): void {
    const next = snapshot(day, spanDays);
    if (day === this.#time.day && spanDays === this.#time.spanDays) return;
    this.#time = next;
    for (const listener of this.#listeners) listener(next);
  }

  /** Changes only; read state() for the initial value. */
  subscribe(listener: (time: WorldTime) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}

function snapshot(day: number, spanDays: number): WorldTime {
  if (!Number.isFinite(day) || !Number.isFinite(spanDays) || spanDays <= 0) {
    throw new RangeError('World time needs a finite day and a positive finite span');
  }
  return Object.freeze({ day, spanDays });
}

/** One clock for the active world. A new clock can be injected into isolated walks and tests. */
export const worldClock = new WorldClock();
