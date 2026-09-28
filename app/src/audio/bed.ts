// The Tambora bed (PRD, Audio): quiet museum room tone, and under it a low volcanic rumble felt
// more than heard, its level a function of story time (rumbleLevel). Every layer is a noise loop
// of prime length in samples (so no two loops line up) behind live filters that slow LFOs sway at
// rates in irrational ratios: nothing repeats audibly and no loop has a seam.
import { tunables } from '../config/tunables';
import { dayFromIso } from '../story/dates';
import type { SoundEngine } from './engine';
import { gainOf, type Mix } from './mix';
import { jitter, lfo, loop, Sources } from './synth';

export interface Bed {
  /** Story time moved: the rumble glides to that day's level. */
  setDay(day: number, at?: number): void;
  setMix(mix: Mix, at?: number): void;
  /** Leaves only the museum's room tone, keeping the bed ready for another walk. */
  toRoom(at?: number): void;
  stop(at?: number, fade?: number): void;
}

/**
 * The rumble's level, 0 to 1, on a story day: it grows from 1812, when a cloud first hangs over
 * the summit, to the explosions of 5 April 1815, peaks at the eruption on 10-11 April, stays high
 * while the mountain erupts into July, and recedes through 1816-1817 to room tone alone.
 */
export function rumbleLevel(day: number): number {
  const first = RUMBLE[0];
  const last = RUMBLE[RUMBLE.length - 1];
  if (!first || !last || day <= first[0]) return first?.[1] ?? 0;
  if (day >= last[0]) return last[1];
  for (let k = 1; k < RUMBLE.length; k += 1) {
    const [d1, v1] = RUMBLE[k] ?? last;
    const [d0, v0] = RUMBLE[k - 1] ?? first;
    if (day > d1) continue;
    const t = (day - d0) / (d1 - d0);
    return v0 + (v1 - v0) * t * t * (3 - 2 * t);
  }
  return last[1];
}

const RUMBLE: [day: number, level: number][] = (
  [
    ['1812-01-01', 0],
    ['1815-03-01', 0.24],
    ['1815-04-05', 0.5],
    ['1815-04-10', 1],
    ['1815-04-12', 1],
    ['1815-04-20', 0.55],
    ['1815-07-15', 0.32],
    ['1816-07-01', 0.12],
    ['1817-12-31', 0],
  ] as const
).map(([iso, level]) => [dayFromIso(iso), level]);

/** The rumble's gain at `level` of its peak: steeper than linear, so a low level is felt, not heard. */
function rumbleGain(mix: Mix, level: number): number {
  return gainOf(mix.bed.rumble) * level ** 1.5;
}

/** The shared museum ambience, with no story rumble. */
export function museumBed(engine: SoundEngine, _day: number, at = engine.ctx.currentTime): Bed {
  return makeBed(engine, null, at);
}

export function tamboraBed(engine: SoundEngine, day: number, at = engine.ctx.currentTime): Bed {
  return makeBed(engine, day, at);
}

function makeBed(engine: SoundEngine, day: number | null, at: number): Bed {
  const ctx = engine.ctx;
  const sources = new Sources();
  const out = new GainNode(ctx, { gain: 0 });
  out.connect(engine.bus.bed);
  out.gain.setTargetAtTime(1, at, tunables.bedCrossfade / 3000);

  // The room: the hall's air, pink noise darkened, a different loop in each ear.
  const room = new GainNode(ctx, { gain: gainOf(engine.mix.bed.room) });
  room.connect(out);
  for (const [side, seconds, rate] of [
    [-1, 7.3, 0.0213],
    [1, 8.9, 0.0171],
  ] as const) {
    const low = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 45, Q: 0.5 });
    const dark = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 820 * jitter(0.06) });
    const pan = new StereoPannerNode(ctx, { pan: side * 0.75 });
    lfo(engine, dark.frequency, rate * jitter(0.1), 220, at, sources);
    loop(engine, engine.noise('pink', seconds, sources), at, sources)
      .connect(low)
      .connect(dark)
      .connect(pan)
      .connect(room);
  }
  // The ventilation's hush: a wide low band, swelling now and then.
  const hush = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 170, Q: 0.6 });
  const hushGain = new GainNode(ctx, { gain: 0.5 });
  lfo(engine, hush.frequency, 0.0129 * jitter(0.1), 45, at, sources);
  lfo(engine, hushGain.gain, 0.0093 * jitter(0.1), 0.14, at, sources);
  loop(engine, engine.noise('brown', 10.1, sources), at, sources)
    .connect(hush)
    .connect(hushGain)
    .connect(room);

  let rumble: GainNode | null = null;
  if (day !== null) {
    // The mountain: brown noise under 100 Hz, its color and weight drifting on slow cycles.
    rumble = new GainNode(ctx, { gain: rumbleGain(engine.mix, rumbleLevel(day)) });
    rumble.connect(out);
    const deep = loop(engine, engine.noise('brown', 11.3, sources), at, sources);
    const body = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 85, Q: 0.9 });
    const swell = new GainNode(ctx, { gain: 0.8 });
    lfo(engine, body.frequency, 0.0371 * jitter(0.1), 22, at, sources);
    lfo(engine, swell.gain, 0.0613 * jitter(0.1), 0.18, at, sources);
    lfo(engine, swell.gain, 0.0983 * jitter(0.1), 0.1, at, sources);
    deep.connect(body).connect(swell).connect(rumble);
    // Its floor: a second loop lower still.
    const floor = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 42, Q: 0.7 });
    loop(engine, engine.noise('brown', 12.7, sources), at, sources)
      .connect(floor)
      .connect(new GainNode(ctx, { gain: 0.9 }))
      .connect(rumble);
    // And a trace of it higher up, where small speakers reach.
    const trace = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 150, Q: 1.3 });
    const traceGain = new GainNode(ctx, { gain: 0.14 });
    lfo(engine, traceGain.gain, 0.0437 * jitter(0.1), 0.05, at, sources);
    deep.connect(trace).connect(traceGain).connect(rumble);
  }

  let current = day;
  return {
    setDay(next, when = ctx.currentTime) {
      current = next;
      rumble?.gain.setTargetAtTime(rumbleGain(engine.mix, rumbleLevel(next)), when, 0.4);
    },
    setMix(mix, when = ctx.currentTime) {
      room.gain.setTargetAtTime(gainOf(mix.bed.room), when, 0.05);
      rumble?.gain.setTargetAtTime(rumbleGain(mix, rumbleLevel(current ?? 0)), when, 0.05);
    },
    toRoom(when = ctx.currentTime) {
      rumble?.gain.setTargetAtTime(0, when, tunables.bedCrossfade / 3000);
    },
    stop(when = ctx.currentTime, fade = tunables.bedCrossfade / 1000) {
      out.gain.setTargetAtTime(0, when, fade / 4);
      sources.stop(when + fade * 1.5);
    },
  };
}
