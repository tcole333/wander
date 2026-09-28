// The globe's historical borders in the walk (streaming.md 3.3): the release's one snapshot, 1815,
// the nearest to every Tambora date, drawn on the beats whose layers list borders. Its field loads
// in the background once the room is open: fetched from the data host, inflated a few MiB at a
// time and uploaded one face a frame, so no frame hitches. Once every face is in, the look's groove
// eases in and out over borderFade as beats change, and fades as the view closes in from 400 to
// 220 km across, where one of the field's texels spans tens of pixels. Without a borders section in
// the release, or once the file fails, it logs once and draws no borders: the walk never breaks
// over them.
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

/** The view widths, km across, over which the borders fade out as the view closes in. */
export const BORDER_FADE_KM: readonly [number, number] = [220, 400];

export class WalkBorders {
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
    if (this.#uniforms) this.#uniforms.lookBorderStrength.value = 0;
  }
}
