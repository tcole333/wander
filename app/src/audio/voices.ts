// The instrument's own voices (PRD, Audio): a brass gear detent as the time ruler passes a day, a
// month or a year, a felt-damped clunk on a beat change, and a soft clockwork whir through a
// camera flight. Small and close, on the ui bus, under the picture. Every trigger jitters its
// pitch, level and filters, so no two detents are the same sound.
import { tunables } from '../config/tunables';
import type { SoundEngine } from './engine';
import { gainOf } from './mix';
import { jitter, jitterDb, lfo, loop, rand, releaseOnEnd, Sources, strike } from './synth';

export type DetentWeight = 'day' | 'month' | 'year';

interface DetentShape {
  /** The pawl's click: the band it sounds in, Hz, and its decay, s. */
  click: number;
  clickDecay: number;
  /** The brass ringing on after it: its lowest partial, Hz, its decay, s, and its level. */
  ring: number;
  ringDecay: number;
  ringLevel: number;
  /** The wheel's body, a low knock: Hz (0 for none), decay, s, and level. */
  body: number;
  bodyDecay: number;
  bodyLevel: number;
  /** A softer second click as the pawl seats, s after the first (0 for none). */
  seat: number;
}

const DETENTS: Record<DetentWeight, DetentShape> = {
  day: {
    click: 5600,
    clickDecay: 0.0006,
    ring: 3350,
    ringDecay: 0.01,
    ringLevel: 0.1,
    body: 0,
    bodyDecay: 0,
    bodyLevel: 0,
    seat: 0,
  },
  month: {
    click: 4200,
    clickDecay: 0.001,
    ring: 2380,
    ringDecay: 0.02,
    ringLevel: 0.14,
    body: 540,
    bodyDecay: 0.012,
    bodyLevel: 0.22,
    seat: 0,
  },
  year: {
    click: 3100,
    clickDecay: 0.0015,
    ring: 1690,
    ringDecay: 0.038,
    ringLevel: 0.18,
    body: 310,
    bodyDecay: 0.02,
    bodyLevel: 0.4,
    seat: 0.022,
  },
};

/** A brass pawl's partials: small bars and plates ring at inharmonic ratios. */
const RING_PARTIALS = [
  { ratio: 1, level: 1, decay: 1 },
  { ratio: 2.76, level: 0.45, decay: 0.55 },
  { ratio: 5.4, level: 0.2, decay: 0.3 },
];

const WEIGHT_RANK: Record<DetentWeight, number> = { day: 0, month: 1, year: 2 };

/** One detent at `at`. */
export function detent(engine: SoundEngine, weight: DetentWeight, at = engine.soon()): void {
  const ctx = engine.ctx;
  const shape = DETENTS[weight];
  const level = {
    day: engine.mix.voices.detentDay,
    month: engine.mix.voices.detentMonth,
    year: engine.mix.voices.detentYear,
  }[weight];
  const pitch = jitter(0.045);
  const out = new GainNode(ctx, { gain: jitterDb(level, 1.5) });
  const pan = new StereoPannerNode(ctx, { pan: rand(-0.12, 0.12) });
  out.connect(pan).connect(engine.bus.ui);

  click(engine, out, at, shape.click * pitch * jitter(0.08), shape.clickDecay * jitter(0.2), 1);
  if (shape.seat > 0) {
    const seatAt = at + shape.seat * jitter(0.25);
    click(engine, out, seatAt, shape.click * 0.82 * pitch, shape.clickDecay * 0.8, 0.4);
  }
  for (const partial of RING_PARTIALS) {
    const f = shape.ring * partial.ratio * pitch * jitter(0.012);
    tone(engine, out, at, f, shape.ringLevel * partial.level, shape.ringDecay * partial.decay);
  }
  if (shape.body > 0) {
    tone(engine, out, at, shape.body * pitch, shape.bodyLevel, shape.bodyDecay * jitter(0.15));
  }
}

/**
 * Detents as the ruler passes its marks, at most `detents.maxPerSecond`: one that comes too soon
 * after the last is dropped, unless it is heavier, when it waits its turn.
 */
export class Detents {
  readonly #engine: SoundEngine;
  #last = -Infinity;
  #lastWeight: DetentWeight = 'day';

  constructor(engine: SoundEngine) {
    this.#engine = engine;
  }

  play(weight: DetentWeight, at = this.#engine.soon()): void {
    const gap = 1 / tunables.detents.maxPerSecond;
    if (at - this.#last < gap) {
      if (WEIGHT_RANK[weight] <= WEIGHT_RANK[this.#lastWeight]) return;
      at = this.#last + gap;
    }
    this.#last = at;
    this.#lastWeight = weight;
    detent(this.#engine, weight, at);
  }
}

/** A felt-damped clunk: a latch, a low thump that drops in pitch, and felt swallowing the rest. */
export function clunk(engine: SoundEngine, at = engine.soon()): void {
  const ctx = engine.ctx;
  const pitch = jitter(0.05);
  const out = new GainNode(ctx, { gain: jitterDb(engine.mix.voices.clunk, 1.5) });
  const pan = new StereoPannerNode(ctx, { pan: rand(-0.08, 0.08) });
  out.connect(pan).connect(engine.bus.ui);

  // The latch: a faint brass tick just before the blow.
  click(engine, out, at, 2300 * pitch * jitter(0.1), 0.0012, 0.18);
  const hit = at + 0.007 * jitter(0.3);
  // The blow: a low sine falling as the felt takes it.
  const thump = new OscillatorNode(ctx, { frequency: 118 * pitch });
  thump.frequency.setValueAtTime(118 * pitch, hit);
  thump.frequency.exponentialRampToValueAtTime(62 * pitch, hit + 0.08);
  const thumpGain = new GainNode(ctx, { gain: 0 });
  strike(thumpGain.gain, hit, 1, 0.003, 0.045 * jitter(0.15));
  thump.connect(thumpGain).connect(out);
  thump.start(hit);
  thump.stop(hit + 0.4);
  releaseOnEnd(thump, thumpGain);
  // The wood of the case, knocked once.
  tone(engine, out, hit, 205 * pitch * jitter(0.03), 0.28, 0.032 * jitter(0.15));
  // The felt: dark noise, gone almost at once.
  const felt = new AudioBufferSourceNode(ctx, { buffer: engine.noise('brown', 1) });
  const dark = new BiquadFilterNode(ctx, {
    type: 'lowpass',
    frequency: 640 * jitter(0.12),
    Q: 0.7,
  });
  const feltGain = new GainNode(ctx, { gain: 0 });
  strike(feltGain.gain, hit, 0.55, 0.002, 0.03 * jitter(0.2));
  felt.connect(dark).connect(feltGain).connect(out);
  felt.start(hit, rand(0, 0.7));
  felt.stop(hit + 0.3);
  releaseOnEnd(felt, dark, feltGain);
}

export interface Whir {
  /** The flight's pace, 0 (still) to 1 (fastest), gliding there from `at` at the mix's level. */
  setPace(pace: number, at?: number): void;
  stop(at?: number): void;
}

/**
 * A soft clockwork whir, silent until it is given a pace: an escapement's teeth ticking faster as
 * the pace rises, the air of its fly, and a faint tone of the gears in mesh.
 */
export function whir(engine: SoundEngine, at = engine.soon()): Whir {
  const ctx = engine.ctx;
  const sources = new Sources();
  const out = new GainNode(ctx, { gain: 0 });
  out.connect(engine.bus.ui);
  const pitch = jitter(0.05);

  // The teeth: a sine through a shaper that keeps only its crests is a train of soft pulses, and
  // the pulses open a gate on a band of noise.
  const teeth = sources.add(new OscillatorNode(ctx, { frequency: 14 * pitch }));
  const crests = new WaveShaperNode(ctx, { curve: crestCurve(5) });
  const gate = new GainNode(ctx, { gain: 0 });
  teeth.connect(crests).connect(gate.gain);
  teeth.start(at);
  const tick = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 2600 * pitch, Q: 2.6 });
  loop(engine, engine.noise('white', 1.3), at, sources).connect(tick).connect(gate);
  gate.connect(new GainNode(ctx, { gain: 0.9 })).connect(out);

  // The fly: a soft band of moving air.
  const air = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 700 * pitch, Q: 1.1 });
  const airGain = new GainNode(ctx, { gain: 0.3 });
  loop(engine, engine.noise('pink', 1.7), at, sources).connect(air).connect(airGain).connect(out);
  lfo(engine, airGain.gain, 0.37, 0.06, at, sources);

  // The mesh: a faint tone at a multiple of the teeth's rate.
  const mesh = sources.add(new OscillatorNode(ctx, { type: 'triangle', frequency: 84 * pitch }));
  const meshDark = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 900, Q: 0.5 });
  mesh
    .connect(meshDark)
    .connect(new GainNode(ctx, { gain: 0.035 }))
    .connect(out);
  mesh.start(at);

  const size = jitter(0.1);
  return {
    setPace(pace, when = engine.soon()) {
      const level = gainOf(engine.mix.voices.whir) * size;
      const p = Math.min(1, Math.max(0, pace));
      const glide = 0.12;
      const rate = (14 + 38 * p) * pitch;
      teeth.frequency.setTargetAtTime(rate, when, glide);
      mesh.frequency.setTargetAtTime(rate * 6, when, glide);
      tick.frequency.setTargetAtTime((2300 + 1500 * p) * pitch, when, glide);
      air.frequency.setTargetAtTime((520 + 900 * p) * pitch, when, glide);
      out.gain.setTargetAtTime(level * p ** 1.3, when, glide * 0.7);
    },
    stop(when = engine.soon()) {
      out.gain.setTargetAtTime(0, when, 0.06);
      sources.stop(when + 0.5);
    },
  };
}

/** A click: a burst of white noise in a band, decaying at once. */
function click(
  engine: SoundEngine,
  out: AudioNode,
  at: number,
  band: number,
  decay: number,
  level: number,
): void {
  const ctx = engine.ctx;
  const noise = new AudioBufferSourceNode(ctx, { buffer: engine.noise('white', 1) });
  const filter = new BiquadFilterNode(ctx, {
    type: 'bandpass',
    frequency: band,
    Q: 1.6 * jitter(0.2),
  });
  const gain = new GainNode(ctx, { gain: 0 });
  gain.gain.setValueAtTime(level * 2.2, at);
  gain.gain.setTargetAtTime(0, at, decay);
  noise.connect(filter).connect(gain).connect(out);
  noise.start(at, rand(0, 0.9));
  noise.stop(at + decay * 12 + 0.005);
  releaseOnEnd(noise, filter, gain);
}

/** A sine struck and left to ring down. */
function tone(
  engine: SoundEngine,
  out: AudioNode,
  at: number,
  frequency: number,
  level: number,
  decay: number,
): void {
  const ctx = engine.ctx;
  const osc = new OscillatorNode(ctx, { frequency });
  const gain = new GainNode(ctx, { gain: 0 });
  strike(gain.gain, at, level, 0.0006, decay);
  osc.connect(gain).connect(out);
  osc.start(at);
  osc.stop(at + decay * 9 + 0.01);
  releaseOnEnd(osc, gain);
}

/** A shaper curve that keeps a sine's crests, sharpened by `power`, and drops its troughs. */
function crestCurve(power: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i += 1) curve[i] = Math.max(0, (2 * i) / (n - 1) - 1) ** power;
  return curve;
}
