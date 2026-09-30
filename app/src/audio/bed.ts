// Story beds over quiet museum room tone (PRD, Audio): Tambora's volcanic rumble follows story
// time; Magellan carries slow surf, loaded timbers and a little air through the rigging. Shared
// noise, drifting filters and irregular events keep their long stretches from repeating.
import { tunables } from '../config/tunables';
import { dayFromIso } from '../story/dates';
import type { SoundEngine } from './engine';
import { gainOf, type Mix } from './mix';
import {
  crossfadeLoop,
  every,
  jitter,
  jitterDb,
  lfo,
  loop,
  rand,
  releaseOnEnd,
  Sources,
} from './synth';

export interface Bed {
  /** Story time moved: restores the story from room tone, at that day's level. */
  setDay(day: number, at?: number): void;
  setMix(mix: Mix, at?: number): void;
  /** Leaves only the museum's room tone, keeping the bed ready for another walk. */
  toRoom(at?: number): void;
  stop(at?: number, fade?: number): void;
}

/** The voice of the museum's own bed, its room tone alone: Explore's, and a story's without one. */
export const MUSEUM = 'museum';

/** A bed a walk or Explore left playing room tone, and the voice that made it. */
export interface RoomBed {
  bed: Bed;
  voice: string;
}

/**
 * The bed for `voice` at a landing: the room's own, when the same voice made it, else a new one
 * from `make`, the room's fading out as it comes in.
 */
export function landBed(room: RoomBed | null, voice: string, make: () => Bed, at: number): Bed {
  if (room?.voice === voice) return room.bed;
  room?.bed.stop(at);
  return make();
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
export function museumBed(engine: SoundEngine, day: number, at = engine.ctx.currentTime): Bed {
  return makeBed(engine, 'museum', day, at);
}

export function tamboraBed(engine: SoundEngine, day: number, at = engine.ctx.currentTime): Bed {
  return makeBed(engine, 'tambora', day, at);
}

export function magellanBed(engine: SoundEngine, day: number, at = engine.ctx.currentTime): Bed {
  return makeBed(engine, 'magellan', day, at);
}

function makeBed(
  engine: SoundEngine,
  story: 'museum' | 'tambora' | 'magellan',
  day: number,
  at: number,
): Bed {
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
  if (story === 'tambora') {
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

  const sea = story === 'magellan' ? ocean(engine, out, at, sources) : null;
  let current = day;
  let inRoom = false;
  const storyLevel = (mix: Mix, when: number, glide: number) => {
    rumble?.gain.setTargetAtTime(inRoom ? 0 : rumbleGain(mix, rumbleLevel(current)), when, glide);
    if (sea) {
      for (const name of ['surf', 'timber', 'rigging'] as const) {
        sea[name].gain.setTargetAtTime(inRoom ? 0 : gainOf(mix.bed[name]), when, glide);
      }
    }
  };
  return {
    setDay(next, when = ctx.currentTime) {
      current = next;
      inRoom = false;
      storyLevel(engine.mix, when, 0.4);
    },
    setMix(mix, when = ctx.currentTime) {
      room.gain.setTargetAtTime(gainOf(mix.bed.room), when, 0.05);
      storyLevel(mix, when, 0.05);
    },
    toRoom(when = ctx.currentTime) {
      inRoom = true;
      storyLevel(engine.mix, when, tunables.bedCrossfade / 3000);
    },
    stop(when = ctx.currentTime, fade = tunables.bedCrossfade / 1000) {
      out.gain.setTargetAtTime(0, when, fade / 4);
      sources.stop(when + fade * 1.5);
    },
  };
}

/** Open water under the hull, with all decoded noise borrowed from the room. */
function ocean(engine: SoundEngine, out: AudioNode, at: number, sources: Sources) {
  const ctx = engine.ctx;
  const level = (name: 'surf' | 'timber' | 'rigging') => {
    const gain = new GainNode(ctx, { gain: gainOf(engine.mix.bed[name]) });
    gain.connect(out);
    return gain;
  };
  const surf = level('surf');
  const timber = level('timber');
  const rigging = level('rigging');

  // Long washes rise and darken in each ear, over a slower heave below the waterline.
  for (const [side, seconds, rate] of [
    [-1, 7.3, 0.0713],
    [1, 8.9, 0.0539],
  ] as const) {
    const band = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 460, Q: 0.55 });
    const swell = new GainNode(ctx, { gain: 0.48 });
    lfo(engine, band.frequency, rate * jitter(0.08), 240, at, sources);
    lfo(engine, swell.gain, rate, 0.28, at, sources);
    lfo(engine, swell.gain, rate * Math.SQRT2, 0.1, at, sources);
    crossfadeLoop(engine, engine.noise('pink', seconds, sources), at, sources)
      .connect(band)
      .connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 2400, Q: 0.5 }))
      .connect(swell)
      .connect(new StereoPannerNode(ctx, { pan: side * 0.55 }))
      .connect(surf);
  }
  const heave = new GainNode(ctx, { gain: 0.24 });
  lfo(engine, heave.gain, 0.0383, 0.12, at, sources);
  crossfadeLoop(engine, engine.noise('brown', 10.1, sources), at, sources)
    .connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 160, Q: 0.6 }))
    .connect(heave)
    .connect(surf);

  // Air in the rigging, a little higher and narrower than the sea, never a pitched whistle.
  const air = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1250, Q: 2.8 });
  const breath = new GainNode(ctx, { gain: 0.55 });
  lfo(engine, air.frequency, 0.0293, 330, at, sources);
  lfo(engine, breath.gain, 0.0431, 0.3, at, sources);
  crossfadeLoop(engine, engine.noise('pink', 8.9, sources), at, sources)
    .connect(air)
    .connect(breath)
    .connect(new StereoPannerNode(ctx, { pan: 0.2 }))
    .connect(rigging);

  const friction = engine.noise('pink', 7.3, sources);
  every(engine, at + rand(3.5, 7), sources, (t) => {
    const length = creak(engine, timber, friction, t, sources);
    return t + length + rand(8, 19);
  });
  return { surf, timber, rigging };
}

/** A timber takes load and slips: a low rasp through wood resonances, then a short settling. */
function creak(
  engine: SoundEngine,
  out: AudioNode,
  friction: AudioBuffer,
  at: number,
  sources: Sources,
): number {
  const ctx = engine.ctx;
  const length = rand(1.4, 3.2);
  const end = at + length;
  const gain = new GainNode(ctx, { gain: 0 });
  const size = jitterDb(0, 3);
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(size * 0.45, at + length * 0.2);
  gain.gain.linearRampToValueAtTime(size, at + length * 0.48);
  gain.gain.linearRampToValueAtTime(size * 0.3, at + length * 0.68);
  gain.gain.linearRampToValueAtTime(size * rand(0.35, 0.6), at + length * 0.77);
  gain.gain.linearRampToValueAtTime(0, end);
  const pan = new StereoPannerNode(ctx, { pan: rand(-0.45, 0.45) });
  gain.connect(pan).connect(out);

  const pitch = rand(58, 86);
  const rasp = sources.add(new OscillatorNode(ctx, { type: 'sawtooth', frequency: pitch }), end);
  rasp.frequency.setValueAtTime(pitch, at);
  rasp.frequency.exponentialRampToValueAtTime(pitch * rand(1.3, 1.7), at + length * 0.45);
  rasp.frequency.exponentialRampToValueAtTime(pitch * 0.8, end);
  const wood = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: rand(270, 420), Q: 2.4 });
  const dark = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 1100, Q: 0.5 });
  rasp.connect(wood).connect(dark).connect(gain);
  rasp.start(at);
  rasp.stop(end);
  releaseOnEnd(rasp, wood, dark, gain, pan);

  // A dry rub breaks up the tone, reading one short stretch of the room's noise without a loop.
  const rub = sources.add(new AudioBufferSourceNode(ctx, { buffer: friction }), end);
  const grain = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: rand(650, 950), Q: 0.9 });
  const grainGain = new GainNode(ctx, { gain: 0.18 });
  rub.connect(grain).connect(grainGain).connect(gain);
  rub.start(at, rand(0, friction.duration - length));
  rub.stop(end);
  releaseOnEnd(rub, grain, grainGain);
  return length;
}
