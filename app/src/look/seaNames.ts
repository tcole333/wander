// The look's Labels layer: the ocean and sea names of seaNames.json, engraved in the lacquer.
// They are lettered once at boot into an atlas in the walk's own faces, the oceans in Libre
// Baskerville's tracked capitals and the seas in Source Serif 4's italic, both bundled and loaded
// before anything is drawn, so nothing is fetched later. The look inlays them at sea level, as it
// does the graticule, so relief never bends them (lookFragment.glsl.ts, lookSeaNamesAt).
// Each frame the look picks the names in the view whose letters stand between about 7 and 48 px on
// screen, fading each in and out by that size and by its view widths, and hands the SEA_NAMES_MAX
// strongest to the shader.
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RedFormat,
  Vector3,
  Vector4,
  type Matrix4,
  type Texture,
} from 'three';
import { tunables } from '../config/tunables';
import { releaseDataAfterUpload } from '../gpu/uploadOnce';
import { glyphShelf, type GlyphCell } from '../marks/glyphAtlas';
import type { GlyphSet } from '../marks/glyphs';
import type { GlyphCells } from '../marks/marks';
import { dirOf, EARTH_KM } from '../story/effects/geo';
import { smoothstep } from '../story/effects/timeline';
import list from './seaNames.json';

/** A name as seaNames.json holds it. */
export interface SeaName {
  /** A line break sets it on two lines. */
  text: string;
  lon: number;
  lat: number;
  /** The em, in degrees of arc. */
  size: number;
  /** Space added between letters, in ems; TRACKING's for its style when not given. */
  tracking?: number;
  /** The baseline's direction, degrees counterclockwise from east. */
  angle?: number;
  /** Tracked capitals in Libre Baskerville, or Source Serif 4's italic. */
  style: 'ocean' | 'sea';
  /** The view's width at the name, km, within which it shows. */
  minKm?: number;
  maxKm?: number;
}

const SEA_NAMES = list as SeaName[];

/** The most names the shader inlays at once. */
export const SEA_NAMES_MAX = 16;

/** The em in CSS px over which a name fades in, and over which it fades out again. */
const SEA_NAME_PX = { in: [7, 11], out: [36, 48] } as const;

/** A view width bound's fade, either side of it, as a share of it. */
const KM_FADE = 0.15;

const DEG = Math.PI / 180;

/** How strongly a name shows with its em `emPx` CSS px on screen, the view `viewKm` wide there. */
export function seaNameFade(name: SeaName, emPx: number, viewKm: number): number {
  const [a, b] = SEA_NAME_PX.in;
  const [c, d] = SEA_NAME_PX.out;
  let fade = smoothstep(a, b, emPx) * (1 - smoothstep(c, d, emPx));
  if (name.minKm !== undefined) {
    fade *= smoothstep(name.minKm * (1 - KM_FADE), name.minKm * (1 + KM_FADE), viewKm);
  }
  if (name.maxKm !== undefined) {
    fade *= 1 - smoothstep(name.maxKm * (1 - KM_FADE), name.maxKm * (1 + KM_FADE), viewKm);
  }
  return fade;
}

/** Where the camera is and how it projects, for picking the names. */
export interface SeaNameView {
  /** The camera in the globe frame (radius 1). */
  camera: Vector3;
  /** CSS px a length spans at the same distance in front of the camera. */
  pxPerUnit: number;
  /** The viewport's width and height in CSS px. */
  width: number;
  height: number;
  /** The globe frame to clip space: the camera's view and its projection, lens offset included. */
  toClip: Matrix4;
}

/** A name on the globe: its direction and its reach from there, radians. */
export interface PlacedName {
  name: SeaName;
  dir: Vector3;
  reach: number;
}

const clip = new Vector4();

/**
 * The names to inlay and how strongly, strongest first and at most SEA_NAMES_MAX: those at least
 * partly on the camera's side of the globe and in the view, faded by their em on screen and the
 * view's width at them. Names beyond the view's edges take no slot, so none on screen waits for
 * one.
 */
export function pickSeaNames(
  names: readonly PlacedName[],
  view: SeaNameView,
): { index: number; alpha: number }[] {
  const r = view.camera.length();
  if (r <= 1) return [];
  const horizon = Math.acos(1 / r);
  const picked: { index: number; alpha: number }[] = [];
  names.forEach(({ name, dir, reach }, index) => {
    const off = Math.acos(Math.min(1, Math.max(-1, dir.dot(view.camera) / r)));
    if (off > horizon + reach) return;
    const distance = view.camera.distanceTo(dir);
    const reachPx = (reach * view.pxPerUnit) / distance;
    clip.set(dir.x, dir.y, dir.z, 1).applyMatrix4(view.toClip);
    if (clip.w <= 0) return;
    if (Math.abs(clip.x) > clip.w * (1 + (2 * reachPx) / view.width)) return;
    if (Math.abs(clip.y) > clip.w * (1 + (2 * reachPx) / view.height)) return;
    const emPx = (name.size * DEG * view.pxPerUnit) / distance;
    const viewKm = (distance / view.pxPerUnit) * view.width * EARTH_KM;
    const alpha = seaNameFade(name, emPx, viewKm);
    if (alpha > 0) picked.push({ index, alpha });
  });
  return picked.sort((a, b) => b.alpha - a.alpha).slice(0, SEA_NAMES_MAX);
}

export interface SeaNameUniforms {
  lookSeaCount: { value: number };
  /** Longitude, latitude and the cosine of latitude of the name's center, degrees; its strength. */
  lookSeaPlace: { value: Vector4[] };
  /** The baseline's cosine and sine, and atlas texels per degree. */
  lookSeaFrame: { value: Vector3[] };
  /** The name's box in the atlas: its center and half its width and height, texels. */
  lookSeaBox: { value: Vector4[] };
  lookSeaAtlas: { value: Texture };
}

/** The em in atlas texels: sharp until a name starts to fade out, at a story's pixel ratio of 1.5. */
const EM_TEXELS = 56;
/** Blank texels around each name, room for an italic's overhang, so its mips never take a
 * neighbor's ink. */
const PAD = 16;
const ATLAS_WIDTH = 2048;
/** Line spacing, in ems. */
const LEADING = 1.25;
/** Space added between letters, in ems, by style. */
const TRACKING = { ocean: 0.55, sea: 0.12 } as const;
const FONTS = {
  ocean: `400 ${EM_TEXELS}px "Libre Baskerville"`,
  sea: `italic 400 ${EM_TEXELS}px "Source Serif 4"`,
} as const;

/** A name lettered into the atlas: its box, texels. */
export interface Lettered {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The Labels layer: the names, their atlas and the uniforms the look's shader reads. Given the
 * marks' glyphs, the atlas also holds their distance fields, on shelves below the names.
 */
export class SeaNameLayer {
  readonly uniforms: SeaNameUniforms;
  /** Resolves once the atlas is lettered, or has failed to be (the names then never show). */
  readonly ready: Promise<void>;
  readonly #placed: PlacedName[];
  readonly #glyphs: GlyphSet | null;
  #boxes: Lettered[] | null = null;
  #cells: GlyphCells | null = null;

  constructor(glyphs: GlyphSet | null = null) {
    this.#glyphs = glyphs;
    const vectors = () => Array.from({ length: SEA_NAMES_MAX }, () => new Vector4());
    const frames = Array.from({ length: SEA_NAMES_MAX }, () => new Vector3());
    const blank = new DataTexture(new Uint8Array(1), 1, 1, RedFormat);
    blank.needsUpdate = true;
    this.uniforms = {
      lookSeaCount: { value: 0 },
      lookSeaPlace: { value: vectors() },
      lookSeaFrame: { value: frames },
      lookSeaBox: { value: vectors() },
      lookSeaAtlas: { value: blank },
    };
    this.#placed = SEA_NAMES.map((name) => ({ name, dir: dirOf([name.lon, name.lat]), reach: 0 }));
    this.ready = this.#letter().catch((error: unknown) => {
      console.warn('The sea names were not lettered:', error);
    });
  }

  /** Picks the names for this view and fills the uniforms; `strength` is the layer's. */
  place(view: SeaNameView, strength: number): void {
    const boxes = this.#boxes;
    if (!boxes || strength <= 0) {
      this.uniforms.lookSeaCount.value = 0;
      return;
    }
    const picked = pickSeaNames(this.#placed, view);
    const { lookSeaPlace, lookSeaFrame, lookSeaBox } = this.uniforms;
    picked.forEach(({ index, alpha }, i) => {
      const name = SEA_NAMES[index];
      const box = boxes[index];
      if (!name || !box) return;
      const angle = (name.angle ?? 0) * DEG;
      lookSeaPlace.value[i]?.set(name.lon, name.lat, Math.cos(name.lat * DEG), alpha * strength);
      lookSeaFrame.value[i]?.set(Math.cos(angle), Math.sin(angle), EM_TEXELS / name.size);
      lookSeaBox.value[i]?.set(box.x + box.w / 2, box.y + box.h / 2, box.w / 2, box.h / 2);
    });
    this.uniforms.lookSeaCount.value = picked.length;
  }

  /** The marks' glyph cells in the atlas, once it is lettered; null without glyphs. */
  get glyphCells(): GlyphCells | null {
    return this.#cells;
  }

  /** Each name's box in the atlas, texels, once it is lettered. */
  get boxes(): readonly Readonly<Lettered>[] | null {
    return this.#boxes;
  }

  dispose(): void {
    this.uniforms.lookSeaAtlas.value.dispose();
  }

  /** Loads the faces, letters every name into one canvas and makes its red channel the atlas. */
  async #letter(): Promise<void> {
    const upper = (name: SeaName) => (name.style === 'ocean' ? name.text.toUpperCase() : name.text);
    const faces = Promise.all(
      (Object.keys(FONTS) as SeaName['style'][]).map((style) => {
        const text = SEA_NAMES.filter((n) => n.style === style).map(upper);
        return document.fonts.load(FONTS[style], text.join(''));
      }),
    );
    // A face that stalls or fails never holds the story back: the names are lettered in what the
    // page has by then.
    const stalled = new Promise<false>((done) => setTimeout(done, tunables.stallHeaders, false));
    const loaded = await Promise.race([faces.then(() => true).catch(() => false), stalled]);
    if (!loaded) console.warn('The sea names are lettered before their faces loaded.');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2D canvas');

    // Each line's letters stand where the text before them ends, kerning kept, plus the tracking.
    const lettersOf = (name: SeaName) => {
      ctx.font = FONTS[name.style];
      const track = (name.tracking ?? TRACKING[name.style]) * EM_TEXELS;
      return upper(name)
        .split('\n')
        .map((line) => {
          const chars = [...line];
          const at = chars.map(
            (_, i) => ctx.measureText(chars.slice(0, i).join('')).width + i * track,
          );
          const width = ctx.measureText(line).width + (chars.length - 1) * track;
          return { chars, at, width };
        });
    };
    const layouts = SEA_NAMES.map(lettersOf);

    // Shelves across the atlas's width, the names on two lines together.
    const boxes: Lettered[] = [];
    let x = 0;
    let y = 0;
    let shelf = 0;
    const byLines = layouts.map((_, n) => n);
    byLines.sort((a, b) => (layouts[b]?.length ?? 0) - (layouts[a]?.length ?? 0));
    for (const n of byLines) {
      const lines = layouts[n] ?? [];
      const length = Math.max(...lines.map((line) => line.width));
      const w = Math.ceil(length) + 2 * PAD;
      const h = Math.ceil(lines.length * LEADING * EM_TEXELS) + 2 * PAD;
      if (x + w > ATLAS_WIDTH) {
        x = 0;
        y += shelf;
        shelf = 0;
      }
      boxes[n] = { x, y, w, h };
      x += w;
      shelf = Math.max(shelf, h);
    }
    canvas.width = ATLAS_WIDTH;
    canvas.height = y + shelf;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'alphabetic';
    SEA_NAMES.forEach((name, n) => {
      const box = boxes[n];
      const lines = layouts[n];
      if (!box || !lines) return;
      ctx.font = FONTS[name.style];
      // Each line centered, its capitals centered in its line.
      const cap = ctx.measureText('H').actualBoundingBoxAscent;
      lines.forEach((line, row) => {
        const left = box.x + (box.w - line.width) / 2;
        const middle = box.y + PAD + (row + 0.5) * LEADING * EM_TEXELS;
        line.chars.forEach((char, i) =>
          ctx.fillText(char, left + (line.at[i] ?? 0), middle + cap / 2),
        );
      });
    });

    // Only the red channel is kept, as the R8 texture's own bytes, and the canvas's pixels go. The
    // marks' glyphs follow the names on shelves of their own.
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const glyphs = this.#glyphs ? glyphShelf(this.#glyphs, ATLAS_WIDTH) : null;
    const namesHeight = canvas.height;
    const height = namesHeight + (glyphs?.height ?? 0);
    const red = new Uint8Array(canvas.width * height);
    for (let i = 0; i < canvas.width * namesHeight; i++) red[i] = data[i * 4] ?? 0;
    if (glyphs) {
      red.set(glyphs.data, ATLAS_WIDTH * namesHeight);
      const cells = new Map<string, GlyphCell>();
      for (const [name, cell] of glyphs.cells)
        cells.set(name, { ...cell, y: cell.y + namesHeight });
      this.#cells = cells;
    }
    const atlas = releaseDataAfterUpload(new DataTexture(red, canvas.width, height, RedFormat));
    canvas.width = 0;
    atlas.generateMipmaps = true;
    atlas.minFilter = LinearMipmapLinearFilter;
    atlas.magFilter = LinearFilter;
    atlas.anisotropy = 8;
    atlas.needsUpdate = true;
    this.uniforms.lookSeaAtlas.value.dispose();
    this.uniforms.lookSeaAtlas.value = atlas;
    boxes.forEach((box, n) => {
      const placed = this.#placed[n];
      const name = SEA_NAMES[n];
      if (placed && name)
        placed.reach = (Math.hypot(box.w, box.h) / 2 / (EM_TEXELS / name.size)) * DEG;
    });
    this.#boxes = boxes;
  }
}
