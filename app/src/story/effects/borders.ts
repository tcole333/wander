// The globe's historical borders in the walk (streaming.md 3.3): the snapshot nearest the story's
// first date (every Tambora date falls nearest 1815), drawn on the beats whose layers list
// borders. Its field loads in the background once the room is open: fetched from the data host,
// inflated as it arrives and uploaded one face a frame, so no frame hitches. Once every face is in,
// the look's groove eases in and out over borderFade as beats change, and fades as the view closes
// in below about 300 km across, where one of the field's texels spans tens of pixels. Without a
// borders section in the release, or once the file fails, it logs once and draws no borders: the
// walk never breaks over them.
import { tunables } from '../../config/tunables';
import { BORDER_FACES, inflateBorders, snapshotFor } from '../../data/borders';
import type { BordersRelease } from '../../data/release';
import { fetchData } from '../../data/surfaceLayer';
import { uploadBorderFace, type BorderUniforms } from '../../look/bordersHook';
import type { BordersShown, WalkState } from '../contract';
import type { Story } from '../story';
import { smoothstep } from './timeline';

/** Where the border fields are: the release's data host and its borders section, if it has one. */
export interface BordersSource {
  dataHost: string;
  borders?: BordersRelease;
}

/** The view widths, km across, over which the borders fade out as the view closes in. */
export const BORDER_FADE_KM: readonly [number, number] = [220, 400];

export class WalkBorders {
  readonly #uniforms: BorderUniforms | undefined;
  readonly #url: string | null;
  readonly #year: number;
  readonly #load: (url: string) => Promise<ArrayBuffer>;
  /** Faces whose bytes are in place and wait for their upload, and how many are uploaded. */
  readonly #arrived: number[] = [];
  #uploaded = 0;
  #started = false;
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
    const stem = borders && story.beats[0] ? snapshotFor(borders, story.beats[0].day) : undefined;
    const file = stem === undefined ? undefined : borders?.files[stem];
    this.#year = stem === undefined ? 0 : (borders?.years[borders.stems.indexOf(stem)] ?? 0);
    this.#url = file ? `${source.dataHost}/${file.key}` : null;
    this.#off = uniforms === undefined || !drawn;
    if (!this.#off && !this.#url) this.#stop('the release has no borders section');
  }

  /** Whether every face of the field is on the GPU. */
  get ready(): boolean {
    return this.#uploaded === BORDER_FACES;
  }

  /** The snapshot's year and how strongly its borders are drawn, while they are. */
  get shown(): BordersShown | null {
    return this.#strength > 0 ? { year: this.#year, strength: this.#strength } : null;
  }

  /**
   * Every frame from the room's opening, story or not: starts the field's load the first time,
   * then uploads at most one face that has arrived.
   */
  background(): void {
    if (this.#off || !this.#uniforms || !this.#url) return;
    if (!this.#started) {
      this.#started = true;
      const into = this.#uniforms.lookBorderField.value.image.data as Uint8Array;
      this.#load(this.#url)
        .then((stored) => inflateBorders(stored, into, (face) => this.#arrived.push(face)))
        .catch((error: unknown) => this.#stop(String(error)));
    }
    const face = this.#arrived.shift();
    if (face === undefined) return;
    uploadBorderFace(this.#uniforms, face);
    this.#uploaded += 1;
  }

  /** Every frame of the walk: eases toward the beat's layer, faded by the view's width. */
  update(state: WalkState, dtS: number, viewKm: number, strength: number): void {
    const uniforms = this.#uniforms;
    if (this.#off || !uniforms) return;
    const wanted = this.ready && state.story.beats[state.beat]?.layers.includes('borders') === true;
    const step = (1000 * dtS) / tunables.borderFade;
    this.#shown += Math.max(-step, Math.min(step, (wanted ? 1 : 0) - this.#shown));
    const [near, far] = BORDER_FADE_KM;
    this.#strength = smoothstep(0, 1, this.#shown) * smoothstep(near, far, viewKm) * strength;
    uniforms.lookBorderStrength.value = this.#strength;
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
    this.#arrived.length = 0;
    if (this.#uniforms) this.#uniforms.lookBorderStrength.value = 0;
  }
}
