// Building blocks for the voices, the bed and the cues: noise that loops without a seam, slow
// LFOs, envelopes, and the jitter that makes every trigger a little different from the last.
import type { SoundEngine } from './engine';
import { tunables } from '../config/tunables';
import { gainOf } from './mix';

export type NoiseColor = 'white' | 'pink' | 'brown';

/** A random number in [lo, hi). */
export function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

/** A factor within `spread` of 1, for pitch and filter jitter. */
export function jitter(spread: number): number {
  return 1 + rand(-spread, spread);
}

/** A gain within `db` of `level` dB, for level jitter. */
export function jitterDb(level: number, db: number): number {
  return gainOf(level + rand(-db, db));
}

/** How many samples a stepped noise build works through between two of its steps (noiseSteps). */
export const NOISE_STEP = 1 << 15;

/**
 * Mono noise, `length` samples, at unit RMS. Colored noise is filtered around the buffer twice and
 * the first pass thrown away, so the filter's state at the end runs on into the start and the
 * buffer loops without a seam.
 */
export function noiseSamples(color: NoiseColor, length: number): Float32Array {
  const steps = noiseSteps(color, length);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/**
 * The same noise built in steps of NOISE_STEP samples, yielding after each, so the build can be
 * spread over moments the page is idle (SoundEngine.prepareNoise); it returns the samples.
 */
export function* noiseSteps(color: NoiseColor, length: number): Generator<void, Float32Array> {
  const white = new Float32Array(length);
  for (let from = 0; from < length; from += NOISE_STEP) {
    const to = Math.min(length, from + NOISE_STEP);
    for (let i = from; i < to; i += 1) white[i] = Math.random() * 2 - 1;
    yield;
  }
  if (color === 'white') return normalize(white);
  const out = new Float32Array(length);
  // Pink by Paul Kellet's refined filter; brown by a leaky integrator.
  let [b0, b1, b2, b3, b4, b5, b6] = [0, 0, 0, 0, 0, 0, 0];
  let brown = 0;
  for (let from = 0; from < 2 * length; from += NOISE_STEP) {
    const to = Math.min(2 * length, from + NOISE_STEP);
    for (let i = from; i < to; i += 1) {
      const w = white[i % length] ?? 0;
      let y: number;
      if (color === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        y = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
        b6 = w * 0.115926;
      } else {
        brown = (brown + 0.02 * w) / 1.02;
        y = brown;
      }
      if (i >= length) out[i - length] = y;
    }
    yield;
  }
  return normalize(out);
}

export interface Grains {
  /** Grains per second. */
  perSecond: number;
  /** Each grain's decay, seconds, drawn from this range. */
  decay: [number, number];
  /** A grain rings at a frequency from this range, Hz; without it a grain is a burst of noise. */
  ring?: [number, number];
}

/**
 * Sparse grains (drops, ash, grit) scattered at random through `length` samples, at unit peak.
 * A grain that runs past the end wraps round to the start, so the buffer loops without a seam.
 */
export function grainSamples(sampleRate: number, length: number, grains: Grains): Float32Array {
  const out = new Float32Array(length);
  const count = Math.round((grains.perSecond * length) / sampleRate);
  for (let g = 0; g < count; g += 1) {
    const at = Math.floor(Math.random() * length);
    // Mostly small grains and a few large ones.
    const amp = Math.random() ** 3 * (Math.random() < 0.5 ? -1 : 1);
    const tau = rand(grains.decay[0], grains.decay[1]) * sampleRate;
    const w = grains.ring ? (2 * Math.PI * rand(grains.ring[0], grains.ring[1])) / sampleRate : 0;
    const n = Math.ceil(tau * 6);
    for (let k = 0; k < n; k += 1) {
      const body = w > 0 ? Math.sin(w * k) : Math.random() * 2 - 1;
      const i = (at + k) % length;
      out[i] = (out[i] ?? 0) + amp * Math.exp(-k / tau) * body;
    }
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let i = 0; i < length; i += 1) out[i] = (out[i] ?? 0) / peak;
  return out;
}

/**
 * The smallest prime at or above `n`. Looping buffers take prime lengths in samples, so any two
 * layers' lengths are co-prime and their loops never line up again.
 */
export function primeAtLeast(n: number): number {
  const isPrime = (k: number) => {
    if (k < 2) return false;
    for (let d = 2; d * d <= k; d += 1) if (k % d === 0) return false;
    return true;
  };
  let k = Math.max(2, Math.ceil(n));
  while (!isPrime(k)) k += 1;
  return k;
}

export function toBuffer(ctx: BaseAudioContext, samples: Float32Array): AudioBuffer {
  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  return buffer;
}

/** The sources a long sound starts, and what else to undo, to stop them all at once. */
export class Sources {
  inspectMemory(account: import('../perf/memory').MemoryAccount): void {
    for (const node of this.#nodes.keys()) {
      if ('buffer' in node) {
        const buffer = (node as AudioBufferSourceNode).buffer;
        if (buffer) account.audio('audio.activeCueBuffers', buffer);
      }
    }
  }

  readonly #nodes = new Map<AudioScheduledSourceNode, number>();
  readonly #undo: ((at: number) => void)[] = [];
  readonly #release: (() => void)[] = [];
  #stopped = false;

  /** `end` is a one-shot's natural end; stopping the group must never lengthen it. */
  add<T extends AudioScheduledSourceNode>(node: T, end = Infinity): T {
    this.#nodes.set(node, end);
    node.addEventListener('ended', () => {
      node.disconnect();
      this.#nodes.delete(node);
      this.#releaseIfEnded();
    });
    return node;
  }

  /** `undo` runs when stop is called, given the time the sources stop at. */
  onStop(undo: (at: number) => void): void {
    this.#undo.push(undo);
  }

  /** Releases retained data after the last source has actually ended, including a stop's tail. */
  onEnded(release: () => void): void {
    this.#release.push(release);
    this.#releaseIfEnded();
  }

  stop(at: number): void {
    if (this.#stopped) return;
    this.#stopped = true;
    // A scheduler may finish placing events before this stop; include those in the stop too.
    for (const undo of this.#undo) undo(at);
    this.#undo.length = 0;
    for (const [node, end] of this.#nodes) node.stop(Math.min(at, end));
    this.#releaseIfEnded();
  }

  #releaseIfEnded(): void {
    if (!this.#stopped || this.#nodes.size > 0) return;
    for (const release of this.#release) release();
    this.#release.length = 0;
  }
}

/** `buffer` looping from `at`. */
export function loop(
  engine: SoundEngine,
  buffer: AudioBuffer,
  at: number,
  sources: Sources,
): AudioBufferSourceNode {
  const node = sources.add(new AudioBufferSourceNode(engine.ctx, { buffer, loop: true }));
  node.start(at);
  return node;
}

/**
 * Overlap successive reads of a shared buffer over `loopCrossfade`, with equal-power joins.
 * No copied or decoded samples: only sources and gain envelopes. Start partway into the first
 * read so two users of the same room/noise buffer don't sound in phase. Tambora keeps its
 * approved native loops; Magellan uses these joins for its more exposed surf and rigging.
 */
export function crossfadeLoop(
  engine: SoundEngine,
  buffer: AudioBuffer,
  at: number,
  sources: Sources,
): AudioNode {
  const out = new GainNode(engine.ctx);
  const fade = Math.min(tunables.loopCrossfade / 1000, buffer.duration / 4);
  const up = Float32Array.from({ length: 33 }, (_, i) => Math.sin((i / 32) * Math.PI * 0.5));
  const down = Float32Array.from(up).reverse();
  let next = at;
  let offset = rand(0, buffer.duration * 0.5);
  const pump = (horizon: number) => {
    // Hidden tabs and stalled frames skip missed reads, rather than bunching them on resuming.
    if (next < engine.ctx.currentTime) next = engine.soon();
    while (next < horizon) {
      const end = next + buffer.duration - offset;
      const node = sources.add(new AudioBufferSourceNode(engine.ctx, { buffer }), end);
      const gain = new GainNode(engine.ctx, { gain: 0 });
      gain.gain.setValueCurveAtTime(up, next, fade);
      gain.gain.setValueCurveAtTime(down, end - fade, fade);
      node.connect(gain).connect(out);
      node.start(next, offset);
      node.stop(end);
      releaseOnEnd(node, gain);
      next = end - fade;
      offset = 0;
    }
  };
  const unschedule = engine.schedule(pump);
  sources.onStop((end) => {
    unschedule();
    pump(end);
  });
  return out;
}

/**
 * Events from `at` on: `next` sounds one at `t` and returns when the one after it falls. A late
 * pump skips missed events; a stop set ahead keeps those due before it, then unschedules.
 */
export function every(
  engine: SoundEngine,
  at: number,
  sources: Sources,
  next: (t: number) => number,
): void {
  let t = at;
  const pump = (horizon: number) => {
    t = Math.max(t, engine.soon());
    while (t < horizon) t = next(t);
  };
  const unschedule = engine.schedule(pump);
  sources.onStop((end) => {
    unschedule();
    pump(end);
  });
}

/**
 * A slow sine swaying `param` by `depth` around its value, from a random phase. Beds and textures
 * give their LFOs rates in irrational ratios, so the cycles never fall back into step.
 */
export function lfo(
  engine: SoundEngine,
  param: AudioParam,
  rate: number,
  depth: number,
  at: number,
  sources: Sources,
): void {
  const ctx = engine.ctx;
  const phase = rand(0, 2 * Math.PI);
  const wave = ctx.createPeriodicWave([0, Math.sin(phase)], [0, Math.cos(phase)], {
    disableNormalization: true,
  });
  const osc = sources.add(new OscillatorNode(ctx, { frequency: rate }));
  osc.setPeriodicWave(wave);
  const amount = new GainNode(ctx, { gain: depth });
  osc.connect(amount).connect(param);
  osc.start(at);
}

/** A strike: up to `peak` over `attack` seconds, then an exponential decay with constant `tau`. */
export function strike(param: AudioParam, at: number, peak: number, attack: number, tau: number) {
  param.setValueAtTime(0, at);
  param.linearRampToValueAtTime(peak, at + attack);
  param.setTargetAtTime(0, at + attack, tau);
}

/** A one-shot's node chain is let go once its last source ends. */
export function releaseOnEnd(source: AudioScheduledSourceNode, ...nodes: AudioNode[]): void {
  source.addEventListener('ended', () => {
    for (const node of nodes) node.disconnect();
  });
}

function normalize(samples: Float32Array): Float32Array {
  let mean = 0;
  for (const v of samples) mean += v;
  mean /= samples.length;
  let power = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = (samples[i] ?? 0) - mean;
    samples[i] = v;
    power += v * v;
  }
  const rms = Math.sqrt(power / samples.length) || 1;
  for (let i = 0; i < samples.length; i += 1) samples[i] = (samples[i] ?? 0) / rms;
  return samples;
}
