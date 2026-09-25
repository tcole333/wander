// The render-scale governor (streaming.md 5.8; `governor` and `renderScale` in section 10). It
// steps render scale down when animated frames miss vsyncs and up after sustained headroom: GPU p90
// under `upGpuP90Frac` of the interval for `upAfter` where timer queries exist, or `upProbe` with no
// missed vsync where they do not. A step up that misses more than `revertMissFrac` of the vsyncs in
// its `revertWindow` goes back, and step-ups then rest for `backoff`. It changes nothing while a
// flight or gesture runs, and never leaves the tier's range or passes `maxScale` (the GPU cap).
//
// Only animated frames count, and the windows run on animated time (the vsyncs those frames
// spanned), so a stretch drawn on demand is neither load nor headroom. The first frame of an
// animated run is marked `resumed`: its delta covers the idle time before it, not a frame's work.
import { tunables, type Tier } from '../config/tunables';
import { missedVsyncs, nearestRank } from './frameStats';

export interface GovernorFrame {
  /** Milliseconds on a monotonic clock. */
  now: number;
  /** Time since the previous frame of the same animated run. */
  deltaMs: number;
  intervalMs: number;
  /** GPU time of the frame from a timer query, or null without one. */
  gpuMs: number | null;
  /** A flight or gesture is running: scale changes wait (5.8). */
  moving: boolean;
  /** The first frame of an animated run, after drawing on demand or a hidden tab. */
  resumed?: boolean;
}

type Rules = typeof tunables.governor;

interface Sample {
  /** Animated milliseconds since the scale last changed, at the end of this frame. */
  at: number;
  missed: number;
  vsyncs: number;
  gpuMs: number | null;
}

interface Watch {
  /** The scale before the step up. */
  back: number;
  missed: number;
  vsyncs: number;
}

export class Governor {
  readonly #rules: Rules;
  readonly #timerQueries: boolean;
  readonly #min: number;
  readonly #max: number;
  readonly #step: number;
  #scale: number;
  /** Animated milliseconds since the scale last changed. */
  #animated = 0;
  /** The last `downWindowFrames` frames since the scale last changed. */
  #window: Sample[] = [];
  /** Frames since the scale last changed, within the longer up rule's span of animated time. */
  #recent: Sample[] = [];
  /** Misses counted since a step up, until `revertWindow` of animated time has passed. */
  #watch: Watch | null = null;
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

  /** Records a frame; returns the render scale to use from now on. */
  frame(input: GovernorFrame): number {
    if (input.resumed) return this.#scale;
    const rules = this.#rules;
    const interval = input.intervalMs;
    const missed = missedVsyncs(input.deltaMs, interval);
    const vsyncs = missed + 1;
    // Windows end within half a vsync of their length, so rounding in the sum never costs a frame.
    const reached = (span: number) => this.#animated >= span - interval / 2;
    const inWatch = !reached(rules.revertWindow);
    this.#animated += vsyncs * interval;
    const sample = { at: this.#animated, missed, vsyncs, gpuMs: input.gpuMs };
    this.#window.push(sample);
    if (this.#window.length > rules.downWindowFrames) this.#window.shift();
    this.#recent.push(sample);
    const keep = Math.max(rules.upAfter, rules.upProbe);
    while ((this.#recent[0]?.at ?? Infinity) < this.#animated - keep) this.#recent.shift();
    if (this.#watch && inWatch) {
      this.#watch.missed += missed;
      this.#watch.vsyncs += vsyncs;
    }

    if (input.moving) return this.#scale;

    // A step up goes back once its misses pass the share of the whole window's vsyncs, so an
    // early hitch (the resize itself) does not decide it; then step-ups rest for the backoff.
    if (this.#watch) {
      const { back, missed: misses, vsyncs: seen } = this.#watch;
      const budget = rules.revertMissFrac * Math.max(seen, rules.revertWindow / interval);
      if (misses > budget) {
        this.#noUpBefore = input.now + rules.backoff;
        return this.#set(back);
      }
      if (reached(rules.revertWindow)) this.#watch = null;
    }

    if (
      this.#window.length >= rules.downWindowFrames &&
      missFraction(this.#window) > rules.downMissFrac
    ) {
      return this.#set(this.#scale - this.#step);
    }

    if (input.now < this.#noUpBefore || this.#scale >= this.#max) return this.#scale;
    const since = (span: number) => this.#recent.filter((s) => s.at > this.#animated - span);
    let up: boolean;
    if (this.#timerQueries) {
      const gpu = since(rules.upAfter)
        .map((s) => s.gpuMs)
        .filter((ms): ms is number => ms !== null);
      up =
        reached(rules.upAfter) &&
        gpu.length > 0 &&
        nearestRank(gpu, 0.9) < rules.upGpuP90Frac * interval;
    } else {
      up = reached(rules.upProbe) && since(rules.upProbe).every((s) => s.missed === 0);
    }
    if (!up) return this.#scale;
    const back = this.#scale;
    this.#set(this.#scale + this.#step);
    this.#watch = { back, missed: 0, vsyncs: 0 };
    return this.#scale;
  }

  #set(scale: number): number {
    const next = clamp(scale, this.#min, this.#max);
    if (next !== this.#scale) {
      this.#scale = next;
      this.#animated = 0;
      this.#window = [];
      this.#recent = [];
      this.#watch = null;
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
