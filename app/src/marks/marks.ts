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
} from './families';
import { GLYPH_CELL } from './glyphAtlas';
import {
  EMBER_RING,
  FLAG,
  MARK_ROW,
  MARK_TEXELS,
  MARKS_MAX,
  SLOT_ROW,
  SLOTS_MAX,
  TABLE_ROWS,
  TABLE_WIDTH,
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
  /** An expanded parent's extent, radians of arc: a dashed engraved ring while it is hovered. */
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
  /** The viewport in CSS px. */
  width: number;
  height: number;
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

/** A glyph's cell in the look's atlas: its top-left texel. */
export type GlyphCells = ReadonlyMap<string, { x: number; y: number }>;

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
/** Beyond the glyph's grid: room for a hollow outline and the edge's antialiasing, in r. */
const BODY_REACH = 1.12;
/** The least opacity a mark is picked at: fainter, toward the limb or fading, it is let be. */
const PICK_ALPHA_MIN = 0.25;

/** A mark's diameter in CSS px for a view `viewKm` wide (tunables.markPx). */
export function markPx(viewKm: number): number {
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

const toCamera = new Vector3();

/** How far a mark at `dir` faces the camera at `camera`: its limb fade (as the sea names'). */
export function limbFade(dir: Vector3, camera: Vector3): number {
  toCamera.copy(camera).sub(dir);
  const length = toCamera.length();
  if (length === 0) return 0;
  return smoothstep(0.05, 0.35, dir.dot(toCamera) / length);
}

/** The dev panel's params (the Marks folder), and the query's (?markVariant=2, ?marks=0). */
export function defaultMarkParams(): Params {
  return {
    // Off skips the look's marks entirely: the GPU time's baseline.
    marks: true,
    markVariant: 0,
    // The mark's size over tunables.markPx.
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
  /** Its radius and its reach, CSS px, and its reach in r. */
  rPx: number;
  reachPx: number;
  reach: number;
  r: number;
  alpha: number;
  shadowX: number;
  shadowY: number;
  ring: number;
}

/** The screen tiles and what each lists, as packed into the table. */
export interface Binning {
  tilePx: number;
  across: number;
  down: number;
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
 * Bins discs (x, y, reach in CSS px, in priority order) into tiles of the viewport, at most `cap`
 * a tile: a disc goes into every tile it touches, or, if one of them is full, into none, so no
 * mark is drawn cut along a tile's edge.
 */
export function binDiscs(
  discs: readonly { x: number; y: number; reachPx: number }[],
  width: number,
  height: number,
  cap: number,
): Binning {
  let tilePx = TILE_PX;
  while (Math.ceil(width / tilePx) * Math.ceil(height / tilePx) > TILES_MAX) tilePx *= 2;
  const across = Math.max(1, Math.ceil(width / tilePx));
  const down = Math.max(1, Math.ceil(height / tilePx));
  const counts = new Uint8Array(across * down);
  const binned = new Uint8Array(discs.length);
  const pairs: number[] = [];
  const touched: number[] = [];
  discs.forEach(({ x, y, reachPx }, m) => {
    touched.length = 0;
    const x0 = Math.max(0, Math.floor((x - reachPx) / tilePx));
    const x1 = Math.min(across - 1, Math.floor((x + reachPx) / tilePx));
    const y0 = Math.max(0, Math.floor((y - reachPx) / tilePx));
    const y1 = Math.min(down - 1, Math.floor((y + reachPx) / tilePx));
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        // The tile's point nearest the disc's center must lie within its reach.
        const nx = Math.max(tx * tilePx, Math.min(x, (tx + 1) * tilePx));
        const ny = Math.max(ty * tilePx, Math.min(y, (ty + 1) * tilePx));
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
  return { tilePx, across, down, starts, counts, slots, used: sum, binned };
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
          return { spec, dir: dirOf(spec.at), east, family: PACES.indexOf(spec.pace) };
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
    const px = markPx(viewKmOf(view)) * Math.max(0.1, Number(this.params.markSize));
    const relief = Math.max(0, Number(this.params.markRelief));
    const candidates: Candidate[] = [];
    const clip = new Vector4();
    const lamp = new Vector3();
    const north = new Vector3();
    for (const entry of this.#entries) {
      const { spec, dir } = entry;
      const cell = cells.get(spec.glyph);
      if (!cell || entry.family < 0) continue;
      const limb = limbFade(dir, view.camera);
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
      const ring = spec.hover && spec.ringRad ? spec.ringRad / r : 0;
      let reach = BODY_REACH + Math.hypot(shadowX, shadowY);
      if (spec.focal) reach = Math.max(reach, EMBER_RING.radius + 2 * EMBER_RING.half + 0.1);
      if (ring > 0) reach = Math.max(reach, ring + 0.2);
      const reachPx = reach * rPx + 1;
      if (x + reachPx < 0 || x - reachPx > view.width) continue;
      if (y + reachPx < 0 || y - reachPx > view.height) continue;
      candidates.push({ entry, x, y, rPx, reachPx, reach, r, alpha, shadowX, shadowY, ring });
    }
    candidates.sort(byPriority);
    if (candidates.length > MARKS_MAX) candidates.length = MARKS_MAX;
    const bins = binDiscs(candidates, view.width, view.height, tunables.markTileCap);

    // The table (marks.glsl.ts): each tile's first slot times 16 plus its count, four a texel;
    // each slot's mark's screen disc and index; three texels a mark.
    const next = table.next;
    const ranges = Math.ceil(bins.counts.length / 4) * 4;
    next.fill(0, 0, ranges);
    bins.counts.forEach((count, t) => (next[t] = (bins.starts[t] ?? 0) * 16 + count));
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
        (spec.soft ? FLAG.soft : 0);
      // Its anchor and r; its glyph's cell, family and flags and strength; its shadow's offset
      // and its ring.
      const at = markBase + m * MARK_TEXELS * 4;
      next[at] = dir.x;
      next[at + 1] = dir.y;
      next[at + 2] = dir.z;
      next[at + 3] = c.r;
      next[at + 4] = (cell?.x ?? 0) + GLYPH_CELL / 2;
      next[at + 5] = (cell?.y ?? 0) + GLYPH_CELL / 2;
      next[at + 6] = family * 16 + flags;
      next[at + 7] = c.alpha;
      next[at + 8] = c.shadowX;
      next[at + 9] = c.shadowY;
      next[at + 10] = c.ring;
      next[at + 11] = 0;
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

  /** The marks drawn for the last draw, in priority order: those a full tile left out are not. */
  placed(): readonly PlacedMark[] {
    return this.#placed.map(({ id, x, y, rPx, alpha }) => ({ id, x, y, rPx, alpha }));
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
