// A stand-in director for the UI harness (prototype-walk-ui.html), on simple timers: flights of
// three seconds that sweep story time between beats, play that advances after a dwell, break-out,
// scrub, Meanwhile flights and resume. The view it reports moves with its flights, for Meanwhile's
// bearings. The real director is built separately.
import type { Walk, WalkMode, WalkState } from '../../../story/contract';
import type { LonLat, Story, StoryBeat } from '../../../story/story';
import { easeInOut, flightAt, flightRise, type ViewState } from '../../../view/viewState';

const FLIGHT_MS = 3000;
const DWELL_S = 8;

interface Flight {
  from: ViewState;
  to: ViewState;
  rise: number;
  startMs: number;
  /** Story time sweeps from one to the other on a flight to a beat; it holds on others. */
  days: [number, number] | null;
}

export class HarnessWalk implements Walk {
  view: ViewState;
  #state: WalkState;
  #flight: Flight | null = null;
  /** The mode to return to on resume. */
  #left: WalkMode = 'paused';
  readonly #listeners = new Set<(state: WalkState) => void>();

  constructor(story: Story, beat = 0) {
    const first = story.beats[beat] ?? story.beats[0];
    if (!first) throw new Error('the story has no beats');
    this.view = beatView(first);
    this.#state = { story, beat, mode: 'paused', flight: null, day: first.day, advanceIn: null };
  }

  state(): WalkState {
    return this.#state;
  }

  next(): void {
    this.goTo(this.#state.beat + 1);
  }

  back(): void {
    this.goTo(this.#state.beat - 1);
  }

  goTo(beat: number): void {
    const target = this.#state.story.beats[beat];
    if (!target) return;
    const mode = this.#state.mode === 'breakout' ? this.#left : this.#state.mode;
    this.#fly(beatView(target), [this.#state.day, target.day]);
    this.#set({ beat, mode, flight: 0, advanceIn: null });
  }

  togglePlay(): void {
    const { mode, flight } = this.#state;
    if (mode === 'breakout') {
      this.#left = 'playing';
      this.resume();
    } else if (mode === 'playing') {
      this.#set({ mode: 'paused', advanceIn: null });
    } else {
      this.#set({ mode: 'playing', advanceIn: flight === null ? DWELL_S : null });
    }
  }

  breakOut(): void {
    if (this.#state.mode !== 'breakout') this.#left = this.#state.mode;
    this.#flight = null;
    this.#set({ mode: 'breakout', flight: null, advanceIn: null });
  }

  resume(): void {
    this.goTo(this.#state.beat);
  }

  scrub(day: number): void {
    this.breakOut();
    this.#set({ day });
  }

  flyTo(target: LonLat, viewKm: number): void {
    this.breakOut();
    this.#fly({ lon: target[0], lat: target[1], viewKm, tilt: 0, heading: 0 }, null);
  }

  /** Lands on a beat at once, for screenshots. */
  jump(beat: number): void {
    const target = this.#state.story.beats[beat];
    if (!target) return;
    this.#flight = null;
    this.view = beatView(target);
    this.#set({ beat, mode: 'paused', flight: null, day: target.day, advanceIn: null });
  }

  update(nowMs: number, dtS: number): void {
    const flight = this.#flight;
    if (flight) {
      const t = Math.min(1, Math.max(0, (nowMs - flight.startMs) / FLIGHT_MS));
      const e = easeInOut(t);
      this.view = flightAt(flight.from, flight.to, e, flight.rise);
      if (flight.days) {
        const [from, to] = flight.days;
        this.#set({ flight: t, day: from + (to - from) * e });
      }
      if (t >= 1) {
        this.#flight = null;
        if (flight.days) {
          const playing = this.#state.mode === 'playing';
          this.#set({ flight: null, advanceIn: playing ? DWELL_S : null });
        }
      }
      return;
    }
    const { advanceIn, beat, story } = this.#state;
    if (advanceIn === null) return;
    const left = advanceIn - dtS;
    if (left > 0) this.#set({ advanceIn: left });
    else if (beat < story.beats.length - 1) this.next();
    else this.#set({ mode: 'paused', advanceIn: null });
  }

  subscribe(listener: (state: WalkState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    this.#listeners.clear();
  }

  #fly(to: ViewState, days: [number, number] | null): void {
    const from = { ...this.view };
    this.#flight = { from, to, rise: flightRise(from, to), startMs: performance.now(), days };
  }

  #set(change: Partial<WalkState>): void {
    this.#state = { ...this.#state, ...change };
    for (const listener of this.#listeners) listener(this.#state);
  }
}

function beatView(beat: StoryBeat): ViewState {
  const { target, viewKm, tilt, heading } = beat.camera;
  return { lon: target[0], lat: target[1], viewKm, tilt, heading };
}
