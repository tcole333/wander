// The render-scale governor (streaming.md 5.8; `governor` and `renderScale` in section 10). It
// steps render scale down when animated frames miss vsyncs and up after sustained headroom: GPU p90
// under `upGpuP90Frac` of the interval for `upAfter` where timer queries exist, or `upProbe` with no
// missed vsync where they do not. A step up that misses within `revertWindow` goes back, and step-ups
// then rest for `backoff`. It changes nothing while a flight or gesture runs, and never leaves the
// tier's range or passes `maxScale` (the GPU cap). Only animated frames count; frames drawn on
// demand say nothing about load.
import { tunables, type Tier } from '../config/tunables';
import { missedVsyncs, nearestRank } from './frameStats';

export interface GovernorFrame {
  /** Milliseconds, a monotonic clock. */
  now: number;
  /** Time since the previous animated frame. */
  deltaMs: number;
  intervalMs: number;
  /** GPU time of the frame from a timer query, or null without one. */
  gpuMs: number | null;
  /** A flight or gesture is running: scale changes wait (5.8). */
  moving: boolean;
}

type Rules = typeof tunables.governor;

interface Sample {
  now: number;
  missed: number;
  vsyncs: number;
  gpuMs: number | null;
}

export class Governor {
  readonly #rules: Rules;
  readonly #timerQueries: boolean;
  readonly #min: number;
  readonly #max: number;
  readonly #step: number;
  #scale: number;
  /** The last `downWindowFrames` animated frames since the scale last changed. */
  #window: Sample[] = [];
  /** Frames since the scale last changed, no older than the longer of the two up rules. */
  #recent: Sample[] = [];
  #changedAt: number | null = null;
  /** After a step up: the scale to return to, and when the watch started. */
  #watch: { back: number; from: number } | null = null;
  #noUpBefore = -Infinity;

  constructor(
    tier: Tier,
    options: { timerQueries: boolean; rules?: Rules; maxScale?: number; start?: number },
  ) {
    const range = tunables.renderScale[tier];
    this.#rules = options.rules ?? tunables.governor;
    this.#timerQueries = options.timerQueries;
    this.#min = range.min;
    this.#max = Math.min(range.max, options.maxScale ?? Infinity);
    this.#step = tunables.renderScale.step;
    this.#scale = clamp(options.start ?? tunables.renderScale.start, this.#min, this.#max);
  }

  get scale(): number {
    return this.#scale;
  }

  /** Records an animated frame; returns the render scale to use from now on. */
  frame(input: GovernorFrame): number {
    const rules = this.#rules;
    const { now } = input;
    const missed = missedVsyncs(input.deltaMs, input.intervalMs);
    const sample = { now, missed, vsyncs: missed + 1, gpuMs: input.gpuMs };
    this.#changedAt ??= now;
    this.#window.push(sample);
    if (this.#window.length > rules.downWindowFrames) this.#window.shift();
    this.#recent.push(sample);
    const keep = Math.max(rules.upAfter, rules.upProbe);
    while ((this.#recent[0]?.now ?? now) < now - keep) this.#recent.shift();

    if (input.moving) return this.#scale;

    // A step up that misses within the watch goes back, and step-ups rest for the backoff.
    if (this.#watch) {
      const { back, from } = this.#watch;
      if (missFraction(this.#recent.filter((s) => s.now >= from)) > rules.revertMissFrac) {
        this.#watch = null;
        this.#noUpBefore = now + rules.backoff;
        return this.#set(back, now);
      }
      if (now - from >= rules.revertWindow) this.#watch = null;
    }

    if (
      this.#window.length >= rules.downWindowFrames &&
      missFraction(this.#window) > rules.downMissFrac
    ) {
      this.#watch = null;
      return this.#set(this.#scale - this.#step, now);
    }

    if (now < this.#noUpBefore || this.#scale >= this.#max) return this.#scale;
    const elapsed = now - (this.#changedAt ?? now);
    let up: boolean;
    if (this.#timerQueries) {
      const gpu = this.#recent
        .filter((s) => s.now >= now - rules.upAfter && s.gpuMs !== null)
        .map((s) => s.gpuMs ?? 0);
      up =
        elapsed >= rules.upAfter &&
        gpu.length > 0 &&
        nearestRank(gpu, 0.9) < rules.upGpuP90Frac * input.intervalMs;
    } else {
      up =
        elapsed >= rules.upProbe &&
        this.#recent.every((s) => s.now < now - rules.upProbe || s.missed === 0);
    }
    if (!up) return this.#scale;
    const back = this.#scale;
    this.#set(this.#scale + this.#step, now);
    this.#watch = { back, from: now };
    return this.#scale;
  }

  #set(scale: number, now: number): number {
    const next = clamp(scale, this.#min, this.#max);
    if (next !== this.#scale) {
      this.#scale = next;
      this.#window = [];
      this.#recent = [];
      this.#changedAt = now;
    }
    return this.#scale;
  }
}

function missFraction(samples: readonly Sample[]): number {
  let missed = 0;
  let vsyncs = 0;
  for (const s of samples) {
    missed += s.missed;
    vsyncs += s.vsyncs;
  }
  return vsyncs ? missed / vsyncs : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
