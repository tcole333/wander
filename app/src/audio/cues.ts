// The beats' cues (streaming.md 3.9: a beat's `audio: {cues: [...]}`), by name, on the cue bus.
// Each plays by its nature: rain, wind and ashfall are textures that hold for the beat; cannon-far
// is a few distant booms, spaced; rumble-far is low grumbles now and then; the eruption is one
// blast, then a roar that settles and sinks low. Textures loop noise of prime lengths behind
// swaying filters, as the bed does (bed.ts), and every event jitters its pitch, level and filters.
import type { SoundEngine } from './engine';
import { gainOf } from './mix';
import {
  grainSamples,
  jitter,
  jitterDb,
  lfo,
  loop,
  primeAtLeast,
  rand,
  releaseOnEnd,
  Sources,
  strike,
  toBuffer,
  type Grains,
} from './synth';

export interface CueHandle {
  setLevel(db: number, at?: number): void;
  stop(at?: number, fade?: number): void;
}

interface Cue {
  /** Seconds it takes to come in. */
  fadeIn: number;
  /** Builds the sound from `at` into `out`; what it starts goes into `sources`. */
  play(engine: SoundEngine, out: AudioNode, at: number, sources: Sources): void;
}

export const CUES = {
  'rumble-far': {
    fadeIn: 0,
    play(engine, out, at, sources) {
      every(engine, at + rand(0.2, 0.8), sources, (t) => {
        const length = grumble(engine, out, t);
        return t + length + rand(5, 14);
      });
    },
  },
  'cannon-far': {
    fadeIn: 0,
    play(engine, out, at, sources) {
      every(engine, at + rand(0.4, 1), sources, (t) => {
        boom(engine, out, t, 1);
        if (Math.random() > 0.3) return t + rand(10, 22);
        // Now and then a second report follows the first, as from a salvo.
        boom(engine, out, t + rand(1.1, 1.9), rand(0.45, 0.75));
        return t + rand(16, 28);
      });
    },
  },
  eruption: {
    fadeIn: 0,
    play(engine, out, at, sources) {
      blast(engine, out, at);
      const ctx = engine.ctx;
      // The roar: rising behind the blast as the column climbs, settling over some seconds, then
      // sinking lower through the next half minute, so the beat is not read inside a roar.
      const roar = new GainNode(ctx, { gain: 0 });
      const rise = at + rand(0.25, 0.45);
      roar.gain.setValueAtTime(0, rise);
      roar.gain.linearRampToValueAtTime(0.25, rise + 0.8);
      roar.gain.linearRampToValueAtTime(0.85, rise + 3);
      roar.gain.setTargetAtTime(0.4, rise + 3.5, 3.5);
      roar.gain.setTargetAtTime(0.15, rise + 12, 8);
      roar.connect(out);
      for (const [side, seconds, rate] of [
        [-1, 9.7, 0.0831],
        [1, 10.9, 0.0677],
      ] as const) {
        const dark = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 240 * jitter(0.1) });
        const swell = new GainNode(ctx, { gain: 0.75 });
        lfo(engine, dark.frequency, rate, 70, at, sources);
        lfo(engine, swell.gain, rate * 0.618, 0.2, at, sources);
        lfo(engine, swell.gain, rate * 1.581, 0.1, at, sources);
        loop(engine, engine.noise('brown', seconds), at, sources)
          .connect(dark)
          .connect(swell)
          .connect(new StereoPannerNode(ctx, { pan: side * 0.55 }))
          .connect(roar);
      }
      // Ash and stones in the roar: a gritty band that settles with it.
      const grit = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1300, Q: 0.8 });
      const gritGain = new GainNode(ctx, { gain: 0.3 });
      lfo(engine, gritGain.gain, 0.0529, 0.1, at, sources);
      grainLoop(engine, 7.9, { perSecond: 90, decay: [0.001, 0.006] }, at, sources)
        .connect(grit)
        .connect(gritGain)
        .connect(roar);
    },
  },
  ashfall: {
    fadeIn: 2.5,
    play(engine, out, at, sources) {
      const ctx = engine.ctx;
      // Ash sifting down: sparse dry grains, a few larger among them, a different loop in each
      // ear, drifting in and out, soft at the top so it settles rather than sizzles.
      for (const [side, seconds, rate] of [
        [-1, 5.3, 0.0709],
        [1, 6.7, 0.0547],
      ] as const) {
        const fine = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 2400 * jitter(0.1) });
        fine.Q.value = 0.7;
        const drift = new GainNode(ctx, { gain: 0.7 });
        lfo(engine, fine.frequency, rate, 600, at, sources);
        lfo(engine, drift.gain, rate * 1.707, 0.3, at, sources);
        grainLoop(engine, seconds, { perSecond: 260, decay: [0.0003, 0.0015] }, at, sources)
          .connect(new BiquadFilterNode(ctx, { type: 'highpass', frequency: 1500 }))
          .connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 6000 }))
          .connect(fine)
          .connect(drift)
          .connect(new StereoPannerNode(ctx, { pan: side * 0.6 }))
          .connect(out);
      }
      // Ash settling on leaves and thatch: a light, uneven patter.
      const patter = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1900, Q: 0.9 });
      grainLoop(
        engine,
        7.3,
        { perSecond: 45, decay: [0.001, 0.003], ring: [1200, 2600] },
        at,
        sources,
      )
        .connect(patter)
        .connect(new GainNode(ctx, { gain: 0.35 }))
        .connect(out);
      // A soft hush under the grains.
      const hush = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 2600, Q: 0.5 });
      loop(engine, engine.noise('pink', 4.9), at, sources)
        .connect(hush)
        .connect(new GainNode(ctx, { gain: 0.04 }))
        .connect(out);
    },
  },
  rain: {
    fadeIn: 2,
    play(engine, out, at, sources) {
      const ctx = engine.ctx;
      for (const [side, hiss, drops, rate] of [
        [-1, 6.3, 5.9, 0.0531],
        [1, 7.7, 6.9, 0.0413],
      ] as const) {
        const pan = new StereoPannerNode(ctx, { pan: side * 0.7 });
        pan.connect(out);
        // The downpour's hiss: bright, soft, swelling a little.
        const band = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 2300 * jitter(0.1) });
        band.Q.value = 0.35;
        const hissGain = new GainNode(ctx, { gain: 0.3 });
        lfo(engine, hissGain.gain, rate, 0.07, at, sources);
        loop(engine, engine.noise('pink', hiss), at, sources)
          .connect(band)
          .connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 7500 }))
          .connect(hissGain)
          .connect(pan);
        // Drops: many small ringing grains.
        grainLoop(
          engine,
          drops,
          { perSecond: 1400, decay: [0.0006, 0.002], ring: [2200, 5200] },
          at,
          sources,
        )
          .connect(new BiquadFilterNode(ctx, { type: 'highpass', frequency: 1200 }))
          .connect(new GainNode(ctx, { gain: 0.45 }))
          .connect(pan);
      }
      // Larger drops, nearer: fewer and lower.
      const plip = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1300 * jitter(0.1) });
      plip.Q.value = 0.8;
      grainLoop(
        engine,
        8.3,
        { perSecond: 16, decay: [0.002, 0.006], ring: [900, 1800] },
        at,
        sources,
      )
        .connect(plip)
        .connect(new GainNode(ctx, { gain: 0.3 }))
        .connect(out);
      // Water running off roofs and into the ground: a low wash.
      loop(engine, engine.noise('brown', 9.1), at, sources)
        .connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 380 * jitter(0.1) }))
        .connect(new GainNode(ctx, { gain: 0.28 }))
        .connect(out);
    },
  },
  'wind-cold': {
    fadeIn: 3,
    play(engine, out, at, sources) {
      const ctx = engine.ctx;
      /** Drives `param` from the gust: around `base`, by `depth` at the gust's full strength. */
      const ride = (gust: AudioNode, param: AudioParam, base: number, depth: number) => {
        param.value = base;
        gust.connect(new GainNode(ctx, { gain: depth })).connect(param);
      };
      // The wind: a band of noise in each ear, each with its own gusts, which blow it louder and
      // higher together, as wind rises in pitch when it strengthens.
      const gusts: AudioNode[] = [];
      for (const [side, seconds, rate] of [
        [-1, 7.1, 0.113],
        [1, 8.7, 0.0911],
      ] as const) {
        const gust = sources.add(new ConstantSourceNode(ctx, { offset: 0 }));
        lfo(engine, gust.offset, rate * jitter(0.1), 0.65, at, sources);
        lfo(engine, gust.offset, rate * 1.618 * jitter(0.1), 0.35, at, sources);
        gust.start(at);
        gusts.push(gust);
        const band = new BiquadFilterNode(ctx, { type: 'bandpass', Q: 1.8 });
        ride(gust, band.frequency, 560 * jitter(0.1), 230);
        const strength = new GainNode(ctx);
        ride(gust, strength.gain, 0.55, 0.42);
        loop(engine, engine.noise('pink', seconds), at, sources)
          .connect(band)
          .connect(strength)
          .connect(new StereoPannerNode(ctx, { pan: side * 0.6 }))
          .connect(out);
      }
      const [left = out, right = out] = gusts;
      // A thin whistle through the gaps: a narrow band high up, rising with the gusts.
      const whistle = new BiquadFilterNode(ctx, { type: 'bandpass', Q: 14 });
      ride(left, whistle.frequency, 1500 * jitter(0.1), 260);
      const whistleGain = new GainNode(ctx);
      ride(left, whistleGain.gain, 0.22, 0.2);
      loop(engine, engine.noise('white', 5.7), at, sources)
        .connect(whistle)
        .connect(whistleGain)
        .connect(out);
      // The wind's weight, low down, heaving with the other ear's gusts.
      const weight = new GainNode(ctx);
      ride(right, weight.gain, 0.35, 0.2);
      loop(engine, engine.noise('brown', 9.3), at, sources)
        .connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 140 }))
        .connect(weight)
        .connect(out);
    },
  },
} satisfies Record<string, Cue>;

export type CueName = keyof typeof CUES;

export const CUE_NAMES = Object.keys(CUES) as CueName[];

export function isCueName(name: string): name is CueName {
  return Object.hasOwn(CUES, name);
}

/** Starts the cue `name` at `at`, at its level in the engine's mix. */
export function startCue(engine: SoundEngine, name: CueName, at = engine.soon()): CueHandle {
  const cue: Cue = CUES[name];
  const ctx = engine.ctx;
  const sources = new Sources();
  const out = new GainNode(ctx, { gain: 0 });
  out.connect(engine.bus.cue);
  const level = gainOf(engine.mix.cues[name]);
  if (cue.fadeIn > 0) out.gain.setTargetAtTime(level, at, cue.fadeIn / 3);
  else out.gain.setValueAtTime(level, at);
  cue.play(engine, out, at, sources);
  // Changes take effect no earlier than `at`, where the cue's coming in would override them, and a
  // stop cancels the coming in, so a cue stopped before it sounds stays silent.
  return {
    setLevel(db, when = ctx.currentTime) {
      out.gain.setTargetAtTime(gainOf(db), Math.max(when, at), 0.05);
    },
    stop(when = ctx.currentTime, fade = 1.5) {
      const t = Math.max(when, at);
      out.gain.cancelScheduledValues(t);
      out.gain.setTargetAtTime(0, t, fade / 4);
      sources.stop(t + fade * 1.5);
    },
  };
}

/**
 * Events from `at` on: `next` sounds one at `t` and returns when the one after it falls. Events a
 * late pump has missed (a stalled page, a hidden tab's slowed timers) are skipped, not sounded all
 * at once, and a stop set ahead keeps those due before it.
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

/** A loop of sparse grains, about `seconds` long at a prime length in samples. */
function grainLoop(
  engine: SoundEngine,
  seconds: number,
  grains: Grains,
  at: number,
  sources: Sources,
): AudioNode {
  const rate = engine.ctx.sampleRate;
  const samples = grainSamples(rate, primeAtLeast(seconds * rate), grains);
  return loop(engine, toBuffer(engine.ctx, samples), at, sources);
}

/** Dark noise from a random point of a brown loop, for a one-shot. */
function darkNoise(engine: SoundEngine, at: number, length: number): AudioBufferSourceNode {
  const buffer = engine.noise('brown', 3.7);
  const noise = new AudioBufferSourceNode(engine.ctx, { buffer, loop: true });
  noise.start(at, rand(0, buffer.duration));
  noise.stop(at + length);
  return noise;
}

/** A low grumble, rolling over two or three swells; returns how long it lasts, s. */
function grumble(engine: SoundEngine, out: AudioNode, at: number): number {
  const ctx = engine.ctx;
  const length = rand(1.8, 4.5);
  const swells = 2 + Math.floor(rand(0, 2));
  const gain = new GainNode(ctx, { gain: 0 });
  const size = jitterDb(0, 3);
  gain.gain.setValueAtTime(0, at);
  let t = at;
  for (let k = 0; k < swells; k += 1) {
    t += (length / (swells + 1)) * jitter(0.35);
    gain.gain.linearRampToValueAtTime(size * rand(0.45, 1), t);
  }
  gain.gain.setTargetAtTime(0, t, length * 0.22);
  const noise = darkNoise(engine, at, t - at + length * 1.5);
  const low = new BiquadFilterNode(ctx, {
    type: 'lowpass',
    frequency: rand(70, 130),
    Q: rand(0.7, 1.4),
  });
  noise.connect(low).connect(gain).connect(out);
  // A trace of it higher up, where small speakers reach.
  const trace = new BiquadFilterNode(ctx, {
    type: 'bandpass',
    frequency: 190 * jitter(0.15),
    Q: 1.2,
  });
  const traceGain = new GainNode(ctx, { gain: 0.16 });
  noise.connect(trace).connect(traceGain).connect(gain);
  releaseOnEnd(noise, low, trace, traceGain, gain);
  return t - at + length * 0.4;
}

/** A distant report: a thump falling in pitch, dark noise closing as it travels, and its roll. */
function boom(engine: SoundEngine, out: AudioNode, at: number, level: number): void {
  const ctx = engine.ctx;
  const size = level * jitterDb(0, 2.5);
  const f0 = rand(46, 60);
  const thump = new OscillatorNode(ctx, { frequency: f0 });
  thump.frequency.setValueAtTime(f0, at);
  thump.frequency.exponentialRampToValueAtTime(f0 * 0.6, at + 0.3);
  const thumpGain = new GainNode(ctx, { gain: 0 });
  strike(thumpGain.gain, at, size * 0.9, 0.006, 0.3 * jitter(0.2));
  thump.connect(thumpGain).connect(out);
  thump.start(at);
  thump.stop(at + 2.5);
  releaseOnEnd(thump, thumpGain);

  for (const [delay, peak, from, attack, tau] of [
    [0, 1, rand(260, 380), 0.012, 0.7],
    [rand(0.35, 0.8), 0.45, rand(160, 240), 0.08, 1.3],
  ] as const) {
    const t = at + delay;
    const noise = darkNoise(engine, t, tau * 7);
    const dark = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: from, Q: 0.8 });
    dark.frequency.setValueAtTime(from, t);
    dark.frequency.exponentialRampToValueAtTime(from * 0.4, t + 1.4);
    const gain = new GainNode(ctx, { gain: 0 });
    strike(gain.gain, t, size * peak, attack, tau * jitter(0.2));
    noise.connect(dark).connect(gain).connect(out);
    releaseOnEnd(noise, dark, gain);
  }
}

/** The eruption's blast: a crack wide open and closing fast, a concussion, and a heavy body. */
function blast(engine: SoundEngine, out: AudioNode, at: number): void {
  const ctx = engine.ctx;
  const size = jitterDb(0, 1.5);
  const crack = new AudioBufferSourceNode(ctx, { buffer: engine.noise('white', 1) });
  const opening = 3200 * jitter(0.1);
  const open = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: opening });
  open.frequency.setValueAtTime(opening, at);
  open.frequency.exponentialRampToValueAtTime(opening * 0.12, at + 0.5);
  const crackGain = new GainNode(ctx, { gain: 0 });
  strike(crackGain.gain, at, size * 0.55, 0.002, 0.12 * jitter(0.2));
  crack.connect(open).connect(crackGain).connect(out);
  crack.start(at, rand(0, 0.2));
  crack.stop(at + 0.8);
  releaseOnEnd(crack, open, crackGain);

  const f0 = rand(38, 46);
  const drop = new OscillatorNode(ctx, { frequency: f0 });
  drop.frequency.setValueAtTime(f0, at);
  drop.frequency.exponentialRampToValueAtTime(f0 * 0.55, at + 1.2);
  const dropGain = new GainNode(ctx, { gain: 0 });
  strike(dropGain.gain, at, size, 0.004, 0.6 * jitter(0.15));
  drop.connect(dropGain).connect(out);
  drop.start(at);
  drop.stop(at + 5);
  releaseOnEnd(drop, dropGain);

  const body = darkNoise(engine, at, 8);
  const from = 900 * jitter(0.1);
  const closing = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: from, Q: 0.7 });
  closing.frequency.setValueAtTime(from, at);
  closing.frequency.exponentialRampToValueAtTime(from * 0.19, at + 2.5);
  const bodyGain = new GainNode(ctx, { gain: 0 });
  strike(bodyGain.gain, at, size, 0.01, 0.9 * jitter(0.15));
  body.connect(closing).connect(bodyGain).connect(out);
  releaseOnEnd(body, closing, bodyGain);
}
