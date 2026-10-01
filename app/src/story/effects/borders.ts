// The globe's historical borders in the walk (streaming.md 3.3): the release's one snapshot, 1815,
// the nearest to every Tambora date, drawn on the beats whose layers list borders. Its field loads
// in the background once the room is open: fetched from the data host, inflated a few MiB at a
// time and uploaded one face a frame, so no frame hitches. Once every face is in, the look's groove
// eases in and out over borderFade as beats change, and fades as the view closes in over
// borderCloseKm, where one of the field's texels spans tens of pixels. Without a borders section in
// the release, or once the file fails, it logs once and draws no borders: the walk never breaks
// over them.
//
// Where the release names the border steps, the look holds them instead, and the walk draws its
// beats' steps (StepBorders): the director writes the world clock, the steps follow it
// (borders/clockBorders.ts), and the walk keeps the beat's layers as the gate. A beat that lists
// borders names its step as its readiness item (streaming.md 5.7): it loads from the flight's
// start, and the beat is ready only once it is in a slot. In the lobby, the walk's first border
// step preloads in place of the 1815 field. Walks never draw previews.
import type { ClockBorders } from '../../borders/clockBorders';
import { tunables } from '../../config/tunables';
import { BORDER_FACES, inflateBorders } from '../../data/borders';
import type { BordersRelease } from '../../data/release';
import { fetchData } from '../../data/surfaceLayer';
import { fillBorderField, uploadBorderFace, type BorderUniforms } from '../../look/bordersHook';
import type { BordersShown, WalkState } from '../contract';
import type { Story } from '../story';
import { smoothstep } from './timeline';

/** Where the border fields are: the release's data host and its borders section, if it has one. */
export interface BordersSource {
  dataHost: string;
  borders?: BordersRelease;
}

/** The walk's borders as its effects drive them: milestone 1's 1815 field, or the border steps. */
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

export class WalkBorders implements BeatBorders {
  readonly #uniforms: BorderUniforms | undefined;
  readonly #url: string | null;
  readonly #year: number;
  readonly #load: (url: string) => Promise<ArrayBuffer>;
  #started = false;
  /** Whether the field holds its bytes, and how many of its faces are uploaded. */
  #filled = false;
  #uploaded = 0;
  /** 0 to 1, before its easing curve, and the strength drawn. */
  #shown = 0;
  #strength = 0;
  #off: boolean;

  constructor(
    story: Story,
    source: BordersSource,
    uniforms: BorderUniforms | undefined,
    load: (url: string) => Promise<ArrayBuffer> = fetchData,
  ) {
    this.#uniforms = uniforms;
    this.#load = load;
    const { borders } = source;
    const drawn = story.beats.some((beat) => beat.layers.includes('borders'));
    const stem = borders?.stems[0];
    const file = stem === undefined ? undefined : borders?.files[stem];
    this.#year = borders?.years[0] ?? 0;
    this.#url = file ? `${source.dataHost}/${file.key}` : null;
    this.#off = uniforms === undefined || !drawn;
    if (!this.#off && !this.#url) this.#stop('the release has no borders section');
  }

  /** Whether every face of the field is on the GPU. */
  get ready(): boolean {
    return this.#uploaded === BORDER_FACES;
  }

  /** The field is no beat's readiness item: it loads from the room's first frame. */
  beatReady(): boolean {
    return true;
  }

  /** The snapshot's year and how strongly its borders are drawn, while they are. */
  get shown(): BordersShown | null {
    return this.#strength > 0 ? { year: this.#year, strength: this.#strength } : null;
  }

  /**
   * Every frame from the room's opening, story or not: starts the field's load the first time,
   * then, once it has arrived, uploads one face a frame.
   */
  background(): void {
    const uniforms = this.#uniforms;
    if (this.#off || !uniforms || !this.#url) return;
    if (!this.#started) {
      this.#started = true;
      this.#load(this.#url)
        .then(inflateBorders)
        .then((faces) => {
          if (this.#off) return;
          fillBorderField(uniforms, faces);
          this.#filled = true;
        })
        .catch((error: unknown) => this.#stop(String(error)));
    }
    if (!this.#filled || this.ready) return;
    uploadBorderFace(uniforms, this.#uploaded);
    this.#uploaded += 1;
  }

  /** Every frame of the walk: eases toward the beat's layer, faded by the view's width. */
  update(state: WalkState, dtS: number, viewKm: number, strength: number): void {
    const uniforms = this.#uniforms;
    if (this.#off || !uniforms) return;
    const wanted = this.ready && state.story.beats[state.beat]?.layers.includes('borders') === true;
    const step = (1000 * dtS) / tunables.borderFade;
    this.#shown += Math.max(-step, Math.min(step, (wanted ? 1 : 0) - this.#shown));
    const { near, far } = tunables.borderCloseKm;
    this.#strength = smoothstep(0, 1, this.#shown) * smoothstep(near, far, viewKm) * strength;
    uniforms.lookBorderStrength.value = this.#strength;
  }

  /** Clears the lobby while retaining the uploaded field for the next walk. */
  hide(): void {
    this.#shown = 0;
    this.#strength = 0;
    if (this.#uniforms) this.#uniforms.lookBorderStrength.value = 0;
  }

  /** Draws no more borders. */
  dispose(): void {
    this.#stop('');
  }

  /** Logs why, once, and draws no borders from here on. */
  #stop(why: string): void {
    if (!this.#off && why) console.warn(`The globe shows no borders: ${why}`);
    this.#off = true;
    this.#strength = 0;
    if (this.#uniforms) this.#uniforms.lookBorderStrength.value = 0;
  }
}

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
   * In the lobby, the story's first border step loads into a slot, as the 1815 field loads from the
   * room's first frame, so the walk's first border beat draws it as it arrives. The other steps
   * load as the walk heads for their beats, or as the clock rests in them.
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
