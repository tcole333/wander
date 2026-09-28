// The Tambora walk's modules (issue #4, checkpoint 2): the director, the story UI and the story
// effects are built separately and joined by the walk's boot (walk/boot.ts). Story time is a day
// number (dates.ts); the story itself comes from stories/tambora/story.md (story.ts).
import type { Object3D, PerspectiveCamera } from 'three';
import type { Params, SurfaceLook, ViewportCss } from '../contract';
import type { ViewControl } from '../view/viewControl';
import type { ViewState } from '../view/viewState';
import type { Precision } from './dates';
import type { BordersSource } from './effects/borders';
import type { ClimateSource } from './effects/climate';
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
  /** Whether the camera is on a flight: to a beat, back to one, or to a Meanwhile entry. */
  flying: boolean;
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
  /**
   * How the walk comes to its first beat: a jump there (the default), or a flight from the view,
   * as from the lobby.
   */
  arrive?: 'jump' | 'fly';
}

export type CreateWalk = (story: Story, control: ViewControl, options: WalkOptions) => Walk;

/** A notable event elsewhere, from the event index (story/meanwhile.ts). */
export interface MeanwhileEntry {
  /** The entry's written line, else its Wikidata label. */
  label: string;
  /** Day number, and the date as the panel prints it ('18 June 1815', 'June 1815', '1816'). */
  day: number;
  dateLabel: string;
  at: LonLat;
  qid?: string;
  source: { title: string; url: string };
}

/** Keyed by beat id. */
export type MeanwhileByBeat = Record<string, MeanwhileEntry[]>;

/**
 * A month's entries, shown while the visitor scrubs; `start` and `end` are its first and last
 * day.
 */
export interface MeanwhileMonth {
  start: number;
  end: number;
  entries: MeanwhileEntry[];
}

/** Each beat's entries, and each month's in story order for scrubbing. */
export interface Meanwhile {
  beats: MeanwhileByBeat;
  months: MeanwhileMonth[];
}

/** The climate the globe draws: the month, its palette's range and middle, and how strongly. */
export interface ClimateShown {
  year: number;
  /** 1-12. */
  month: number;
  /** K at which the palette saturates, either side of the 1901-2000 average. */
  rangeK: number;
  /** The land's color at the average, sRGB hex: the palette's middle. */
  base: string;
  /** 0 to 1, easing in and out with the layer. */
  strength: number;
}

/** The borders the globe draws: their snapshot's astronomical year, and how strongly. */
export interface BordersShown {
  year: number;
  /** 0 to 1, easing in and out with the layer and fading as the view closes in. */
  strength: number;
}

/**
 * The card, the time ruler, Meanwhile, the Resume plaque, the climate legend, the borders' year
 * plate and the story's controls, in the DOM.
 */
export interface WalkUi {
  /**
   * Every frame: the state, the drawn view (for Meanwhile's compass bearings), and the climate and
   * borders the globe draws, if any.
   */
  update(
    state: WalkState,
    view: ViewState,
    climate?: ClimateShown | null,
    borders?: BordersShown | null,
  ): void;
  /** The finest unit the time ruler engraves now, whose marks the detents sound. */
  rulerUnit(): Precision;
  /**
   * How far right of the page's left edge the beat card reaches where it is laid out, in CSS px,
   * whatever slides it for a moment (the lobby's veil).
   */
  cardReach(): number;
  dispose(): void;
}

/** The walk's sound as its mute control sees it (audio/walkAudio.ts). */
export interface SoundSwitch {
  readonly muted: boolean;
  toggle(): void;
}

export type CreateWalkUi = (
  root: HTMLElement,
  walk: Walk,
  meanwhile: Meanwhile,
  sound: SoundSwitch,
  /** The data host, which serves the card's images. */
  dataHost: string,
) => WalkUi;

/**
 * The ember, plume, pulses, callout labels, illustrative ash and veil, the real climate and the
 * historical borders, as functions of story time: scrubbing backward shows the right state.
 * `group` hangs from the museum's globeMount (the globe frame, radius 1); labels go into
 * `labelRoot`. Ash, climate and borders reach the surface through the look; climate and borders
 * read their files from `source`'s data host.
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
  /** Starts fetching what the effects draw from the data host: the climate's years. */
  load(): void;
  /**
   * Every frame from the room's opening, the story started or not: what loads in the background
   * (the borders' field, a face a frame).
   */
  background(): void;
  /** The climate drawn, for its legend; null while none is. */
  climate(): ClimateShown | null;
  /** The borders drawn, for their year plate; null while none are. */
  borders(): BordersShown | null;
  dispose(): void;
}

export type CreateWalkEffects = (
  story: Story,
  look: SurfaceLook,
  labelRoot: HTMLElement,
  source?: ClimateSource & BordersSource,
) => WalkEffects;
