// The walk's sound (PRD, Audio; issue #12), with the approved engine and mix: a clunk on each beat
// change; the whir while the camera flies, to a beat or to a Meanwhile entry, its pace following
// the camera's; a detent for each day, month and year the ruler's playhead passes, of the marks
// the ruler engraves at that moment (marks.ts); the story's bed following story time, from when
// no flight to a beat is under way (the landing, when the walk flies in from the lobby); and each
// beat's cues from landing on it until the walk leaves it, when they fade over bedCrossfade. While
// a Meanwhile entry has the camera, far from the beat's place, its cues fall back.
//
// WalkScore plays all of it on any engine, live or offline (the Sound Cabinet renders a stretch of
// the walk with it). createWalkAudio belongs to the page, and plays Explore's sound too
// (clockScore.ts): the lobby's plaque unlocks the context in its click; a dev walk arms
// first-gesture unlocks. The knob and M share one remembered setting even before a story starts.
// Returning fades cues and rumble to the room, whose tone plays on in the lobby; once the return
// lands, the engine forgets the noise no sound still plays. The next landing reuses that bed for
// the same voice or crossfades to the new one's. A hidden tab fades out over hideRamp and
// suspends, then resumes and fades in over showFade (streaming.md 5.9).
import { tunables } from '../config/tunables';
import { flightPath } from '../story/flight';
import type { Precision } from '../story/dates';
import type { SoundSwitch, WalkState } from '../story/contract';
import { isFormField } from '../view/viewControl';
import type { ViewState } from '../view/viewState';
import type { ModeAudio } from '../walk/mode';
import { landBed, magellanBed, MUSEUM, museumBed, tamboraBed, type Bed, type RoomBed } from './bed';
import { ClockScore } from './clockScore';
import { isCueName, startCue, type CueHandle, type CueName } from './cues';
import { unlockedSound, unlockSound, type SoundEngine } from './engine';
import { marksPassed } from './marks';
import { clunk, Detents, FlightWhir, whir, type Whir } from './voices';

/** Each story's bed, by story id. */
const BEDS: Record<string, (engine: SoundEngine, day: number, at: number) => Bed> = {
  tambora: tamboraBed,
  magellan: magellanBed,
};

/** The least time between two clunks, s: rapid steps sound once, not in a stammer. */
const CLUNK_GAP = 0.15;
/**
 * The camera's speed at full pace, in flight path length (flight.ts) per second: a flight's
 * usual peak, as its ease (smootherstep, at most 1.875 times its mean) takes a path at 0.8 a
 * second.
 */
const FULL_PACE = 1.5;
/** The bed's day is passed at most this often, s. */
const BED_EVERY_S = 0.1;
/** How far a beat's cues fall back while a Meanwhile entry has the camera, dB. */
const AWAY_DB = -12;

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
  inspectMemory(account: import('../perf/memory').MemoryAccount): void {
    for (const [, cue] of this.#cues) cue.inspectMemory?.(account);
  }

  readonly #engine: SoundEngine;
  readonly #detents: Detents;
  /**
   * The story's bed, or museum room tone when it has none. It comes in once no flight to a beat is
   * under way: at once for a walk that starts on its beat, at the landing (or the visitor's breakout) for
   * one that flies in from the lobby, whose whir carries the dive. Undefined until then.
   */
  #bed: Bed | null | undefined;
  /** The room left by an earlier walk or Explore, reused once this walk lands. */
  #room: RoomBed | null;
  #voice = MUSEUM;
  #beat: number;
  #day: number;
  /**
   * Whether the walk stands on its beat, where the beat's cues play: a beat's flight leaves it,
   * and landing, not breaking out of the flight, arrives.
   */
  #onBeat: boolean;
  /** Whether a Meanwhile entry has taken the camera from the beat since the walk last landed. */
  #away = false;
  /** The beat whose cues play, once landed on, and the cues by name. */
  #cueBeat: number | null = null;
  #cues: [CueName, CueHandle][] = [];
  readonly #whir: FlightWhir;
  #bedDay: number;
  #bedAt = -Infinity;
  #clunkAt = -Infinity;

  constructor(engine: SoundEngine, from: WalkState, at: number, room: RoomBed | null = null) {
    this.#engine = engine;
    this.#room = room;
    this.#detents = new Detents(engine);
    this.#whir = new FlightWhir(engine);
    this.#beat = from.beat;
    this.#day = from.day;
    this.#bedDay = from.day;
    this.#onBeat = landed(from);
    if (from.flight === null) this.#startBed(from, at);
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

    const home = landed(state);
    if (state.flight !== null) this.#onBeat = false;
    else if (home) this.#onBeat = true;
    const away = !home && (this.#away || (state.flying && state.flight === null));

    // The beat left: its cues fade. Standing on one: its cues start, and fall back while away.
    if (this.#cueBeat !== null && this.#cueBeat !== state.beat) {
      for (const [, cue] of this.#cues) cue.stop(at, tunables.bedCrossfade / 1000);
      this.#cues = [];
      this.#cueBeat = null;
    }
    if (away !== this.#away) {
      this.#away = away;
      for (const [name, cue] of this.#cues) {
        cue.setLevel(engine.mix.cues[name] + (away ? AWAY_DB : 0), at);
      }
    }
    if (this.#cueBeat === null && this.#onBeat && !away) {
      this.#cueBeat = state.beat;
      const names = state.story.beats[state.beat]?.audioCues ?? [];
      this.#cues = names.filter(isCueName).map((name) => [name, startCue(engine, name, at)]);
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

    this.#whir.frame(state.flying, pace, at);

    if (this.#bed === undefined && state.flight === null) this.#startBed(state, at);
    else if (this.#bed && to !== this.#bedDay && at - this.#bedAt >= BED_EVERY_S) {
      this.#bed.setDay(to, at);
      [this.#bedDay, this.#bedAt] = [to, at];
    }
  }

  #startBed(state: WalkState, at: number): void {
    const voice = Object.hasOwn(BEDS, state.story.id) ? state.story.id : MUSEUM;
    const make = () => (BEDS[voice] ?? museumBed)(this.#engine, state.day, at);
    this.#voice = voice;
    this.#bed = landBed(this.#room, voice, make, at);
    this.#room = null;
    this.#bed.setDay(state.day, at);
    [this.#bedDay, this.#bedAt] = [state.day, at];
  }

  /** Fades the story back to the room, handing its bed to the next walk or Explore. */
  toRoom(at: number): RoomBed | null {
    for (const [, cue] of this.#cues) cue.stop(at, tunables.bedCrossfade / 1000);
    this.#cues = [];
    this.#whir.stop(at);
    const room = this.#bed ? { bed: this.#bed, voice: this.#voice } : this.#room;
    room?.bed.toRoom(at);
    this.#bed = null;
    this.#room = null;
    return room;
  }

  /** Fades everything the walk has playing. */
  stop(at: number): void {
    this.#bed?.stop(at);
    this.#room?.bed.stop(at);
    for (const [, cue] of this.#cues) cue.stop(at, tunables.bedCrossfade / 1000);
    this.#whir.stop(at);
  }
}

/** Whether the walk has landed on its beat: no flight under way, nor broken out. */
function landed(state: WalkState): boolean {
  return state.flight === null && !state.flying && state.mode !== 'breakout';
}

/** The page's sound, a story's walk or Explore's, and its mute switch. */
export interface WalkAudio extends SoundSwitch {
  inspectMemory?(account: import('../perf/memory').MemoryAccount): void;
  /** Arms gesture unlocks; the plaque calls this inside its click with inGesture true. */
  start(inGesture?: boolean): void;
  /** Fades the bed and cues to the room and disarms gesture unlocks in the lobby. */
  leave(): void;
  /**
   * The return has landed in the lobby: the engine forgets the noise no sound still plays, keeping
   * the room tone's.
   */
  finish(): void;
  /**
   * Every frame, with what the mode's sound follows; null is the lobby, with a whir during its
   * return flight.
   */
  update(heard: ModeAudio, view: ViewState, dtS: number, returning?: boolean): void;
  dispose(): void;
}

export function createWalkAudio(): WalkAudio {
  let muted = readMuted();
  let engine = unlockedSound() ?? null;
  engine?.setMuted(muted);
  let score: WalkScore | ClockScore | null = null;
  /** The bed the last score left playing room tone in the lobby, for the next one to take. */
  let room: RoomBed | null = null;
  let returnWhir: Whir | null = null;
  let active = false;
  /**
   * What the mode's sound followed as the last frame left it, and as it stood before the gesture
   * that unlocked sound.
   */
  let last: ModeAudio = null;
  let lastView: ViewState | null = null;
  let unlockedFrom: ModeAudio = null;
  let suspending: ReturnType<typeof setTimeout> | undefined;
  let warned = false;
  const listeners = new AbortController();
  const { signal } = listeners;

  // Heard while capturing, so a control that keeps its gesture to itself still unlocks sound.
  // In the lobby only the plaque can unlock it: the knob and M merely choose the setting.
  const unlock = () => {
    if (!active || engine?.ctx.state === 'running') return;
    // A touch's start is not yet a gesture the browser unlocks sound for; its end is.
    if (navigator.userActivation?.isActive === false) return;
    try {
      const sound = unlockSound(undefined, muted);
      if (engine !== sound) {
        sound.setMuted(muted);
        unlockedFrom = last;
      }
      engine = sound;
    } catch (error) {
      if (!warned) console.warn('Sound did not start:', error);
      warned = true;
    }
  };
  for (const type of GESTURES) {
    addEventListener(type, unlock, { capture: true, signal });
  }

  const flip = () => {
    muted = !muted;
    engine?.setMuted(muted);
    writeMuted(muted);
  };
  addEventListener(
    'keydown',
    (event) => {
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey)
        return;
      if (isFormField(event.target) || event.key.toLowerCase() !== 'm') return;
      flip();
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
          if (!signal.aborted && !document.hidden) sound.fade(true, tunables.showFade / 1000);
        });
      }
    },
    { signal },
  );

  /** Starts `next`, which has taken the room, in place of any score still playing. */
  const begin = <S extends WalkScore | ClockScore>(next: S, at: number): S => {
    score?.stop(at);
    room = null;
    unlockedFrom = null;
    score = next;
    return next;
  };
  /**
   * A frame of the mode's sound. A new score starts from what the sound followed before it could
   * play (the frame before the gesture that unlocked it), where that was of the same kind.
   */
  const play = (
    sound: SoundEngine,
    heard: NonNullable<ModeAudio>,
    pace: number,
    at: number,
    dt: number,
  ) => {
    const from = unlockedFrom ?? last ?? heard;
    if ('state' in heard) {
      const walk =
        score instanceof WalkScore
          ? score
          : begin(new WalkScore(sound, 'state' in from ? from.state : heard.state, at, room), at);
      walk.frame({ state: heard.state, unit: heard.unit, pace, at, dt });
    } else {
      const clock =
        score instanceof ClockScore
          ? score
          : begin(
              new ClockScore(sound, 'clock' in from ? from.clock.day : heard.clock.day, room),
              at,
            );
      clock.frame({ ...heard, pace, at, dt });
    }
  };

  return {
    inspectMemory: (account) => {
      if (score instanceof WalkScore) score.inspectMemory(account);
    },
    get muted() {
      return muted;
    },
    toggle: flip,
    start(inGesture = false) {
      active = true;
      if (inGesture) unlock();
    },
    leave() {
      active = false;
      if (engine && score) room = score.toRoom(engine.soon());
      score = null;
      last = null;
      lastView = null;
      unlockedFrom = null;
    },
    finish() {
      engine?.releaseNoise();
    },
    update(heard, view, dtS, returning = false) {
      if (engine && engine.ctx.state === 'running') {
        const at = engine.soon();
        const pace = lastView ? paceOf(lastView, view, dtS) : 0;
        if (heard && active) play(engine, heard, pace, at, dtS);
        if (returning) {
          returnWhir ??= whir(engine, at);
          returnWhir.setPace(pace, at);
        } else if (returnWhir) {
          returnWhir.stop(at);
          returnWhir = null;
        }
      }
      last = heard;
      lastView = { ...view };
    },
    dispose() {
      listeners.abort();
      clearTimeout(suspending);
      if (engine) {
        const at = engine.soon();
        score?.stop(at);
        room?.bed.stop(at);
        returnWhir?.stop(at);
      }
      score = null;
      room = null;
      returnWhir = null;
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
