// Wander's sound (PRD, Audio; streaming.md 2, Audio): one AudioContext, created on the visitor's
// first gesture and resumed inside it, since browsers keep audio locked until then. Every sound
// plays into one of three buses (ui for the instrument's voices, bed for the story's ambient bed,
// cue for the beats' cues), and the buses into a master level and mute and a gentle limiter that
// only the eruption's blast reaches. The engine runs as well on an OfflineAudioContext, to render
// sounds to files.
import { tunables } from '../config/tunables';
import { gainOf, mix as defaultMix, type Mix } from './mix';
import { noiseSamples, primeAtLeast, toBuffer, type NoiseColor } from './synth';

export type Bus = 'ui' | 'bed' | 'cue';

/** Schedules a sound's events up to `horizon`, seconds on the audio clock. */
export type Pump = (horizon: number) => void;

/** How far ahead a live context schedules events, and how often it looks, seconds. */
const LOOKAHEAD = 0.6;
const PUMP_EVERY = 0.2;
/** Master level and mute changes glide over this time constant, seconds. */
const GLIDE = 0.05;

export class SoundEngine {
  readonly ctx: BaseAudioContext;
  readonly bus: Record<Bus, GainNode>;
  #mix: Mix;
  #muted = false;
  readonly #master: GainNode;
  readonly #pumps = new Set<Pump>();
  #timer: ReturnType<typeof setInterval> | undefined;
  readonly #noise = new Map<string, AudioBuffer>();

  constructor(ctx: BaseAudioContext, mix: Mix = defaultMix) {
    this.ctx = ctx;
    this.#mix = structuredClone(mix);
    // Threshold, knee and ratio set so it holds peaks near -1.5 dBFS and leaves the rest alone.
    const limiter = new DynamicsCompressorNode(ctx, {
      threshold: -4,
      knee: 2,
      ratio: 20,
      attack: 0.002,
      release: 0.25,
    });
    this.#master = new GainNode(ctx, { gain: gainOf(this.#mix.master) });
    this.#master.connect(limiter).connect(ctx.destination);
    const bus = (name: Bus) => {
      const node = new GainNode(ctx, { gain: gainOf(this.#mix.buses[name]) });
      node.connect(this.#master);
      return node;
    };
    this.bus = { ui: bus('ui'), bed: bus('bed'), cue: bus('cue') };
  }

  get mix(): Mix {
    return this.#mix;
  }

  get muted(): boolean {
    return this.#muted;
  }

  get offline(): boolean {
    return typeof OfflineAudioContext !== 'undefined' && this.ctx instanceof OfflineAudioContext;
  }

  /** When a sound asked for now can be placed exactly on the audio clock. */
  soon(): number {
    return this.ctx.currentTime + tunables.detents.scheduleAhead / 1000;
  }

  /**
   * Takes new levels: the master and buses glide to them now, and voices take theirs on their
   * next trigger. Beds and cues already playing take theirs through their own setMix.
   */
  setMix(mix: Mix): void {
    this.#mix = structuredClone(mix);
    this.#glideMaster();
    for (const name of ['ui', 'bed', 'cue'] as const) {
      this.bus[name].gain.setTargetAtTime(gainOf(mix.buses[name]), this.ctx.currentTime, GLIDE);
    }
  }

  setMuted(muted: boolean): void {
    this.#muted = muted;
    this.#glideMaster();
  }

  /**
   * Runs `pump` to schedule a sound's events ahead of the clock: a live context calls it a few
   * times a second with a horizon a moment ahead, an offline render once with its whole length.
   * Returns the function that stops it.
   */
  schedule(pump: Pump): () => void {
    if (this.offline) {
      pump((this.ctx as OfflineAudioContext).length / this.ctx.sampleRate);
      return () => {};
    }
    this.#pumps.add(pump);
    pump(this.ctx.currentTime + LOOKAHEAD);
    this.#timer ??= setInterval(() => {
      const horizon = this.ctx.currentTime + LOOKAHEAD;
      for (const each of this.#pumps) each(horizon);
    }, PUMP_EVERY * 1000);
    return () => {
      this.#pumps.delete(pump);
      if (this.#pumps.size > 0 || this.#timer === undefined) return;
      clearInterval(this.#timer);
      this.#timer = undefined;
    };
  }

  /**
   * Noise of `color`, about `seconds` long, at a prime length in samples: a loop that never lines
   * up with another. The same request returns the same buffer.
   */
  noise(color: NoiseColor, seconds: number): AudioBuffer {
    const length = primeAtLeast(seconds * this.ctx.sampleRate);
    const key = `${color} ${length}`;
    let buffer = this.#noise.get(key);
    if (!buffer) {
      buffer = toBuffer(this.ctx, noiseSamples(color, length));
      this.#noise.set(key, buffer);
    }
    return buffer;
  }

  #glideMaster(): void {
    const level = this.#muted ? 0 : gainOf(this.#mix.master);
    this.#master.gain.setTargetAtTime(level, this.ctx.currentTime, GLIDE);
  }
}

let live: SoundEngine | undefined;

/**
 * The live engine. Call it inside a click or key handler: the first call creates the AudioContext
 * and every call resumes it there and then, since a resume outside a gesture is refused.
 */
export function unlockSound(mix: Mix = defaultMix): SoundEngine {
  live ??= new SoundEngine(new AudioContext({ latencyHint: 'interactive' }), mix);
  const ctx = live.ctx as AudioContext;
  if (ctx.state !== 'running') void ctx.resume();
  return live;
}
