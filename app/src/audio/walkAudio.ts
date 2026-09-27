// The walk's sound (PRD, Audio; issue #12), with the approved engine and mix: a clunk on each beat
// change; the whir while the camera flies, to a beat or to a Meanwhile entry, its pace following
// the camera's; a detent for each day, month and year the ruler's playhead passes, of the marks
// the ruler engraves at that moment (marks.ts); the story's bed following story time; and each
// beat's cues from landing on it until the walk leaves it, when they fade over bedCrossfade.
//
// WalkScore plays all of it on any engine, live or offline (the Sound Cabinet renders a stretch of
// the walk with it). createWalkAudio attaches it to a page: nothing sounds before the visitor's
// first gesture, which unlocks the AudioContext in its own handler (or a lobby's click has already
// unlocked it); the mute knob and the M key mute it, remembered in this browser; and a hidden tab
// fades out over hideRamp and suspends, then resumes and fades in over showFade (streaming.md 5.9).
import { tunables } from '../config/tunables';
import { flightPath } from '../story/flight';
import type { Precision } from '../story/dates';
import type { SoundSwitch, WalkState } from '../story/contract';
import { isFormField } from '../view/viewControl';
import type { ViewState } from '../view/viewState';
import { tamboraBed, type Bed } from './bed';
import { isCueName, startCue, type CueHandle } from './cues';
import { unlockedSound, unlockSound, type SoundEngine } from './engine';
import { marksPassed } from './marks';
import { clunk, Detents, whir, type Whir } from './voices';

/** Each story's bed, by story id. */
const BEDS: Record<string, (engine: SoundEngine, day: number, at: number) => Bed> = {
  tambora: tamboraBed,
};

/** The least time between two clunks, s: rapid steps sound once, not in a stammer. */
const CLUNK_GAP = 0.15;
/**
 * The camera's speed at full pace, in flight path length (flight.ts) per second: a flight's
 * usual peak, as its ease (smootherstep, at most 1.875 times its mean) takes a path at 0.8 a
 * second.
 */
const FULL_PACE = 1.5;
/** The least change in pace worth passing to the whir. */
const PACE_STEP = 0.02;
/** The bed's day is passed at most this often, s. */
const BED_EVERY_S = 0.1;

/** Where the mute is remembered. */
const MUTED_KEY = 'wander.muted';
/** The gestures that can unlock sound; a touch counts once it ends. */
const GESTURES = ['pointerdown', 'keydown', 'pointerup', 'touchend'] as const;

/** One frame of the walk, as its sound hears it. */
export interface WalkFrame {
  state: WalkState;
  /** The finest unit the time ruler engraves now. */
  unit: Precision;
  /** The camera's pace, 0 (still) to 1 (a flight's usual peak). */
  pace: number;
  /** When the frame sounds on the audio clock, and the seconds since the last frame. */
  at: number;
  dt: number;
}

/** The camera's pace from one drawn view to the next `dt` seconds later, 0 to 1. */
export function paceOf(from: ViewState, to: ViewState, dt: number): number {
  if (dt <= 0 || !Number.isFinite(from.viewKm) || !Number.isFinite(to.viewKm)) return 0;
  return Math.min(1, flightPath(from, to).length / dt / FULL_PACE);
}

/** The walk's sound on an engine, from `from` (the walk as it stood when the sound began). */
export class WalkScore {
  readonly #engine: SoundEngine;
  readonly #detents: Detents;
  readonly #bed: Bed | null;
  #beat: number;
  #day: number;
  /**
   * Whether the walk stands on its beat, where the beat's cues play: a beat's flight leaves it,
   * and landing, not breaking out of the flight, arrives.
   */
  #onBeat: boolean;
  /** The beat whose cues play, once landed on, and the cues. */
  #cueBeat: number | null = null;
  #cues: CueHandle[] = [];
  #whir: Whir | null = null;
  #pace = 0;
  #bedDay: number;
  #bedAt = -Infinity;
  #clunkAt = -Infinity;

  constructor(engine: SoundEngine, from: WalkState, at: number) {
    this.#engine = engine;
    this.#detents = new Detents(engine);
    this.#beat = from.beat;
    this.#day = from.day;
    this.#bedDay = from.day;
    this.#onBeat = landed(from);
    this.#bed = BEDS[from.story.id]?.(engine, from.day, at) ?? null;
  }

  frame({ state, unit, pace, at, dt }: WalkFrame): void {
    const engine = this.#engine;
    if (state.beat !== this.#beat) {
      this.#beat = state.beat;
      if (at - this.#clunkAt >= CLUNK_GAP) {
        clunk(engine, at);
        this.#clunkAt = at;
      }
    }

    if (state.flight !== null) this.#onBeat = false;
    else if (landed(state)) this.#onBeat = true;

    // The beat left: its cues fade. Standing on one: its cues start.
    if (this.#cueBeat !== null && this.#cueBeat !== state.beat) {
      for (const cue of this.#cues) cue.stop(at, tunables.bedCrossfade / 1000);
      this.#cues = [];
      this.#cueBeat = null;
    }
    if (this.#cueBeat === null && this.#onBeat) {
      this.#cueBeat = state.beat;
      const names = state.story.beats[state.beat]?.audioCues ?? [];
      this.#cues = names.filter(isCueName).map((name) => startCue(engine, name, at));
    }

    // The marks the playhead passed since the last frame, spread over that frame's time, though
    // never before the clock (a long first frame on a fresh context would reach back past 0).
    const from = this.#day;
    const to = state.day;
    if (to !== from) {
      for (const mark of marksPassed(from, to, unit)) {
        const passed = at - dt + (dt * (mark.day - from)) / (to - from);
        this.#detents.play(mark.weight, Math.max(engine.ctx.currentTime, passed));
      }
      this.#day = to;
    }

    if (state.flying) {
      this.#whir ??= whir(engine, at);
      if (Math.abs(pace - this.#pace) >= PACE_STEP) {
        this.#whir.setPace(pace, at);
        this.#pace = pace;
      }
    } else if (this.#whir) {
      this.#whir.stop(at);
      this.#whir = null;
      this.#pace = 0;
    }

    if (this.#bed && to !== this.#bedDay && at - this.#bedAt >= BED_EVERY_S) {
      this.#bed.setDay(to, at);
      [this.#bedDay, this.#bedAt] = [to, at];
    }
  }

  /** Fades everything the walk has playing. */
  stop(at: number): void {
    this.#bed?.stop(at);
    for (const cue of this.#cues) cue.stop(at, tunables.bedCrossfade / 1000);
    this.#whir?.stop(at);
  }
}

/** Whether the walk has landed on its beat: no flight under way, nor broken out. */
function landed(state: WalkState): boolean {
  return state.flight === null && !state.flying && state.mode !== 'breakout';
}

/** The walk's sound in the page, and its mute switch. */
export interface WalkAudio extends SoundSwitch {
  /** Every frame, after the UI's: the walk's state, the ruler's unit and the drawn view. */
  update(state: WalkState, unit: Precision, view: ViewState, dtS: number): void;
  dispose(): void;
}

export function createWalkAudio(): WalkAudio {
  let muted = readMuted();
  let engine = unlockedSound() ?? null;
  engine?.setMuted(muted);
  let score: WalkScore | null = null;
  /** The walk as the last frame left it, and as it stood before the gesture that unlocked sound. */
  let last: WalkState | null = null;
  let lastView: ViewState | null = null;
  let unlockedFrom: WalkState | null = null;
  let suspending: ReturnType<typeof setTimeout> | undefined;
  const listeners = new AbortController();
  const gestures = new AbortController();
  const { signal } = listeners;

  // Heard while capturing, so a control that keeps its gesture to itself still unlocks sound; the
  // walk as it stood before the gesture is kept, so the step a key takes sounds its clunk.
  const unlock = () => {
    // A touch's start is not yet a gesture the browser unlocks sound for; its end is.
    if (navigator.userActivation?.isActive === false) return;
    const sound = unlockSound();
    if (engine !== sound) {
      sound.setMuted(muted);
      unlockedFrom = last;
    }
    engine = sound;
    if (sound.ctx.state === 'running') gestures.abort();
  };
  for (const type of GESTURES) {
    addEventListener(type, unlock, { capture: true, signal: gestures.signal });
  }

  const toggle = () => {
    muted = !muted;
    engine?.setMuted(muted);
    writeMuted(muted);
  };
  addEventListener(
    'keydown',
    (event) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isFormField(event.target) || event.key.toLowerCase() !== 'm') return;
      toggle();
      event.preventDefault();
    },
    { signal },
  );

  document.addEventListener(
    'visibilitychange',
    () => {
      if (!engine) return;
      const sound = engine;
      const ctx = sound.ctx as AudioContext;
      clearTimeout(suspending);
      if (document.hidden) {
        sound.fade(false, tunables.hideRamp / 1000);
        suspending = setTimeout(() => void ctx.suspend(), tunables.hideRamp);
      } else {
        void ctx.resume().then(() => {
          if (!document.hidden) sound.fade(true, tunables.showFade / 1000);
        });
      }
    },
    { signal },
  );

  return {
    get muted() {
      return muted;
    },
    toggle,
    update(state, unit, view, dtS) {
      if (engine && engine.ctx.state === 'running') {
        const at = engine.soon();
        score ??= new WalkScore(engine, unlockedFrom ?? last ?? state, at);
        const pace = lastView ? paceOf(lastView, view, dtS) : 0;
        score.frame({ state, unit, pace, at, dt: dtS });
      }
      last = state;
      lastView = { ...view };
    },
    dispose() {
      listeners.abort();
      gestures.abort();
      clearTimeout(suspending);
      if (engine && score) score.stop(engine.soon());
      score = null;
    },
  };
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTED_KEY, muted ? '1' : '0');
  } catch {
    // Storage refused (a private window, say): the mute holds for this visit only.
  }
}
