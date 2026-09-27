// The walk's director (issue #4, checkpoint 2): it flies between the story's beats (flight.ts),
// sweeping story time with each flight, holds a late landing briefly for the tiles, plays on by
// itself after each beat's reading time, and lets the visitor break out to explore and resume. It
// drives the camera by setting the ViewControl's view every frame of a flight, and while a beat is
// read it keeps the camera moving: a slow turn on a 'drift: slow' beat, a slow push in on the rest.
// A beat that spreads an effect lands at its window's start and plays the spread out to its date.
import { isFormField, type ViewControl } from '../view/viewControl';
import { mixViews, wrap180, type ViewState } from '../view/viewState';
import type { Walk, WalkMode, WalkOptions, WalkState } from './contract';
import { flightEase, flightPath, flightSeconds, MAX_LEAD, type FlightPath } from './flight';
import type { LonLat, Story, StoryBeat } from './story';

/**
 * The readiness gate: how far into a flight it checks, and the longest it holds, in seconds. The
 * streamer can only finish while the view is nearly the destination's, so the gate waits until the
 * camera has almost landed (smootherstep has covered 99% of the path by 0.9), where a short hold
 * reads as a slower settle rather than a stall in mid-air.
 */
const GATE_AT = 0.9;
const HOLD_MAX_S = 0.4;
/** The time constant with which the flight's clock slows into a hold and picks up after it. */
const CLOCK_TAU_S = 0.25;
/** A new target mid-flight: the old course blends into the new flight over this long. */
const RETARGET_BLEND_S = 0.3;
/** The span over which a retarget reads the camera's pace. */
const PACE_S = 0.05;
/** Play's pause on a beat: seconds per word of its text, plus a moment. */
const READ_S_PER_WORD = 0.28;
const READ_EXTRA_S = 3;
/** The least wait when Play is pressed on a beat already read. */
const MIN_ADVANCE_S = 4;
/**
 * While a beat is read: a 'drift: slow' beat turns the globe this many degrees of longitude a
 * second, eastward so the ground slides west as the veil did; the others close in by this share.
 */
const DRIFT_DEG_PER_S = 0.4;
const PUSH_IN = 0.05;
/** How long a spread (ash, veil) plays out after landing, in seconds. */
const SPREAD_S = 8;

/** A flight's timings, for scripts. */
export interface FlightRecord {
  /** The beat flown to, or null for a free flight. */
  to: number | null;
  /** The path's length S, and the duration it gives. */
  length: number;
  plannedS: number;
  tookS: number;
  /** How long the readiness gate held. */
  heldS: number;
  /** The widest view on the way, km. */
  peakKm: number;
  end: 'landed' | 'retargeted' | 'broken';
}

export interface DirectedWalk extends Walk {
  /** Every flight so far, oldest first. */
  flights(): readonly FlightRecord[];
}

/** Where the camera would be `s` seconds on, were nothing to change. */
type Course = (s: number) => ViewState;

interface Leg {
  path: FlightPath;
  durationS: number;
  /** The ease's starting slope: the pace a retarget took over (flightEase). */
  lead: number;
  /** Seconds of flight time run; the gate slows it, so it falls behind the wall clock. */
  clock: number;
  rate: number;
  /** The beat flown to, and story time's sweep; null on a free flight. */
  beat: number | null;
  days: [number, number] | null;
  gate: 'ahead' | 'holding' | 'passed';
  record: FlightRecord;
}

export function readingSeconds(beat: StoryBeat): number {
  const words = beat.paragraphs.join(' ').split(/\s+/).filter(Boolean).length;
  return READ_S_PER_WORD * words + READ_EXTRA_S;
}

export function beatView(beat: StoryBeat): ViewState {
  const { target, viewKm, tilt, heading } = beat.camera;
  return { lon: target[0], lat: target[1], viewKm, tilt, heading };
}

/** The beat's view `seconds` after landing: turning or closing in until it has been read. */
export function dwellView(beat: StoryBeat, seconds: number): ViewState {
  const view = beatView(beat);
  const reading = readingSeconds(beat);
  const s = Math.min(seconds, reading);
  if (beat.camera.drift === 'slow')
    return { ...view, lon: wrap180(view.lon + DRIFT_DEG_PER_S * s) };
  return { ...view, viewKm: view.viewKm * (1 - (PUSH_IN * s) / reading) };
}

/**
 * The day a flight from `from` lands on: the beat's date, or on a beat that spreads an effect, its
 * window's start when coming from before it, so the spread plays out after landing.
 */
export function landingDay(beat: StoryBeat, from: number): number {
  const spreads = beat.effects.some((e) => e.kind === 'spread');
  if (!spreads || !beat.window) return beat.day;
  return Math.min(beat.day, Math.max(from, beat.window[0]));
}

export function createWalk(story: Story, control: ViewControl, options: WalkOptions): DirectedWalk {
  const beats = story.beats;
  const first = beats[0];
  if (!first) throw new Error(`story '${story.id}' has no beats`);
  const last = beats.length - 1;
  const beatAt = (i: number) => beats[i] ?? first;

  let beat = 0;
  let mode: WalkMode = 'paused';
  /** The mode a break-out left, which resume() restores. */
  let resumeMode: 'paused' | 'playing' = 'paused';
  let day = first.day;
  /** Seconds since landing on the beat, and the day landed on, where a spread starts. */
  let dwelt = 0;
  let landedOn = first.day;
  let advanceIn: number | null = null;
  let leg: Leg | null = null;
  /** After a retarget, the old course, blended out over RETARGET_BLEND_S. */
  let fading: { course: Course; s: number } | null = null;
  const records: FlightRecord[] = [];
  const listeners = new Set<(state: WalkState) => void>();
  let notified = '';

  control.go(beatView(first), true);

  const state = (): WalkState => ({
    story,
    beat,
    mode,
    flight: leg && leg.beat !== null ? Math.min(1, leg.clock / leg.durationS) : null,
    flying: leg !== null,
    day,
    advanceIn,
  });

  /** Tells the listeners when the beat, the mode or landing changes. */
  const changed = () => {
    const key = `${beat} ${mode} ${state().flight === null}`;
    if (key === notified) return;
    notified = key;
    const now = state();
    for (const listener of listeners) listener(now);
  };

  const end = (how: FlightRecord['end']) => {
    if (leg) leg.record.end = how;
    leg = null;
  };

  /** The share of its path a flight has covered at `clock`. */
  const eased = (flight: Leg, clock = flight.clock) =>
    flightEase(clock / flight.durationS, flight.lead);

  /** `view` with the old course blended out, `s` seconds after a retarget. */
  const blend = (old: Course, s: number, view: ViewState) => {
    if (s >= RETARGET_BLEND_S) return view;
    const t = s / RETARGET_BLEND_S;
    return mixViews(old(s), view, t * t * (3 - 2 * t));
  };

  /** The course the camera is on: the flight at its present pace, and any blend under way. */
  const course = (): Course | null => {
    if (!leg) return null;
    const { clock, rate } = leg;
    const flight = leg;
    const ahead: Course = (s) => flight.path.at(eased(flight, clock + rate * s));
    if (!fading) return ahead;
    const { course: before, s: since } = fading;
    return (s) => blend(before, since + s, ahead(s));
  };

  /**
   * Flies from the drawn view to `to`. A flight under way hands over its pace, and its course
   * blends into the new one, so a retarget neither jolts nor stalls the camera.
   */
  const fly = (to: ViewState, target: number | null) => {
    const old = course();
    const pace = old ? flightPath(old(0), old(PACE_S)).length / PACE_S : 0;
    fading = old && { course: old, s: 0 };
    end('retargeted');
    const path = flightPath({ ...control.current }, to);
    const durationS = flightSeconds(path.length);
    const lead = path.length > 0 ? Math.min(MAX_LEAD, (pace * durationS) / path.length) : 0;
    const record: FlightRecord = {
      to: target,
      length: path.length,
      plannedS: durationS,
      tookS: 0,
      heldS: 0,
      peakKm: control.current.viewKm,
      end: 'landed',
    };
    records.push(record);
    leg = {
      path,
      durationS,
      lead,
      clock: 0,
      rate: 1,
      beat: target,
      days: target === null ? null : [day, landingDay(beatAt(target), day)],
      // Free flights go wherever the visitor points, so they never wait on tiles.
      gate: target === null ? 'passed' : 'ahead',
      record,
    };
  };

  /** A step of a flight's clock, slowed into a hold while the view's tiles are not ready. */
  const advance = (flight: Leg, dtS: number) => {
    flight.record.tookS += dtS;
    if (flight.gate === 'ahead' && flight.clock >= GATE_AT * flight.durationS) {
      flight.gate = 'holding';
    }
    if (flight.gate === 'holding') {
      if (options.ready() || flight.record.heldS >= HOLD_MAX_S) flight.gate = 'passed';
      else flight.record.heldS = Math.min(HOLD_MAX_S, flight.record.heldS + dtS);
    }
    const rate = flight.gate === 'holding' ? 0 : 1;
    flight.rate += (rate - flight.rate) * (1 - Math.exp(-dtS / CLOCK_TAU_S));
    flight.clock = Math.min(flight.durationS, flight.clock + flight.rate * dtS);
  };

  const land = () => {
    const landed = leg?.beat ?? null;
    end('landed');
    fading = null;
    dwelt = 0;
    landedOn = day;
    if (landed === null || mode !== 'playing') return;
    if (beat === last) {
      mode = 'paused';
      advanceIn = null;
    } else {
      advanceIn = readingSeconds(beatAt(beat));
    }
  };

  const enterBreakout = () => {
    if (mode === 'breakout') return;
    resumeMode = mode === 'playing' ? 'playing' : 'paused';
    mode = 'breakout';
    advanceIn = null;
  };

  const goTo = (target: number) => {
    const next = Math.min(last, Math.max(0, Math.round(target)));
    const wasOut = mode === 'breakout';
    if (wasOut) mode = resumeMode;
    if (wasOut || next !== beat) {
      beat = next;
      advanceIn = null;
      fly(beatView(beatAt(next)), next);
    }
    changed();
  };

  const breakOut = () => {
    enterBreakout();
    end('broken');
    fading = null;
    changed();
  };

  const resume = () => {
    if (mode !== 'breakout') return;
    goTo(beat);
  };

  return {
    state,
    next: () => goTo(beat + 1),
    back: () => goTo(beat - 1),
    goTo,
    togglePlay() {
      if (mode === 'breakout') {
        resumeMode = 'playing';
        resume();
        return;
      }
      if (mode === 'playing') {
        mode = 'paused';
        advanceIn = null;
      } else if (leg || beat < last) {
        mode = 'playing';
        if (!leg) advanceIn = Math.max(MIN_ADVANCE_S, readingSeconds(beatAt(beat)) - dwelt);
      }
      changed();
    },
    breakOut,
    resume,
    scrub(target: number) {
      if (mode !== 'breakout') breakOut();
      // Whole days, as the date plate reads them: an effect dated to a day is on from its start.
      day = Math.floor(target);
    },
    flyTo(target: LonLat, viewKm: number) {
      enterBreakout();
      const { tilt, heading } = control.current;
      fly({ lon: target[0], lat: target[1], viewKm, tilt, heading }, null);
      changed();
    },
    update(_nowMs: number, dtS: number) {
      if (leg) {
        advance(leg, dtS);
        const e = eased(leg);
        let view = leg.path.at(e);
        if (fading) {
          fading.s += dtS;
          view = blend(fading.course, fading.s, view);
          if (fading.s >= RETARGET_BLEND_S) fading = null;
        }
        control.go(view, true);
        leg.record.peakKm = Math.max(leg.record.peakKm, control.current.viewKm);
        if (leg.days) day = leg.days[0] + (leg.days[1] - leg.days[0]) * e;
        if (leg.clock >= leg.durationS) land();
      } else if (mode !== 'breakout') {
        dwelt += dtS;
        const shown = beatAt(beat);
        control.go(dwellView(shown, dwelt), true);
        day =
          dwelt >= SPREAD_S
            ? shown.day
            : landedOn + (shown.day - landedOn) * ease(dwelt / SPREAD_S);
        if (mode === 'playing' && advanceIn !== null) {
          advanceIn = Math.max(0, advanceIn - dtS);
          if (advanceIn === 0) goTo(beat + 1);
        }
      }
      changed();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      listeners.clear();
      leg = null;
      fading = null;
    },
    flights: () => records,
  };
}

function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * The story's keys: Left and Right step beats (from a break-out they resume on the way), Space
 * plays or pauses, and Escape resumes. Returns a function that removes them.
 */
export function bindWalkKeys(walk: Walk): () => void {
  const onKey = (event: KeyboardEvent) => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isFormField(event.target)) return;
    // A focused button or link takes Space itself; the walk does not act on it twice.
    if (event.key === ' ' && isControl(event.target)) return;
    if (event.key === 'ArrowRight') walk.next();
    else if (event.key === 'ArrowLeft') walk.back();
    else if (event.key === ' ') walk.togglePlay();
    else if (event.key === 'Escape') walk.resume();
    else return;
    event.preventDefault();
  };
  addEventListener('keydown', onKey);
  return () => removeEventListener('keydown', onKey);
}

/** A button, link or disclosure, which the browser presses with Space. */
function isControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('button, a, summary') !== null;
}
