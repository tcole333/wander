// Marks on the globe (docs/design/globe-language.md, Channels and materials): places the look cuts
// into its own bronze (marks.glsl.ts), so they take the lamp, the shadows, the polish and the
// ridges' occlusion as the relief does, with no program, light or draw of their own.
//
// Any layer hands its marks over as data, by source: look.marks.set('events', specs). Each frame,
// with the draw's own matrices (the look's onBeforeRender, beside the sea names), place() sizes
// the marks for the view (tunables.markPx: one size at a given scale), fades them toward the limb,
// and bins each mark's screen disc, widened by its contact shadow, its ember or its hovered ring,
// into 32 CSS px tiles, at most tunables.markTileCap a tile, focal first, then hovered, then by
// score. One RGBA32F table holds the tiles' ranges, one texel per tile listing (its mark's screen
// disc and index) and three texels a mark; it is uploaded only when the view or a fade changed, and
// exists only while some layer has marks set.
import {
  Color,
  DataTexture,
  FloatType,
  Matrix3,
  Matrix4,
  NearestFilter,
  RGBAFormat,
  Vector3,
  Vector4,
} from 'three';
import { tunables } from '../config/tunables';
import type { Params } from '../contract';
import type { ClearanceField } from '../globe/clearance';
import type { MemoryAccount } from '../perf/memory';
import { EMBER } from '../story/effects/ember';
import { dirOf, EARTH_KM, EARTH_M, tangents } from '../story/effects/geo';
import { smoothstep } from '../story/effects/timeline';
import type { LonLat } from '../story/story';
import {
  FAMILIES,
  familyUniforms,
  FAMILY_VEC4S,
  PACES,
  type MarkVariant,
  type Pace,
  type Treatment,
} from './families';
import { GLYPH_CELL, type GlyphCell } from './glyphAtlas';
import {
  EMBER_RING,
  FAMILY_STEP,
  FLAG,
  GLYPH_FIELD,
  MARK_AA_PX,
  MARK_ROW,
  MARK_TEXELS,
  MARKS_MAX,
  PAD_TILES,
  RING_PX,
  SHADOW_BLUR,
  SLOT_ROW,
  SLOTS_MAX,
  TABLE_ROWS,
  TABLE_WIDTH,
  TILE_COUNT_MAX,
  TILES_MAX,
} from './marks.glsl';

/** A mark as a layer hands it over. */
export interface MarkSpec {
  id: string;
  at: LonLat;
  /** A name in the look's glyph set (glyphs.ts). */
  glyph: string;
  pace: Pace;
  /** The mark's own fade, 0 to 1. */
  opacity: number;
  /** The active event: its ember ring, the only mark bright enough to bloom. */
  focal?: boolean;
  hover?: boolean;
  /** An expanded parent: its glyph as an outline. */
  hollow?: boolean;
  /** An inherited or derived place, or a date known only to the year: a softer edge, half relief. */
  soft?: boolean;
  /** Its glyph drawn mirrored east to west: a storm's south of the equator (eventSymbols.ts). */
  mirror?: boolean;
  /**
   * An expanded parent's extent, radians of arc: a dashed engraved ring while it is hovered. Rings
   * wider than RING_MAX_RAD (about 5,000 km) are drawn at that.
   */
  ringRad?: number;
  /** Orders marks in a crowded tile after focal and hovered ones: higher first. */
  score?: number;
}

/** A mark as place() last drew it: its place and radius on screen, in CSS px, and its fade. */
export interface PlacedMark {
  id: string;
  x: number;
  y: number;
  rPx: number;
  /** Its opacity, 0 to 1: its own, the mode's and the limb's. */
  alpha: number;
}

/** The draw the marks are placed for, in the globe frame (radius 1). */
export interface MarkView {
  camera: Vector3;
  /** The camera's forward direction. */
  forward: Vector3;
  /** CSS px a length spans at unit distance in front of the camera. */
  pxPerUnit: number;
  /** The viewport in CSS px, and the device pixels a CSS px spans as the globe is drawn. */
  width: number;
  height: number;
  pixelRatio: number;
  /** The globe frame to clip space, lens offset included. */
  toClip: Matrix4;
  /** The globe frame to view space, for normals. */
  toView: Matrix3;
  /** The lamp's position. */
  lamp: Vector3;
  /** The relief's exaggeration, for picking over land. */
  kLand: number;
}

export interface MarkUniforms {
  lookMarksOn: { value: boolean };
  lookMarkTable: { value: DataTexture };
  lookMarkClip: { value: Matrix4 };
  lookMarkView: { value: Matrix3 };
  lookMarkGrid: { value: Vector4 };
  lookMarkFamily: { value: Vector4[] };
  lookMarkStyle: { value: Vector4 };
  lookMarkEmber: { value: Vector4 };
  lookMarkBreath: { value: number };
  lookMarkPolish: { value: number };
  lookMarkEngrave: { value: Color };
}

/** The glyphs' cells in the look's atlas: each one's top-left texel and its glyph's extent. */
export type GlyphCells = ReadonlyMap<string, GlyphCell>;

/** A screen tile's side in CSS px, doubled on a screen with more tiles than the table holds. */
const TILE_PX = 32;
/** The focal ring's color, linear. */
const EMBER_COLOR = new Color(EMBER);
/** The focal ring's strength over its color, so it lands well above the bloom's threshold. */
const EMBER_STRENGTH = 6;
/** The ember's breath: its period in seconds and its depth. */
const BREATH = { period: 3.2, depth: 0.2 } as const;
/** The contact shadow's reach, in r, however low the lamp. */
const SHADOW_MAX = 0.6;
/** A cast token's thickness, in r, for its contact shadow: its bevel's height shapes only light. */
const TOKEN_THICKNESS = 0.45;
/** The widest hovered ring drawn, radians of arc from its mark: an eighth of the globe's round. */
export const RING_MAX_RAD = Math.PI / 4;
/** The least facing a mark is drawn at: the limb fade leaves nothing below it. */
const FACING_MIN = 0.05;
/** How near its anchor, as a cosine, the look looks for a mark without a ring: about 26 degrees. */
const MARK_COS_MIN = 0.9;
/** The least opacity a mark is picked at: fainter, toward the limb or fading, it is let be. */
const PICK_ALPHA_MIN = 0.25;

/**
 * A mark's diameter in CSS px for a view `viewKm` wide (tunables.markPx), drawn at `pixelRatio`
 * device pixels a CSS px: never fewer than tunables.markMinDevicePx device pixels.
 */
export function markPx(viewKm: number, pixelRatio: number): number {
  return Math.max(markRowPx(viewKm), tunables.markMinDevicePx / Math.max(pixelRatio, 1e-3));
}

/** tunables.markPx's diameter for a view `viewKm` wide, log-interpolated between its rows. */
function markRowPx(viewKm: number): number {
  const rows = tunables.markPx;
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (!first || !last) return 16;
  if (!(viewKm > first.km)) return first.px;
  if (viewKm >= last.km) return last.px;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    if (!a || !b || viewKm > b.km) continue;
    const t = Math.log(viewKm / a.km) / Math.log(b.km / a.km);
    return a.px + (b.px - a.px) * t;
  }
  return last.px;
}

/**
 * How far from its anchor, in CSS px, the look draws a mark (marks.glsl.ts) whose r spans at most
 * `pxPerR` CSS px on screen and a pixel at most `pxR` of r: its glyph out to its field's reach
 * (`glyphExtent` is the glyph's, in half grids); its disc, contact shadow (`shadow` r from it),
 * ember and hovered ring (`ringPx` px from it on screen), each with the antialiasing, blur or line
 * the look gives it and the light's cap two edges beyond.
 */
export function markReachPx(
  treatment: Treatment,
  mark: Pick<MarkSpec, 'soft' | 'focal'>,
  glyphExtent: number,
  shadow: number,
  ringPx: number,
  pxPerR: number,
  pxR: number,
): number {
  const edge = mark.soft ? MARK_AA_PX.soft : MARK_AA_PX.hard;
  const glyph = Math.min(glyphExtent + GLYPH_FIELD.reach, GLYPH_FIELD.box * Math.SQRT2);
  let reach = glyph * treatment.glyph.scale * pxPerR;
  const disc = treatment.disc?.radius ?? 0;
  if (disc > 0) reach = Math.max(reach, disc * pxPerR + 2 * edge);
  if (disc > 0 && treatment.shadow) {
    reach = Math.max(reach, (shadow + disc + SHADOW_BLUR) * pxPerR + 2 * edge);
  }
  if (mark.focal) {
    const half = Math.max(EMBER_RING.half, RING_PX.ember * pxR);
    reach = Math.max(reach, (EMBER_RING.radius + half + pxR) * pxPerR);
  }
  if (ringPx > 0) reach = Math.max(reach, ringPx + RING_PX.hover * pxR * pxPerR);
  return reach + 1;
}

const toCamera = new Vector3();

/** The cosine between the globe's normal at `dir` and the way to the camera at `camera`. */
function facingOf(dir: Vector3, camera: Vector3): number {
  toCamera.copy(camera).sub(dir);
  const length = toCamera.length();
  return length === 0 ? 0 : dir.dot(toCamera) / length;
}

/** How far a mark at `dir` faces the camera at `camera`: its limb fade (as the sea names'). */
export function limbFade(dir: Vector3, camera: Vector3): number {
  return smoothstep(0.05, 0.35, facingOf(dir, camera));
}

/** The dev panel's params (the Marks folder), and the query's (?markVariant=2, ?marks=0). */
export function defaultMarkParams(): Params {
  return {
    // Off skips the look's marks entirely: the GPU time's baseline.
    marks: true,
    // 0, the cast token (families.ts).
    markVariant: 0,
    // The mark's size over tunables.markPx and markMinDevicePx.
    markSize: 1,
    // A disc's bevel as a share of its radius (a glyph's is a quarter of it, or a pixel), and the
    // relief's height over the family's.
    markBevel: 0.4,
    markRelief: 1,
    // How much of their own colors the marks take, and how polished they are.
    markFill: 1,
    markPolish: 1,
    // A glow of the glyph's own color, under the bloom's threshold (at most 0.4).
    markGlow: 0,
    // The focal ember's strength.
    markEmber: 1,
  };
}

interface Entry {
  spec: MarkSpec;
  dir: Vector3;
  east: Vector3;
  family: number;
}

interface Candidate {
  entry: Entry;
  x: number;
  y: number;
  /** Its radius and its reach, CSS px, and its radius at sea level in globe radii. */
  rPx: number;
  reachPx: number;
  r: number;
  alpha: number;
  shadowX: number;
  shadowY: number;
  ring: number;
  /** The least cosine from its anchor at which it still draws. */
  cosMin: number;
}

/** The screen's tiles: their side, the grid's reach past each edge of the viewport, both CSS px. */
export interface MarkGrid {
  tilePx: number;
  pad: number;
  across: number;
  down: number;
}

/** The tiles over a viewport `width` by `height` CSS px, as few as the table holds. */
export function markGrid(width: number, height: number): MarkGrid {
  let tilePx = TILE_PX;
  const tiles = (side: number) =>
    Math.ceil(width / side + 2 * PAD_TILES) * Math.ceil(height / side + 2 * PAD_TILES);
  while (tiles(tilePx) > TILES_MAX) tilePx *= 2;
  const pad = PAD_TILES * tilePx;
  return {
    tilePx,
    pad,
    across: Math.max(1, Math.ceil((width + 2 * pad) / tilePx)),
    down: Math.max(1, Math.ceil((height + 2 * pad) / tilePx)),
  };
}

/** The screen tiles and what each lists, as packed into the table. */
export interface Binning extends MarkGrid {
  /** Per tile: its first slot and its count. */
  starts: Uint32Array;
  counts: Uint8Array;
  /** Marks by slot, each tile's in priority order. */
  slots: Uint16Array;
  used: number;
  /** Per disc, 1 if it went into the tiles it touches; 0 if one was full, and it is not drawn. */
  binned: Uint8Array;
}

/**
 * Bins discs (x, y, reach in CSS px, in priority order) into the tiles of the viewport and past its
 * edges (markGrid), at most `cap` a tile: a disc goes into every tile it touches, or, if one of
 * them is full, into none, so no mark is drawn cut along a tile's edge.
 */
export function binDiscs(
  discs: readonly { x: number; y: number; reachPx: number }[],
  width: number,
  height: number,
  cap: number,
): Binning {
  const grid = markGrid(width, height);
  const { tilePx, pad, across, down } = grid;
  const counts = new Uint8Array(across * down);
  const binned = new Uint8Array(discs.length);
  const pairs: number[] = [];
  const touched: number[] = [];
  discs.forEach(({ x, y, reachPx }, m) => {
    touched.length = 0;
    const x0 = Math.max(0, Math.floor((x + pad - reachPx) / tilePx));
    const x1 = Math.min(across - 1, Math.floor((x + pad + reachPx) / tilePx));
    const y0 = Math.max(0, Math.floor((y + pad - reachPx) / tilePx));
    const y1 = Math.min(down - 1, Math.floor((y + pad + reachPx) / tilePx));
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        // The tile's point nearest the disc's center must lie within its reach.
        const nx = Math.max(tx * tilePx - pad, Math.min(x, (tx + 1) * tilePx - pad));
        const ny = Math.max(ty * tilePx - pad, Math.min(y, (ty + 1) * tilePx - pad));
        if ((nx - x) ** 2 + (ny - y) ** 2 > reachPx * reachPx) continue;
        touched.push(ty * across + tx);
      }
    }
    if (touched.length === 0 || pairs.length / 2 + touched.length > SLOTS_MAX) return;
    if (touched.some((t) => (counts[t] ?? 0) >= cap)) return;
    for (const t of touched) {
      counts[t] = (counts[t] ?? 0) + 1;
      pairs.push(t, m);
    }
    binned[m] = 1;
  });
  const starts = new Uint32Array(across * down);
  let sum = 0;
  for (let t = 0; t < starts.length; t++) {
    starts[t] = sum;
    sum += counts[t] ?? 0;
  }
  const slots = new Uint16Array(sum);
  const filled = new Uint8Array(across * down);
  for (let i = 0; i < pairs.length; i += 2) {
    const t = pairs[i] ?? 0;
    slots[(starts[t] ?? 0) + (filled[t] ?? 0)] = pairs[i + 1] ?? 0;
    filled[t] = (filled[t] ?? 0) + 1;
  }
  return { ...grid, starts, counts, slots, used: sum, binned };
}

/** The marks' table: its texels, the next draw's staged beside them, and its texture. */
interface Table {
  data: Float32Array;
  next: Float32Array;
  texture: DataTexture;
}

/** Focal first, then hovered, then by score; ties keep the order the layers gave. */
function byPriority(a: Candidate, b: Candidate): number {
  const rank = (c: Candidate) => (c.entry.spec.focal ? 2 : 0) + (c.entry.spec.hover ? 1 : 0);
  return rank(b) - rank(a) || (b.entry.spec.score ?? 0) - (a.entry.spec.score ?? 0);
}

/** The marks the look inlays: their specs by source, their table and the uniforms it reads. */
export class MarkLayer {
  readonly uniforms: MarkUniforms;
  readonly params: Params = defaultMarkParams();
  /** The mode's strength, 0 to 1: Explore eases it out as it leaves. */
  strength = 1;
  readonly #cells: () => GlyphCells | null;
  readonly #sources = new Map<string, Entry[]>();
  #entries: Entry[] = [];
  /** The table while any marks are set: its texels, and the next draw's staged beside them. */
  #table: Table | null = null;
  /** What the look reads while no marks are set. */
  readonly #blank: DataTexture;
  #extent = [0, 0, 0];
  #placed: (PlacedMark & { dir: Vector3; r: number })[] = [];
  #clearance: ClearanceField | null = null;
  /** The unknown glyphs and paces already reported: each is logged once, and its marks not drawn. */
  readonly #reported = new Set<string>();
  #variant = -1;
  readonly #view = { toClip: new Matrix4(), kLand: 0, width: 1, height: 1 };

  /** `cells` gives the glyphs' atlas cells once the look has lettered them. */
  constructor(cells: () => GlyphCells | null) {
    this.#cells = cells;
    this.#blank = floatTexture(new Float32Array(4), 1, 1);
    this.uniforms = {
      lookMarksOn: { value: false },
      lookMarkTable: { value: this.#blank },
      lookMarkClip: { value: new Matrix4() },
      lookMarkView: { value: new Matrix3() },
      lookMarkGrid: { value: new Vector4(1, 1, TILE_PX, 1) },
      lookMarkFamily: {
        value: Array.from({ length: PACES.length * FAMILY_VEC4S }, () => new Vector4()),
      },
      lookMarkStyle: { value: new Vector4() },
      lookMarkEmber: { value: new Vector4() },
      lookMarkBreath: { value: 1 },
      lookMarkPolish: { value: 1 },
      lookMarkEngrave: { value: new Color('#2a1d0e') },
    };
    this.update(0);
  }

  /**
   * Replaces the marks from `source`; an empty list removes them. The table exists only while some
   * source has marks, so with none set the marks hold no memory.
   */
  set(source: string, specs: readonly MarkSpec[]): void {
    if (specs.length === 0) this.#sources.delete(source);
    else {
      this.#sources.set(
        source,
        specs.map((spec) => {
          const { east } = tangents(spec.at);
          const family = PACES.indexOf(spec.pace);
          if (family < 0) this.#report('pace', spec.pace);
          return { spec, dir: dirOf(spec.at), east, family };
        }),
      );
    }
    this.#entries = [...this.#sources.values()].flat();
    if (this.#entries.length === 0) this.#release();
    else this.#table ??= this.#allocate();
  }

  /** The terrain's ceiling, so a pick over land reaches the mark drawn on the relief. */
  useClearance(field: ClearanceField | null): void {
    this.#clearance = field;
  }

  /** The params' values into the uniforms, and the ember's breath at `elapsedS`. */
  update(elapsedS: number): void {
    const variant = Math.min(
      3,
      Math.max(0, Math.round(Number(this.params.markVariant))),
    ) as MarkVariant;
    if (variant !== this.#variant) {
      this.#variant = variant;
      familyUniforms(variant, this.uniforms.lookMarkFamily.value);
    }
    const p = this.params;
    this.uniforms.lookMarkStyle.value.set(
      Math.max(0.05, Number(p.markBevel)),
      Math.max(0, Number(p.markRelief)),
      Math.min(1, Math.max(0, Number(p.markFill))),
      Math.min(0.4, Math.max(0, Number(p.markGlow))),
    );
    this.uniforms.lookMarkPolish.value = Math.max(0.25, Number(p.markPolish));
    const ember = EMBER_COLOR;
    this.uniforms.lookMarkEmber.value.set(
      ember.r,
      ember.g,
      ember.b,
      EMBER_STRENGTH * Math.max(0, Number(p.markEmber)),
    );
    const phase = (2 * Math.PI * elapsedS) / BREATH.period;
    this.uniforms.lookMarkBreath.value = 1 - BREATH.depth * (0.5 - 0.5 * Math.cos(phase));
  }

  /** Sizes, fades and bins the marks for this draw, and packs the table if anything changed. */
  place(view: MarkView): void {
    const cells = this.#cells();
    const on = this.params.marks === true && this.strength > 0 && cells !== null;
    this.#view.toClip.copy(view.toClip);
    this.#view.kLand = view.kLand;
    this.#view.width = view.width;
    this.#view.height = view.height;
    this.#placed = [];
    const table = this.#table;
    if (!on || !table || this.#entries.length === 0) {
      this.uniforms.lookMarksOn.value = false;
      return;
    }
    const px =
      markPx(viewKmOf(view), view.pixelRatio) * Math.max(0.1, Number(this.params.markSize));
    const relief = Math.max(0, Number(this.params.markRelief));
    const candidates: Candidate[] = [];
    const grid = markGrid(view.width, view.height);
    const clip = new Vector4();
    const lamp = new Vector3();
    const north = new Vector3();
    for (const entry of this.#entries) {
      const { spec, dir } = entry;
      const cell = cells.get(spec.glyph);
      if (!cell) this.#report('glyph', spec.glyph);
      if (!cell || entry.family < 0) continue;
      const limb = limbFade(dir, view.camera);
      const facing = facingOf(dir, view.camera);
      const alpha = Math.min(1, Math.max(0, spec.opacity)) * this.strength * limb;
      if (alpha < 1 / 255) continue;
      clip.set(dir.x, dir.y, dir.z, 1).applyMatrix4(view.toClip);
      if (clip.w <= 0) continue;
      const x = (clip.x / clip.w / 2 + 0.5) * view.width;
      const y = (0.5 - clip.y / clip.w / 2) * view.height;
      const distance = view.camera.distanceTo(dir);
      const rPx = px / 2;
      const r = (rPx * distance) / view.pxPerUnit;
      // The contact shadow, toward the side away from the lamp, in r: the token's height over
      // the lamp's elevation there.
      const treatment = FAMILIES[spec.pace].variants[this.#variant as MarkVariant];
      let shadowX = 0;
      let shadowY = 0;
      if (treatment.shadow && treatment.disc) {
        lamp.copy(view.lamp).sub(dir).normalize();
        north.crossVectors(dir, entry.east);
        const [e, n] = [lamp.dot(entry.east), lamp.dot(north)];
        const flat = Math.hypot(e, n);
        const rise = Math.max(lamp.dot(dir), 0.05);
        const length = Math.min(SHADOW_MAX, (TOKEN_THICKNESS * relief * flat) / rise);
        if (flat > 1e-6) {
          shadowX = (e / flat) * length;
          shadowY = (n / flat) * length;
        }
      }
      // A hovered parent's ring: its arc's circle on the anchor's tangent plane, in r, and its
      // reach on screen from the circle's points there.
      const ringRad = spec.hover && spec.ringRad ? Math.min(spec.ringRad, RING_MAX_RAD) : 0;
      const ring = Math.sin(ringRad) / r;
      const ringPx = ringRad > 0 ? ringReachPx(entry, ringRad, x, y, view) : 0;
      // Off the view's axis a length on the globe looks longer than at the axis, by up to the
      // square of its distance over its depth.
      const pxPerR = rPx * (distance / clip.w) ** 2;
      const shadow = Math.hypot(shadowX, shadowY);
      // A pixel spans the most of r across the tilt, by the facing's inverse (a CSS px, at worst).
      const pxR = 1 / (rPx * Math.max(facing, FACING_MIN));
      const reachPx = markReachPx(treatment, spec, cell.extent, shadow, ringPx, pxPerR, pxR);
      const cosMin = Math.min(MARK_COS_MIN, Math.cos(Math.min(1.1 * ringRad + 0.02, Math.PI / 2)));
      if (x + reachPx < -grid.pad || x - reachPx > view.width + grid.pad) continue;
      if (y + reachPx < -grid.pad || y - reachPx > view.height + grid.pad) continue;
      candidates.push({ entry, x, y, rPx, reachPx, r, alpha, shadowX, shadowY, ring, cosMin });
    }
    candidates.sort(byPriority);
    if (candidates.length > MARKS_MAX) candidates.length = MARKS_MAX;
    const bins = binDiscs(candidates, view.width, view.height, tunables.markTileCap);

    // The table (marks.glsl.ts): each tile's first slot and its count, four a texel;
    // each slot's mark's screen disc and index; three texels a mark.
    const next = table.next;
    const ranges = Math.ceil(bins.counts.length / 4) * 4;
    next.fill(0, 0, ranges);
    const perStart = TILE_COUNT_MAX + 1;
    bins.counts.forEach((count, t) => (next[t] = (bins.starts[t] ?? 0) * perStart + count));
    const slotBase = SLOT_ROW * TABLE_WIDTH * 4;
    const slots = bins.used * 4;
    bins.slots.forEach((m, slot) => {
      const c = candidates[m];
      const at = slotBase + slot * 4;
      next[at] = c?.x ?? 0;
      next[at + 1] = c?.y ?? 0;
      next[at + 2] = c?.reachPx ?? 0;
      next[at + 3] = m;
    });
    const markBase = MARK_ROW * TABLE_WIDTH * 4;
    candidates.forEach((c, m) => {
      const { spec, dir, family } = c.entry;
      const cell = cells.get(spec.glyph);
      const flags =
        (spec.focal ? FLAG.focal : 0) |
        (spec.hover ? FLAG.hover : 0) |
        (spec.hollow ? FLAG.hollow : 0) |
        (spec.soft ? FLAG.soft : 0) |
        (spec.mirror ? FLAG.mirror : 0);
      // Its anchor and r; its glyph's cell, family and flags and strength; its shadow's offset,
      // its ring and the least cosine from its anchor it draws at.
      const at = markBase + m * MARK_TEXELS * 4;
      next[at] = dir.x;
      next[at + 1] = dir.y;
      next[at + 2] = dir.z;
      next[at + 3] = c.r;
      next[at + 4] = (cell?.x ?? 0) + GLYPH_CELL / 2;
      next[at + 5] = (cell?.y ?? 0) + GLYPH_CELL / 2;
      next[at + 6] = family * FAMILY_STEP + flags;
      next[at + 7] = c.alpha;
      next[at + 8] = c.shadowX;
      next[at + 9] = c.shadowY;
      next[at + 10] = c.ring;
      next[at + 11] = c.cosMin;
      if (bins.binned[m] === 1) {
        this.#placed.push({ id: spec.id, x: c.x, y: c.y, rPx: c.rPx, alpha: c.alpha, dir, r: c.r });
      }
    });
    const extent = [ranges, slots, candidates.length * MARK_TEXELS * 4];
    const spans: [number, number][] = [
      [0, ranges],
      [slotBase, slotBase + slots],
      [markBase, markBase + (extent[2] ?? 0)],
    ];
    const changed =
      extent.some((value, i) => value !== this.#extent[i]) ||
      spans.some(([from, to]) => !same(table.data, next, from, to));
    if (changed) {
      for (const [from, to] of spans) table.data.set(next.subarray(from, to), from);
      this.#extent = extent;
      table.texture.needsUpdate = true;
    }
    this.uniforms.lookMarkClip.value.copy(view.toClip);
    this.uniforms.lookMarkView.value.copy(view.toView);
    this.uniforms.lookMarkGrid.value.set(view.width, view.height, bins.tilePx, bins.across);
    this.uniforms.lookMarksOn.value = candidates.length > 0;
  }

  /**
   * The marks drawn in view for the last draw, in priority order: not those a full tile left out,
   * nor those binned past the viewport's edges in case relief lifts them into it.
   */
  placed(): readonly PlacedMark[] {
    const { width, height } = this.#view;
    return this.#placed
      .filter(({ x, y, rPx }) => x + rPx > 0 && x - rPx < width && y + rPx > 0 && y - rPx < height)
      .map(({ id, x, y, rPx, alpha }) => ({ id, x, y, rPx, alpha }));
  }

  /**
   * The mark under CSS px (x, y), or null: the nearest drawn and not too faint whose disc reaches
   * the point. Over land the disc runs from the mark's sea-level place to where the terrain's
   * ceiling there would lift it, since the mark is drawn on the relief somewhere between.
   */
  hit(x: number, y: number): string | null {
    let best: string | null = null;
    let bestD = Infinity;
    const lifted = new Vector3();
    const clip = new Vector4();
    for (const mark of this.#placed) {
      if (mark.alpha < PICK_ALPHA_MIN) continue;
      let [x1, y1] = [mark.x, mark.y];
      const field = this.#clearance;
      if (field && this.#view.kLand > 0) {
        const ceiling = field.ceilingM(
          [mark.dir.x, mark.dir.y, mark.dir.z],
          Math.max(mark.r, 1e-5),
          this.#view.kLand,
        );
        if (ceiling > 0) {
          lifted.copy(mark.dir).multiplyScalar(1 + ceiling / EARTH_M);
          clip.set(lifted.x, lifted.y, lifted.z, 1).applyMatrix4(this.#view.toClip);
          if (clip.w > 0) {
            x1 = (clip.x / clip.w / 2 + 0.5) * this.#view.width;
            y1 = (0.5 - clip.y / clip.w / 2) * this.#view.height;
          }
        }
      }
      const d = segmentDistance(x, y, mark.x, mark.y, x1, y1);
      if (d <= mark.rPx && d < bestD) {
        bestD = d;
        best = mark.id;
      }
    }
    return best;
  }

  /** The table and its staging while marks are set; nothing, but the owner's row, otherwise. */
  inspectMemory(account: MemoryAccount): void {
    account.array('explore.marks', null);
    if (!this.#table) return;
    account.texture('explore.marks', this.#table.texture);
    account.array('explore.marks', this.#table.next);
  }

  dispose(): void {
    this.#sources.clear();
    this.#entries = [];
    this.#release();
    this.#blank.dispose();
  }

  #report(what: 'glyph' | 'pace', name: string): void {
    const key = `${what} ${name}`;
    if (this.#reported.has(key)) return;
    this.#reported.add(key);
    console.warn(`Marks with the ${what} '${name}' are not drawn: the look has no such ${what}.`);
  }

  #allocate(): Table {
    const data = new Float32Array(TABLE_WIDTH * TABLE_ROWS * 4);
    const texture = floatTexture(data, TABLE_WIDTH, TABLE_ROWS);
    this.#extent = [0, 0, 0];
    this.uniforms.lookMarkTable.value = texture;
    return { data, next: new Float32Array(data.length), texture };
  }

  /** Drops the table: the look reads the blank, and draws no marks, until marks are set again. */
  #release(): void {
    this.#placed = [];
    this.uniforms.lookMarksOn.value = false;
    if (!this.#table) return;
    this.uniforms.lookMarkTable.value = this.#blank;
    this.#table.texture.dispose();
    this.#table = null;
  }
}

/** A float RGBA texture the look reads texel by texel. */
function floatTexture(data: Float32Array, width: number, height: number): DataTexture {
  const texture = new DataTexture(data, width, height, RGBAFormat, FloatType);
  texture.minFilter = texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** How far on screen, CSS px, a ring `ringRad` of arc about a mark at (x, y) reaches from it. */
function ringReachPx(entry: Entry, ringRad: number, x: number, y: number, view: MarkView): number {
  const north = new Vector3().crossVectors(entry.dir, entry.east);
  const point = new Vector3();
  const clip = new Vector4();
  let most = 0;
  for (let k = 0; k < 24; k++) {
    const bearing = (2 * Math.PI * k) / 24;
    point
      .copy(entry.dir)
      .multiplyScalar(Math.cos(ringRad))
      .addScaledVector(entry.east, Math.sin(ringRad) * Math.sin(bearing))
      .addScaledVector(north, Math.sin(ringRad) * Math.cos(bearing));
    clip.set(point.x, point.y, point.z, 1).applyMatrix4(view.toClip);
    if (clip.w <= 0) continue;
    const px = (clip.x / clip.w / 2 + 0.5) * view.width;
    const py = (0.5 - clip.y / clip.w / 2) * view.height;
    most = Math.max(most, Math.hypot(px - x, py - y));
  }
  // Between the points, the circle bows out past their chords by at most this much.
  return most / Math.cos(Math.PI / 24);
}

/** The view's width in km where the camera's axis meets the globe (or under the camera). */
function viewKmOf(view: MarkView): number {
  const c = view.camera;
  const f = view.forward;
  const b = c.dot(f);
  const disc = b * b - (c.lengthSq() - 1);
  const distance = disc >= 0 && b < 0 ? -b - Math.sqrt(disc) : c.length() - 1;
  return ((distance * view.width) / view.pxPerUnit) * EARTH_KM;
}

function same(a: Float32Array, b: Float32Array, from: number, to: number): boolean {
  for (let i = from; i < to; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The distance from (px, py) to the segment from (ax, ay) to (bx, by). */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const [dx, dy] = [bx - ax, by - ay];
  const length = dx * dx + dy * dy;
  const t = length > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
