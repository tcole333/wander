// The Tambora walk's modules (issue #4, checkpoint 2): the director, the story UI and the story
// effects are built separately and joined by the walk's boot (walk/boot.ts). Story time is a day
// number (dates.ts); the story itself comes from stories/tambora/story.md (story.ts).
import type { Object3D, PerspectiveCamera } from 'three';
import type { Params, SurfaceLook, ViewportCss } from '../contract';
import type { ViewControl } from '../view/viewControl';
import type { ViewState } from '../view/viewState';
import type { LonLat, Story } from './story';

/** Playing advances by itself after each landing; breakout means the visitor is exploring. */
export type WalkMode = 'paused' | 'playing' | 'breakout';

export interface WalkState {
  story: Story;
  /** The beat shown, or during a flight the beat being flown to. */
  beat: number;
  mode: WalkMode;
  /** The flight's progress to `beat`, 0 to 1, or null once landed. */
  flight: number | null;
  /** Story time, a day number: it sweeps between beats' dates during flights and follows scrubs. */
  day: number;
  /** Seconds until play advances, while playing and landed; null otherwise. */
  advanceIn: number | null;
}

/** The director: beats, flights, play, break-out and resume. */
export interface Walk {
  state(): WalkState;
  next(): void;
  back(): void;
  goTo(beat: number): void;
  togglePlay(): void;
  /** Leaves the story for free exploring; the story's beat and time hold. */
  breakOut(): void;
  /** Flies back to the beat the visitor left. */
  resume(): void;
  /** The time ruler dragged: sets story time and breaks out. */
  scrub(day: number): void;
  /** A Meanwhile entry chosen: flies there and breaks out. */
  flyTo(target: LonLat, viewKm: number): void;
  update(nowMs: number, dtS: number): void;
  subscribe(listener: (state: WalkState) => void): () => void;
  dispose(): void;
}

export interface WalkOptions {
  /** Whether the tiles the current view needs have landed, for the flight's readiness hold. */
  ready: () => boolean;
}

export type CreateWalk = (story: Story, control: ViewControl, options: WalkOptions) => Walk;

/** A notable event elsewhere during a beat: a stand-in until the event index exists. */
export interface MeanwhileEntry {
  label: string;
  /** Day number, and the date as the panel prints it ('18 June 1815', '1815-1816'). */
  day: number;
  dateLabel: string;
  at: LonLat;
  qid?: string;
  source: { title: string; url: string };
}

/** Keyed by beat id. */
export type MeanwhileByBeat = Record<string, MeanwhileEntry[]>;

/** The card, the time ruler, Meanwhile, the Resume plaque and the story's controls, in the DOM. */
export interface WalkUi {
  /** Every frame: the state and the drawn view (for Meanwhile's compass bearings). */
  update(state: WalkState, view: ViewState): void;
  dispose(): void;
}

export type CreateWalkUi = (root: HTMLElement, walk: Walk, meanwhile: MeanwhileByBeat) => WalkUi;

/**
 * The ember, plume, pulses, callout labels, and illustrative ash and veil, as functions of story
 * time: scrubbing backward shows the right state. `group` hangs from the museum's globeMount (the
 * globe frame, radius 1); labels go into `labelRoot`. Ash tints the surface through the look.
 */
export interface WalkEffects {
  group: Object3D;
  params: Params;
  update(
    state: WalkState,
    camera: PerspectiveCamera,
    globe: Object3D,
    viewport: ViewportCss,
    elapsedS: number,
  ): void;
  dispose(): void;
}

export type CreateWalkEffects = (
  story: Story,
  look: SurfaceLook,
  labelRoot: HTMLElement,
) => WalkEffects;
