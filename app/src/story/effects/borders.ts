// The walk's borders (streaming.md 3.3), where the release names the border steps and the look
// holds them: the director writes the world clock, the steps follow it (borders/clockBorders.ts),
// and the walk keeps the beat's layers as the gate (StepBorders). A beat that lists borders names
// its step as its readiness item (streaming.md 5.7): it loads from the flight's start, and the
// beat is ready only once it is in a slot. In the lobby, the walk's first border step preloads, so
// the walk's first border beat draws it as it arrives. Walks never draw previews. Where the
// release names no steps the walk draws no borders, and says nothing of it (NO_BORDERS).
import type { ClockBorders } from '../../borders/clockBorders';
import { tunables } from '../../config/tunables';
import type { BordersShown, WalkState } from '../contract';
import type { Story } from '../story';
import { smoothstep } from './timeline';

/** The walk's borders as its effects drive them: the border steps, or none. */
export interface BeatBorders {
  /** What is drawn and how strongly, while anything is. */
  readonly shown: BordersShown | null;
  /** Every frame from the room's opening; `lobby` while the lobby stands with no mode running. */
  background(lobby: boolean): void;
  /** Whether the beat the walk is on, or flying to, has its borders: its readiness item. */
  beatReady(state: WalkState): boolean;
  update(state: WalkState, dtS: number, viewKm: number, strength: number): void;
  hide(): void;
  dispose(): void;
}

/** The walk's borders where the release names no steps: none drawn, none waited for. */
export const NO_BORDERS: BeatBorders = {
  shown: null,
  background() {},
  beatReady: () => true,
  update() {},
  hide() {},
  dispose() {},
};

/**
 * The walk's borders where the look holds the border steps: the beats' layers gate the steps, and
 * a beat that lists borders waits for its own.
 */
export class StepBorders implements BeatBorders {
  readonly #steps: ClockBorders;
  /** The day of the story's first beat that lists borders, whose step the lobby preloads. */
  readonly #first: number | null;
  /** 0 to 1, before its easing curve. */
  #shown = 0;

  constructor(story: Story, steps: ClockBorders) {
    this.#steps = steps;
    this.#first = story.beats.find((beat) => beat.layers.includes('borders'))?.day ?? null;
  }

  /** The step drawn and how strongly, while it is. */
  get shown(): BordersShown | null {
    const shown = this.#steps.shown;
    return shown && !shown.preview ? { year: shown.year, strength: shown.strength } : null;
  }

  /**
   * In the lobby, the story's first border step loads into a slot, so the walk's first border beat
   * draws it as it arrives. The other steps load as the walk heads for their beats, or as the clock
   * rests in them.
   */
  background(lobby: boolean): void {
    if (lobby && this.#first !== null) this.#steps.preload(this.#first);
  }

  /** Whether the beat's own step is in a slot, where it lists borders: true on any other beat. */
  beatReady(state: WalkState): boolean {
    const day = beatDay(state);
    return day === null || this.#steps.holds(day);
  }

  update(state: WalkState, dtS: number, viewKm: number, strength: number): void {
    if (this.#first === null) return;
    const wanted = state.story.beats[state.beat]?.layers.includes('borders') === true;
    const step = (1000 * dtS) / tunables.borderFade;
    this.#shown += Math.max(-step, Math.min(step, (wanted ? 1 : 0) - this.#shown));
    this.#steps.update({
      wanted: this.#shown > 0,
      previews: false,
      viewKm,
      strength: smoothstep(0, 1, this.#shown) * strength,
      beat: beatDay(state),
    });
  }

  /** Clears the lobby; the steps keep their slots for the next walk. */
  hide(): void {
    this.#shown = 0;
    if (this.#first !== null) this.#steps.hide();
  }

  dispose(): void {
    this.hide();
  }
}

/**
 * The day of the beat the walk is on, or flying to, where it lists borders: the day its step
 * holds. Null on a beat without borders, and in a break-out, where the borders follow the clock.
 */
function beatDay(state: WalkState): number | null {
  if (state.mode === 'breakout') return null;
  const beat = state.story.beats[state.beat];
  return beat?.layers.includes('borders') ? beat.day : null;
}
