// The look's state names (streaming.md 3.3, Names; owner decision 44): each border step's names as
// the names stage placed them, cut into the globe by the look's own fragment shader
// (stateNames.glsl.ts), wherever and however strongly the borders draw (borders/clockBorders.ts).
//
// Each frame, with the draw's own matrices (the look's onBeforeRender, after the sea names and the
// marks), the layer takes the names of the steps the borders draw: of a preview the outer names
// alone, an inner name waiting for its step to stream in. A name shows by its em on screen, its em
// drawn no larger than its plane's cap (tunables.namePx), toward the limb, with the inner lines
// for an inner name, and in the borders' dissolve: a name both steps hold stays, another dissolves
// out or in with its step. A region shows one form and level of its name (namePlacing.ts), names
// give way to stronger ones and stand clear of the marks, the sea names and what the modes ask
// them to avoid (avoid: a walk's callouts, Explore's plates), each fading in or out over
// tunables.nameFade as it comes or goes. The names drawn are binned into 32 CSS px screen tiles,
// at most tunables.nameTileCap a tile, each name into every tile its footprint reaches or none.
// One RGBA32F table (512×21, 168 KiB) holds the tiles' ranges, their slots, four texels a name and
// a texel a letter, its pen's place along the baseline and its glyph's cell; it exists only while
// names are drawn, and is uploaded only when what is drawn changed.
import {
  DataTexture,
  FloatType,
  Matrix4,
  NearestFilter,
  RGBAFormat,
  Vector3,
  Vector4,
  type Material,
} from 'three';
import type { BordersDrawn } from '../borders/clockBorders';
import type { StepNames } from '../borders/clockNames';
import { tunables } from '../config/tunables';
import type { Params } from '../contract';
import { NAME_FLAG, type NamesChunk } from '../data/names';
import type { PlacedMark } from '../marks/marks';
import type { MemoryAccount } from '../perf/memory';
import { dirOf, tangents } from '../story/effects/geo';
import { smoothstep } from '../story/effects/timeline';
import type { NameGlyphs, NamePlane } from './nameGlyphs';
import { layoutName, NAME_CAP_EM, type NameLetters } from './nameLayout';
import {
  binFootprints,
  chooseInRegion,
  keepApart,
  nameGrid,
  sizeFade,
  type Contender,
  type Footprint,
  type Obstacles,
  type RegionChoice,
} from './namePlacing';
import {
  NAME_LETTER_ROW,
  NAME_LETTERS_MAX,
  NAME_LOOK,
  NAME_ROW,
  NAME_SLOT_ROW,
  NAME_SLOTS_MAX,
  NAME_TABLE_ROWS,
  NAME_TABLE_WIDTH,
  NAME_TEXELS,
  NAME_TILE_COUNT_MAX,
  NAME_TILES_MAX,
  NAMES_MAX,
} from './stateNames.glsl';

const DEG = Math.PI / 180;
/** A screen tile's side, CSS px, doubled on a screen with more tiles than the table holds. */
const TILE_PX = 32;
/** The least facing a name is drawn at: the limb fade leaves nothing below it. */
const FACING_MIN = 0.05;
/** How far apart, as a share of the screen's diagonal, two copies of one name stand. */
const COPIES_APART = 0.5;
/** The faintest name drawn, and the faintest that holds its place against others. */
const ALPHA_MIN = 1 / 255;
/** A footprint disc's reach: half the capitals and the calm band, ems. */
const REACH_EM = 0.5 * NAME_CAP_EM + NAME_LOOK.band;
/**
 * How far from its middle line the look may draw a name, ems: its capitals, the marks above them
 * (Vietnamese's reach 0.28 em higher), and the band and rim about those, which its tiles cover.
 */
const DRAW_REACH_EM = 1;
/** The share of it the letters fill, a twentieth of an em past the capitals: what obstacles clear. */
const LETTERS_CORE = (0.5 * NAME_CAP_EM + 0.05) / REACH_EM;
/** The steps whose names' places stay worked out, and the layouts kept, before older ones go. */
const STEPS_KEPT = 4;
const LAYOUTS_KEPT = 2048;

/** What the names follow: the borders' runtime (clockBorders.ts). */
export interface NamesSource {
  readonly drawn: BordersDrawn;
  namesAt(step: number): StepNames | null;
}

/** The draw the names are placed for, in the globe frame (radius 1). */
export interface NameView {
  camera: Vector3;
  /** CSS px a length spans at unit distance in front of the camera. */
  pxPerUnit: number;
  /** The viewport in CSS px, and the device pixels a CSS px spans as the globe is drawn. */
  width: number;
  height: number;
  pixelRatio: number;
  /** The globe frame to clip space, lens offset included. */
  toClip: Matrix4;
}

/** A box no name may stand over, CSS px. */
export interface NameBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface NameUniforms {
  lookNamesOn: { value: boolean };
  lookNameTable: { value: DataTexture };
  lookNameClip: { value: Matrix4 };
  lookNameGrid: { value: Vector4 };
  lookNamePixelRatio: { value: number };
  lookNameMask: { value: number };
}

/** A name as the last draw drew it, for scripts and tests. */
export interface NameShown {
  text: string;
  plane: NamePlane;
  level: number;
  short: boolean;
  alpha: number;
  /** Its em on screen as drawn, CSS px, and its own before the cap. */
  emPx: number;
  naturalPx: number;
  /** Its footprint's box on screen, CSS px. */
  box: [number, number, number, number];
}

export interface NamesShown {
  /** The steps the names come from: the borders' dissolving out and in. */
  steps: (number | null)[];
  /** Names in the running this frame, and those drawn. */
  candidates: number;
  drawn: NameShown[];
}

/** A placement at a step, its place worked out once. */
interface Entry {
  /** Equal placements in two steps share it, and dissolve as one. */
  id: string;
  /** Its name and plane, which its copies and its other steps' placements share. */
  name: string;
  /** Its region: a region shows one form and level of its name at a time. */
  region: string;
  plane: NamePlane;
  level: number;
  short: boolean;
  km2: number;
  text: string;
  dir: Vector3;
  axis: Vector3;
  /** The face's em, radians, and its span in its ems. */
  emRad: number;
  spanEm: number;
}

/** A name in the running this frame. */
interface Candidate {
  entry: Entry;
  /** The steps it is drawn from (1 the one dissolving out, 2 the one dissolving in), its share of them. */
  sources: number;
  weight: number;
  emPx: number;
  facing: number;
  alpha: number;
  letters: NameLetters | null;
  /** Its em as drawn, radians, and its footprint on screen. */
  drawnEm: number;
  footprint: Footprint | null;
  distanceToMiddle: number;
}

/** The table while names are drawn: its texels, the next draw's staged beside them, its texture. */
interface Table {
  data: Float32Array;
  next: Float32Array;
  texture: DataTexture;
}

/** The dev panel's params (the Names folder). */
export function defaultNameParams(): Params {
  return {
    // Off skips the look's names entirely: the GPU time's baseline.
    names: true,
    // Draws the letters' floor flat magenta, for measuring their contrast against the ground.
    namesMask: false,
  };
}

export class StateNameLayer {
  readonly uniforms: NameUniforms;
  readonly params: Params = defaultNameParams();
  readonly #glyphs: () => NameGlyphs | null;
  readonly #marks: () => readonly PlacedMark[];
  readonly #seaBoxes: () => readonly NameBox[];
  readonly #blank: DataTexture;
  readonly #now: () => number;
  #source: NamesSource | null = null;
  #table: Table | null = null;
  #extent = [0, 0, 0, 0];
  readonly #avoid = new Map<string, readonly NameBox[]>();
  /** Each step's placements, by its chunk and index there, the most recently used last. */
  readonly #entries = new Map<string, { chunk: NamesChunk; entries: Entry[] }>();
  readonly #layouts = new Map<string, NameLetters | null>();
  #choices = new Map<string, RegionChoice>();
  /** Each name's fade, 0 to 1, by id: toward 1 while it keeps its place, toward 0 once it gives way. */
  #fades = new Map<string, number>();
  #kept = new Set<string>();
  #last: number | null = null;
  #shown: NamesShown = { steps: [], candidates: 0, drawn: [] };

  /**
   * `glyphs` gives the names' glyphs once the look has lettered them; `marks` the marks the last
   * draw placed, and `seaBoxes` the sea names', which the names stand clear of.
   */
  constructor(
    glyphs: () => NameGlyphs | null,
    marks: () => readonly PlacedMark[],
    seaBoxes: () => readonly NameBox[],
    now: () => number = () => performance.now(),
  ) {
    this.#glyphs = glyphs;
    this.#marks = marks;
    this.#seaBoxes = seaBoxes;
    this.#now = now;
    this.#blank = floatTexture(new Float32Array(4), 1, 1);
    this.uniforms = {
      lookNamesOn: { value: false },
      lookNameTable: { value: this.#blank },
      lookNameClip: { value: new Matrix4() },
      lookNameGrid: { value: new Vector4(1, 1, TILE_PX, 1) },
      lookNamePixelRatio: { value: 1 },
      lookNameMask: { value: 0 },
    };
  }

  /** The borders' runtime the names follow, where the release names the names. */
  follow(source: NamesSource): void {
    this.#source = source;
  }

  /** Boxes on screen, CSS px, that no name may stand over, by source; none removes the source's. */
  avoid(source: string, boxes: readonly NameBox[]): void {
    if (boxes.length === 0) this.#avoid.delete(source);
    else this.#avoid.set(source, boxes);
  }

  /** What the last draw drew. */
  get shown(): NamesShown {
    return this.#shown;
  }

  /** The names' glyphs, once the look has written them into its atlas; null until then. */
  get glyphs(): NameGlyphs | null {
    return this.#glyphs();
  }

  /** Picks, fades and bins the names for this draw, and packs the table if anything changed. */
  place(view: NameView): void {
    const now = this.#now();
    const dtMs = this.#last === null ? 0 : Math.min(100, Math.max(0, now - this.#last));
    this.#last = now;
    this.uniforms.lookNameClip.value.copy(view.toClip);
    this.uniforms.lookNamePixelRatio.value = view.pixelRatio;
    this.uniforms.lookNameMask.value = this.params.namesMask === true ? 1 : 0;
    const glyphs = this.#glyphs();
    const source = this.#source;
    const drawn = source?.drawn;
    if (!glyphs || !source || !drawn || this.params.names !== true || drawn.strength <= 0) {
      this.#off(drawn);
      return;
    }
    const candidates = this.#candidates(source, drawn, view);
    if (candidates.length === 0) {
      this.#off(drawn);
      return;
    }
    for (const c of candidates) this.#lay(c, glyphs, view);
    const inView = candidates.filter((c) => c.footprint !== null && c.letters !== null);
    inView.sort(byPriority);
    const apart = COPIES_APART * Math.hypot(view.width, view.height);
    const kept = keepApart(
      inView
        .filter((c) => c.alpha >= 0.05)
        .map((c): Contender => ({
          id: c.entry.id,
          name: c.entry.name,
          sources: c.sources,
          footprint: c.footprint as Footprint,
          core: LETTERS_CORE,
          kept: this.#kept.has(c.entry.id),
        })),
      this.#obstacles(),
      apart,
    );
    // Each name's fade toward whether it keeps its place, over nameFade.
    const fades = new Map<string, number>();
    const step = dtMs / tunables.nameFade;
    const drawable: { c: Candidate; alpha: number }[] = [];
    for (const c of inView) {
      const was = this.#fades.get(c.entry.id) ?? 0;
      const fade = Math.min(1, Math.max(0, was + (kept.has(c.entry.id) ? step : -step)));
      fades.set(c.entry.id, fade);
      const alpha = c.alpha * smoothstep(0, 1, fade);
      if (alpha >= ALPHA_MIN) drawable.push({ c, alpha });
    }
    this.#fades = fades;
    this.#kept = kept;
    this.#pack(drawable, view, candidates.length, drawn);
  }

  /** The table and its staging while names are drawn; nothing, but the owner's row, otherwise. */
  inspectMemory(account: MemoryAccount): void {
    account.array('names.layer', null);
    if (!this.#table) return;
    account.texture('names.layer', this.#table.texture);
    account.array('names.layer', this.#table.next);
  }

  dispose(): void {
    this.#source = null;
    this.#release();
    this.#blank.dispose();
  }

  /** The names' places at the steps the borders draw, faded by the view: the names in the running. */
  #candidates(source: NamesSource, drawn: BordersDrawn, view: NameView): Candidate[] {
    const merged = new Map<string, Candidate>();
    const choices = new Map<string, RegionChoice>();
    const sources = [
      { drawn: drawn.from, weight: 1 - drawn.mix, bit: 1 },
      { drawn: drawn.to, weight: drawn.mix, bit: 2 },
    ];
    const middle = [view.width / 2, view.height / 2];
    for (const { drawn: step, weight, bit } of sources) {
      if (!step || weight <= 0) continue;
      const names = source.namesAt(step.step);
      if (!names) continue;
      const regions = new Map<string, { entry: Entry; emPx: number; facing: number }[]>();
      for (const entry of this.#entriesOf(names)) {
        // Of a preview, the outer names alone: an inner name waits for its step's own field.
        if (step.preview && entry.plane === 'inner') continue;
        const facing = facingOf(entry.dir, view.camera);
        // A region chooses among its names near the view: a window far off the screen, smaller
        // there, must not hold a level the screen's own windows have grown out of.
        if (facing < FACING_MIN || !nearView(entry.dir, view)) continue;
        const emPx = (entry.emRad * view.pxPerUnit) / view.camera.distanceTo(entry.dir);
        const list = regions.get(entry.region);
        if (list) list.push({ entry, emPx, facing });
        else regions.set(entry.region, [{ entry, emPx, facing }]);
      }
      for (const [region, list] of regions) {
        const plane = list[0]?.entry.plane ?? 'outer';
        const size = tunables.namePx[plane];
        const choice = chooseInRegion(
          list.map(({ entry, emPx }) => ({
            level: entry.level,
            short: entry.short,
            emPx,
            reveal: sizeFade(emPx, size),
          })),
          tunables.nameFullPx[plane],
          choices.get(region) ?? this.#choices.get(region),
        );
        if (!choice) continue;
        choices.set(region, choice);
        for (const { entry, emPx, facing } of list) {
          if (entry.level !== choice.level || entry.short !== choice.short) continue;
          const held = merged.get(entry.id);
          if (held) {
            held.sources |= bit;
            held.weight = Math.min(1, held.weight + weight);
            continue;
          }
          merged.set(entry.id, {
            entry,
            sources: bit,
            weight,
            emPx,
            facing,
            alpha: 0,
            letters: null,
            drawnEm: entry.emRad,
            footprint: null,
            distanceToMiddle: Infinity,
          });
        }
      }
    }
    this.#choices = choices;
    const found: Candidate[] = [];
    for (const c of merged.values()) {
      const size = tunables.namePx[c.entry.plane];
      c.alpha =
        c.weight *
        sizeFade(c.emPx, size) *
        smoothstep(0.05, 0.3, c.facing) *
        (c.entry.plane === 'inner' ? drawn.inner : 1) *
        drawn.strength;
      if (c.alpha < ALPHA_MIN) continue;
      clip.set(c.entry.dir.x, c.entry.dir.y, c.entry.dir.z, 1).applyMatrix4(view.toClip);
      if (clip.w > 0) {
        const x = (clip.x / clip.w / 2 + 0.5) * view.width;
        const y = (0.5 - clip.y / clip.w / 2) * view.height;
        c.distanceToMiddle = Math.hypot(x - (middle[0] ?? 0), y - (middle[1] ?? 0));
      }
      found.push(c);
    }
    return found;
  }

  /** A candidate's letters, its em as drawn and its footprint on screen; none off screen. */
  #lay(c: Candidate, glyphs: NameGlyphs, view: NameView): void {
    const { entry } = c;
    c.letters = this.#layout(entry, glyphs);
    if (!c.letters) return;
    const size = tunables.namePx[entry.plane];
    const cap = Math.min(1, size.cap / Math.max(c.emPx, 1e-6));
    c.drawnEm = entry.emRad * c.letters.scale * cap;
    const half = c.letters.length / 2;
    const reachEm = REACH_EM;
    const discs = Math.max(2, Math.ceil((2 * half) / reachEm)) + 1;
    const footprint = new Float64Array(3 * discs);
    let onScreen = false;
    for (let k = 0; k < discs; k++) {
      const u = (-half + (2 * half * k) / (discs - 1)) * c.drawnEm;
      point.copy(entry.dir).multiplyScalar(Math.cos(u)).addScaledVector(entry.axis, Math.sin(u));
      clip.set(point.x, point.y, point.z, 1).applyMatrix4(view.toClip);
      if (clip.w <= 0) return;
      const x = (clip.x / clip.w / 2 + 0.5) * view.width;
      const y = (0.5 - clip.y / clip.w / 2) * view.height;
      const r = (reachEm * c.drawnEm * view.pxPerUnit) / view.camera.distanceTo(point);
      footprint[3 * k] = x;
      footprint[3 * k + 1] = y;
      footprint[3 * k + 2] = r;
      if (x > -r && x < view.width + r && y > -r && y < view.height + r) onScreen = true;
    }
    if (onScreen) c.footprint = footprint;
  }

  /** The step's placements, their places worked out once. */
  #entriesOf(names: StepNames): Entry[] {
    const key = `${names.number}:${names.index}`;
    const held = this.#entries.get(key);
    if (held?.chunk === names.chunk) {
      this.#entries.delete(key);
      this.#entries.set(key, held);
      return held.entries;
    }
    const entries = entriesAt(names);
    this.#entries.delete(key);
    this.#entries.set(key, { chunk: names.chunk, entries });
    for (const old of this.#entries.keys()) {
      if (this.#entries.size <= STEPS_KEPT) break;
      this.#entries.delete(old);
    }
    return entries;
  }

  #layout(entry: Entry, glyphs: NameGlyphs): NameLetters | null {
    const key = `${entry.plane}|${entry.text}|${entry.spanEm}`;
    if (this.#layouts.has(key)) return this.#layouts.get(key) ?? null;
    const letters = layoutName(entry.text, entry.plane, entry.spanEm, glyphs[entry.plane]);
    if (!letters) console.warn(`The state name '${entry.text}' has a letter with no glyph.`);
    if (this.#layouts.size >= LAYOUTS_KEPT) this.#layouts.clear();
    this.#layouts.set(key, letters);
    return letters;
  }

  /** What no name stands over: the marks drawn, the sea names and the modes' boxes. */
  #obstacles(): Obstacles {
    const discs = this.#marks()
      .filter((mark) => mark.alpha >= 0.1)
      .map((mark) => ({ x: mark.x, y: mark.y, r: mark.rPx }));
    const boxes = [...this.#seaBoxes(), ...[...this.#avoid.values()].flat()];
    return { discs, boxes };
  }

  /** Bins the names drawn into the tiles and packs the table (stateNames.glsl.ts). */
  #pack(
    drawable: { c: Candidate; alpha: number }[],
    view: NameView,
    candidates: number,
    drawn: BordersDrawn,
  ): void {
    const chosen: { c: Candidate; alpha: number }[] = [];
    let letters = 0;
    for (const item of drawable) {
      const count = item.c.letters?.letters.length ?? 0;
      if (chosen.length >= NAMES_MAX || letters + count > NAME_LETTERS_MAX) break;
      chosen.push(item);
      letters += count;
    }
    const grid = nameGrid(view.width, view.height, TILE_PX, NAME_TILES_MAX);
    const bins = binFootprints(
      chosen.map(({ c }) => c.footprint as Footprint),
      grid,
      Math.min(tunables.nameTileCap, NAME_TILE_COUNT_MAX),
      NAME_SLOTS_MAX,
      DRAW_REACH_EM / REACH_EM,
    );
    const table = (this.#table ??= this.#allocate());
    const next = table.next;
    const ranges = Math.ceil(bins.counts.length / 4) * 4;
    next.fill(0, 0, ranges);
    bins.counts.forEach(
      (count, t) => (next[t] = (bins.starts[t] ?? 0) * (NAME_TILE_COUNT_MAX + 1) + count),
    );
    const slotBase = NAME_SLOT_ROW * NAME_TABLE_WIDTH * 4;
    const slotFloats = Math.ceil(bins.slots.length / 4) * 4;
    next.fill(0, slotBase, slotBase + slotFloats);
    bins.slots.forEach((n, slot) => (next[slotBase + slot] = n));
    const nameBase = NAME_ROW * NAME_TABLE_WIDTH * 4;
    const letterBase = NAME_LETTER_ROW * NAME_TABLE_WIDTH * 4;
    let letter = 0;
    const shown: NameShown[] = [];
    chosen.forEach(({ c, alpha }, n) => {
      const { entry } = c;
      const laid = c.letters as NameLetters;
      const half = laid.length / 2;
      // The least cosine from the anchor the look draws it at: its tiles' reach about its letters.
      const reach = Math.hypot(half + DRAW_REACH_EM, DRAW_REACH_EM) * c.drawnEm;
      const at = nameBase + n * NAME_TEXELS * 4;
      next.set([entry.dir.x, entry.dir.y, entry.dir.z, alpha], at);
      next.set([entry.axis.x, entry.axis.y, entry.axis.z, c.drawnEm], at + 4);
      next.set([half, laid.track, letter, laid.letters.length], at + 8);
      next.set([Math.cos(Math.min(Math.PI, reach * 1.05 + 1e-4)), 0, 0, 0], at + 12);
      for (const { glyph, u } of laid.letters) {
        next.set([u, glyph.x, glyph.y, glyph.advance], letterBase + letter * 4);
        letter += 1;
      }
      if (bins.binned[n] !== 1) return;
      const footprint = c.footprint as Footprint;
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (let i = 0; i < footprint.length; i += 3) {
        const [x, y, r] = [footprint[i] ?? 0, footprint[i + 1] ?? 0, footprint[i + 2] ?? 0];
        [x0, y0, x1, y1] = [
          Math.min(x0, x - r),
          Math.min(y0, y - r),
          Math.max(x1, x + r),
          Math.max(y1, y + r),
        ];
      }
      const naturalPx = c.emPx;
      shown.push({
        text: entry.text,
        plane: entry.plane,
        level: entry.level,
        short: entry.short,
        alpha,
        emPx: naturalPx * (c.drawnEm / entry.emRad),
        naturalPx,
        box: [x0, y0, x1, y1],
      });
    });
    const extent = [ranges, slotFloats, chosen.length * NAME_TEXELS * 4, letter * 4];
    const spans: [number, number][] = [
      [0, ranges],
      [slotBase, slotBase + slotFloats],
      [nameBase, nameBase + (extent[2] ?? 0)],
      [letterBase, letterBase + (extent[3] ?? 0)],
    ];
    const changed =
      extent.some((value, i) => value !== this.#extent[i]) ||
      spans.some(([from, to]) => !same(table.data, next, from, to));
    if (changed) {
      for (const [from, to] of spans) table.data.set(next.subarray(from, to), from);
      this.#extent = extent;
      table.texture.needsUpdate = true;
    }
    const { lookNameGrid, lookNamesOn } = this.uniforms;
    lookNameGrid.value.set(view.width, view.height, bins.tilePx, bins.across);
    lookNamesOn.value = shown.length > 0;
    this.#shown = {
      steps: [drawn.from?.step ?? null, drawn.to?.step ?? null],
      candidates,
      drawn: shown,
    };
  }

  /** Nothing drawn: the table goes, and with it the names' fades and choices. */
  #off(drawn: BordersDrawn | undefined): void {
    this.#release();
    this.#fades.clear();
    this.#kept.clear();
    this.#choices.clear();
    this.#shown = {
      steps: drawn ? [drawn.from?.step ?? null, drawn.to?.step ?? null] : [],
      candidates: 0,
      drawn: [],
    };
  }

  #allocate(): Table {
    const data = new Float32Array(NAME_TABLE_WIDTH * NAME_TABLE_ROWS * 4);
    const texture = floatTexture(data, NAME_TABLE_WIDTH, NAME_TABLE_ROWS);
    this.#extent = [0, 0, 0, 0];
    this.uniforms.lookNameTable.value = texture;
    return { data, next: new Float32Array(data.length), texture };
  }

  /**
   * Drops the table, the steps' places and the names' layouts: the look reads the blank, and draws
   * no names.
   */
  #release(): void {
    this.uniforms.lookNamesOn.value = false;
    this.#entries.clear();
    this.#layouts.clear();
    if (!this.#table) return;
    this.uniforms.lookNameTable.value = this.#blank;
    this.#table.texture.dispose();
    this.#table = null;
  }
}

const clip = new Vector4();
const point = new Vector3();
const toCamera = new Vector3();

/** The outer plane first; a region's own name before another's window; the larger region first. */
function byPriority(a: Candidate, b: Candidate): number {
  const rank = (c: Candidate) => (c.entry.plane === 'inner' ? 2 : 0) + (c.entry.level > 0 ? 1 : 0);
  return rank(a) - rank(b) || b.entry.km2 - a.entry.km2 || a.distanceToMiddle - b.distanceToMiddle;
}

/** Whether a place stands on screen or within half the screen of its edges. */
function nearView(dir: Vector3, view: NameView): boolean {
  clip.set(dir.x, dir.y, dir.z, 1).applyMatrix4(view.toClip);
  return clip.w > 0 && Math.abs(clip.x) < 2 * clip.w && Math.abs(clip.y) < 2 * clip.w;
}

/** The cosine between the globe's normal at `dir` and the way to the camera. */
function facingOf(dir: Vector3, camera: Vector3): number {
  toCamera.copy(camera).sub(dir);
  const length = toCamera.length();
  return length === 0 ? 0 : dir.dot(toCamera) / length;
}

/** A step's placements: those of its chunk whose run of steps holds it. */
export function entriesAt({ chunk, number, index }: StepNames): Entry[] {
  const entries: Entry[] = [];
  for (let k = 0; k < chunk.count; k++) {
    if ((chunk.s0[k] ?? 0) > index || (chunk.s1[k] ?? -1) < index) continue;
    const flags = chunk.flags[k] ?? 0;
    const plane: NamePlane = (flags & NAME_FLAG.inner) !== 0 ? 'inner' : 'outer';
    const short = (flags & NAME_FLAG.short) !== 0;
    const level = flags >> NAME_FLAG.levelShift;
    const which = chunk.name[k] ?? 0;
    const full = chunk.full[which] ?? '';
    const text = short ? (chunk.short[which] ?? full) : full;
    const [lon, lat] = [chunk.lon[k] ?? 0, chunk.lat[k] ?? 0];
    const [angle, em, span] = [chunk.angle[k] ?? 0, chunk.em[k] ?? 0, chunk.span[k] ?? 0];
    const { east, north } = tangents([lon, lat]);
    const axis = east
      .multiplyScalar(Math.cos(angle * DEG))
      .addScaledVector(north, Math.sin(angle * DEG));
    entries.push({
      id: `${plane}|${short ? 's' : 'f'}|${level}|${full}|${lon}|${lat}|${angle}|${em}|${span}`,
      name: `${plane}|${full}`,
      region: `${number}:${chunk.group[k] ?? 0}`,
      plane,
      level,
      short,
      km2: chunk.km2[k] ?? 0,
      text,
      dir: dirOf([lon, lat]),
      axis,
      emRad: em * DEG,
      spanEm: em > 0 ? span / em : 0,
    });
  }
  return entries;
}

/** A float RGBA texture the look reads texel by texel. */
function floatTexture(data: Float32Array, width: number, height: number): DataTexture {
  const texture = new DataTexture(data, width, height, RGBAFormat, FloatType);
  texture.minFilter = texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function same(a: Float32Array, b: Float32Array, from: number, to: number): boolean {
  for (let i = from; i < to; i++) if (a[i] !== b[i]) return false;
  return true;
}

const registry = new WeakMap<Material, StateNameLayer>();

export function registerStateNames(material: Material, layer: StateNameLayer): void {
  registry.set(material, layer);
}

/** The state names of a surface look's material, where the look draws them. */
export function stateNamesOf(material: Material): StateNameLayer | undefined {
  return registry.get(material);
}
