// Marks on the globe (docs/design/globe-language.md, Channels and materials): places the look cuts
// into its own bronze (marks.glsl.ts), so they take the lamp, the shadows, the polish and the
// ridges' occlusion as the relief does, with no program, light or draw of their own.
//
// Any layer hands its marks over as data, by source: look.marks.set('events', specs). Each frame,
// with the draw's own matrices (the look's onBeforeRender, beside the sea names), place() sizes
// the marks for the view (tunables.markPx: one size at a given scale), fades them toward the limb,
// stands apart those that would overlap (fanOffsets), and bins each mark's screen disc into 32 CSS
// px tiles, at most tunables.markTileCap a tile, focal first, then hovered, then by score. The look
// finds a fragment's tile from where it stands on screen, and draws each seal flat at its anchor's
// height, which only the height pool holds; so each disc reaches past the mark's contact shadow,
// its ember or its hovered ring from wherever on screen that height can lift it, up to the highest
// ground the height can read (the terrain's ceiling there). One RGBA32F table holds the tiles'
// ranges, one texel per tile listing (its mark's screen disc and index) and four texels a mark, the
// last naming where the height pool holds the ground under its anchor; it is uploaded only when
// the view, a fade or the height pool under a mark changed, and exists only while some layer has
// marks set.
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
import type { HeightTexel, Params } from '../contract';
import type { ClearanceField } from '../globe/clearance';
import type { MemoryAccount } from '../perf/memory';
import { EMBER } from '../story/effects/ember';
import { dirOf, EARTH_KM, EARTH_M, tangents } from '../story/effects/geo';
import { smoothstep } from '../story/effects/timeline';
import type { LonLat } from '../story/story';
import { TILE, type Vec3 } from '../surface/cube';
import { FAMILIES, familyUniforms, FAMILY_VEC4S, PACES, type Family, type Pace } from './families';
import { GLYPH_CELL, type GlyphCell } from './glyphAtlas';
import {
  EMBER_RING,
  FAMILY_STEP,
  FLAG,
  GLYPH_FIELD,
  HEIGHT_LEVELS,
  MARK_AA_PX,
  MARK_ROW,
  MARK_TEXELS,
  MARKS_MAX,
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
  /** An inherited or derived place, or a date known only to the year: a softer outer edge. */
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
  /**
   * Marks of one group, such as an event's solid and hollow marks as they crossfade, share their
   * place rather than stand apart (fanOffsets).
   */
  group?: string;
}

/** A mark as place() last drew it: its sea-level place and radius on screen, CSS px, and its fade. */
export interface PlacedMark {
  id: string;
  x: number;
  y: number;
  rPx: number;
  /** Its opacity, 0 to 1: its own, the mode's and the limb's. */
  alpha: number;
}

/**
 * Where a placed mark may stand on screen, CSS px: from its sea-level place (x0, y0) to where the
 * highest ground its height can read would lift it (x1, y1), since its seal lies flat at its
 * anchor's height somewhere between. The two are one point at sea, and without the terrain's
 * ceiling or the height pool.
 */
export interface MarkSpan {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
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
  /** The relief's exaggeration over land, and the sea floor's (0 with the bathymetry off). */
  kLand: number;
  kSea: number;
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
/** A seal's thickness, in r, for its contact shadow: its bevel's height shapes only light. */
const SEAL_THICKNESS = 0.45;
/** The widest hovered ring drawn, radians of arc from its mark: an eighth of the globe's round. */
export const RING_MAX_RAD = Math.PI / 4;
/** The least facing a mark is drawn at: the limb fade leaves nothing below it. */
const FACING_MIN = 0.05;
/** The places and reaches whose terrain ceilings MarkLayer keeps, before it starts again. */
const BOUNDS_MAX = 4096;
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
 * (`glyphExtent` is the glyph's, in half grids); its seal, contact shadow (`shadow` r from it),
 * ember and hovered ring (`ringPx` px from it on screen), each with the antialiasing, blur or line
 * the look gives it and the light's cap two edges beyond.
 */
export function markReachPx(
  family: Family,
  mark: Pick<MarkSpec, 'soft' | 'focal'>,
  glyphExtent: number,
  shadow: number,
  ringPx: number,
  pxPerR: number,
  pxR: number,
): number {
  const edge = mark.soft ? MARK_AA_PX.soft : MARK_AA_PX.hard;
  const glyph = Math.min(glyphExtent + GLYPH_FIELD.reach, GLYPH_FIELD.box * Math.SQRT2);
  const seal = (shadow + family.seal.radius + SHADOW_BLUR) * pxPerR + 2 * edge;
  let reach = Math.max(glyph * family.glyph.scale * pxPerR, seal);
  if (mark.focal) {
    const half = Math.max(EMBER_RING.half, RING_PX.ember * pxR);
    reach = Math.max(reach, (EMBER_RING.radius + half + pxR) * pxPerR);
  }
  if (ringPx > 0) reach = Math.max(reach, ringPx + RING_PX.hover * pxR * pxPerR);
  return reach + 1;
}

const toCamera = new Vector3();
const liftedScratch = new Vector3();
const clipScratch = new Vector4();

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

/** The dev panel's params (the Marks folder), and the dev page's query's (?marks=0). */
export function defaultMarkParams(): Params {
  return {
    // Off skips the look's marks entirely: the GPU time's baseline.
    marks: true,
    // The mark's size over tunables.markPx and markMinDevicePx.
    markSize: 1,
    // The seal's bevel as a share of its radius (a glyph's is a quarter of it, or a pixel, within
    // its narrowest stroke), and the relief's height over the family's.
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
  /** Its anchor as drawn, stood apart from a mark it would overlap (fanOffsets), and on screen. */
  dir: Vector3;
  x: number;
  y: number;
  /** Its anchor's depth in front of the camera (clip w). */
  w: number;
  /** Its radius and its reach about its anchor at sea level, CSS px, and its radius in globe radii. */
  rPx: number;
  reachPx: number;
  r: number;
  alpha: number;
  shadowX: number;
  shadowY: number;
  ring: number;
  /** The least cosine from its anchor at which it still draws. */
  cosMin: number;
  /** Where the height pool holds the ground under its anchor, and where on screen that lifts it. */
  texel: HeightTexel | null;
  /** Where its seal stands on screen lifted by the highest ground its height can read, CSS px. */
  x1: number;
  y1: number;
  /** The screen disc its drawing can stand within, wherever its height lifts it, CSS px. */
  bin: { x: number; y: number; reachPx: number };
}

/** The screen's tiles over the viewport: their side in CSS px, and how many across and down. */
export interface MarkGrid {
  tilePx: number;
  across: number;
  down: number;
}

/** The tiles over a viewport `width` by `height` CSS px, as few as the table holds. */
export function markGrid(width: number, height: number): MarkGrid {
  let tilePx = TILE_PX;
  const tiles = (side: number) => Math.ceil(width / side) * Math.ceil(height / side);
  while (tiles(tilePx) > TILES_MAX) tilePx *= 2;
  return {
    tilePx,
    across: Math.max(1, Math.ceil(width / tilePx)),
    down: Math.max(1, Math.ceil(height / tilePx)),
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
 * Bins discs (x, y, reach in CSS px, in priority order) into the tiles of the viewport (markGrid),
 * at most `cap` a tile: a disc goes into every tile it touches, or, if one of them is full, into
 * none, so no mark is drawn cut along a tile's edge.
 */
export function binDiscs(
  discs: readonly { x: number; y: number; reachPx: number }[],
  width: number,
  height: number,
  cap: number,
): Binning {
  const grid = markGrid(width, height);
  const { tilePx, across, down } = grid;
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
  return { ...grid, starts, counts, slots, used: sum, binned };
}

/** The marks' table: its texels, the next draw's staged beside them, and its texture. */
interface Table {
  data: Float32Array;
  next: Float32Array;
  texture: DataTexture;
}

/** How far apart the look keeps two marks' centers on screen, in their radii: their seals clear. */
export const FAN_APART = 2.1;
/** Rounds of pushing apart: enough for the few marks that share a spot, or a short chain. */
const FAN_ROUNDS = 6;
/** Marks nearer than this, CSS px, share a spot: they stand side by side across the screen. */
const SAME_SPOT_PX = 1e-3;

/** A mark as fanOffsets reads it: where it stands on screen, CSS px, and how present it is. */
export interface FanMark {
  x: number;
  y: number;
  /** Its own fade, 0 to 1: a mark fading in pushes its neighbors aside as far as it has come. */
  alpha: number;
  score: number;
  id: string;
  group?: string;
}

/**
 * How far to move each of `marks` on screen, CSS px, as [dx, dy] pairs, so that no two of radius
 * `rPx` stand closer than FAN_APART radii, center to center: each pair that would overlap is pushed
 * apart along the line between them, each mark in proportion to how present the other is, so a
 * mark fading in slides out from under one already standing, which gives way as it comes. Marks at
 * one spot stand side by side on screen, the higher-scored to the left. Marks of one group never
 * push each other. Every round takes its pushes from the same places, so the result does not hang
 * on the marks' order, and it changes only as the view or a fade does.
 */
export function fanOffsets(marks: readonly FanMark[], rPx: number): Float64Array {
  const n = marks.length;
  const apart = FAN_APART * rPx;
  const out = new Float64Array(2 * n);
  if (n < 2 || !(apart > 0)) return out;
  const at = marks.map(({ x, y }) => ({ x, y }));
  const push = marks.map(() => ({ x: 0, y: 0 }));
  /** Whether `a` stands left of `b` at one spot: the higher score first, then by id. */
  const leftOf = (a: FanMark, b: FanMark) =>
    b.score < a.score || (b.score === a.score && a.id < b.id);
  for (let round = 0; round < FAN_ROUNDS; round++) {
    // Neighbors by a grid of cells as wide as the reach, so each pair lies in adjacent cells.
    const cells = new Map<string, number[]>();
    const cellOf = (p: { x: number; y: number }) => [
      Math.floor(p.x / apart),
      Math.floor(p.y / apart),
    ];
    at.forEach((p, i) => {
      const key = cellOf(p).join();
      const list = cells.get(key);
      if (list) list.push(i);
      else cells.set(key, [i]);
    });
    for (const p of push) p.x = p.y = 0;
    let moved = false;
    at.forEach((p, i) => {
      const a = marks[i]!;
      const [cx = 0, cy = 0] = cellOf(p);
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (let gx = cx - 1; gx <= cx + 1; gx++) {
          for (const j of cells.get(`${gx},${gy}`) ?? []) {
            const b = marks[j]!;
            const q = at[j]!;
            if (j <= i || (a.group !== undefined && a.group === b.group)) continue;
            const d = Math.hypot(q.x - p.x, q.y - p.y);
            if (d >= apart) continue;
            // From a to b; at one spot, side by side, the earlier to the left.
            const [ux, uy] =
              d < SAME_SPOT_PX ? [leftOf(a, b) ? 1 : -1, 0] : [(q.x - p.x) / d, (q.y - p.y) / d];
            const half = (apart - d) / 2;
            push[i]!.x -= ux * half * b.alpha;
            push[i]!.y -= uy * half * b.alpha;
            push[j]!.x += ux * half * a.alpha;
            push[j]!.y += uy * half * a.alpha;
            moved = true;
          }
        }
      }
    });
    if (!moved) break;
    at.forEach((p, i) => {
      p.x += push[i]!.x;
      p.y += push[i]!.y;
    });
  }
  at.forEach((p, i) => {
    out[2 * i] = p.x - marks[i]!.x;
    out[2 * i + 1] = p.y - marks[i]!.y;
  });
  return out;
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
  #placed: (PlacedMark & { x1: number; y1: number })[] = [];
  #clearance: ClearanceField | null = null;
  #heights: ((dir: Vec3) => HeightTexel | null) | null = null;
  /** The unknown glyphs and paces already reported: each is logged once, and its marks not drawn. */
  readonly #reported = new Set<string>();
  readonly #view = { toClip: new Matrix4(), width: 1, height: 1 };
  /** The highest ground each place's seal can read its height from, by place and reach. */
  readonly #bounds = new Map<string, number>();
  #sizePx = markPx(Infinity, 1);

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
        value: familyUniforms(
          Array.from({ length: PACES.length * FAMILY_VEC4S }, () => new Vector4()),
        ),
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

  /**
   * The marks' diameter in CSS px for the last draw (tunables.markPx at its width): what the
   * event declutter's cells and a hollow parent's veil keep marks apart by.
   */
  get sizePx(): number {
    return this.#sizePx;
  }

  /**
   * The terrain's ceiling: the most a seal's height can lift it on screen, which the look's tiles
   * and the pointer reach.
   */
  useClearance(field: ClearanceField | null): void {
    this.#clearance = field;
    this.#bounds.clear();
  }

  /**
   * Where the height pool holds the ground at a place (the cube's frame G), so the look lays each
   * seal flat at its anchor's height rather than over the relief around it.
   */
  useHeights(lookup: ((dir: Vec3) => HeightTexel | null) | null): void {
    this.#heights = lookup;
  }

  /** The params' values into the uniforms, and the ember's breath at `elapsedS`. */
  update(elapsedS: number): void {
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
    this.#view.width = view.width;
    this.#view.height = view.height;
    this.#placed = [];
    this.#sizePx =
      markPx(viewKmOf(view), view.pixelRatio) * Math.max(0.1, Number(this.params.markSize));
    const table = this.#table;
    if (!on || !table || this.#entries.length === 0) {
      this.uniforms.lookMarksOn.value = false;
      return;
    }
    const px = this.#sizePx;
    const relief = Math.max(0, Number(this.params.markRelief));
    // How high and how deep the relief anywhere stands, displaced: a hovered ring is engraved on
    // all of it, and no seal's height lifts it higher.
    const field = this.#clearance;
    const kLand = field ? Math.max(0, view.kLand) : 0;
    const depths = {
      highest: kLand * Math.max(0, field?.hMax ?? 0),
      deepest: (field ? Math.max(0, view.kSea) : 0) * Math.min(0, field?.hMin ?? 0),
    };
    const candidates: Candidate[] = [];
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
      // The contact shadow, toward the side away from the lamp, in r: the seal's height over
      // the lamp's elevation there.
      const family = FAMILIES[spec.pace];
      let shadowX = 0;
      let shadowY = 0;
      lamp.copy(view.lamp).sub(dir).normalize();
      north.crossVectors(dir, entry.east);
      const [e, n] = [lamp.dot(entry.east), lamp.dot(north)];
      const flat = Math.hypot(e, n);
      const rise = Math.max(lamp.dot(dir), 0.05);
      const length = Math.min(SHADOW_MAX, (SEAL_THICKNESS * relief * flat) / rise);
      if (flat > 1e-6) {
        shadowX = (e / flat) * length;
        shadowY = (n / flat) * length;
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
      const reachPx = markReachPx(family, spec, cell.extent, shadow, ringPx, pxPerR, pxR);
      const cosMin = Math.min(MARK_COS_MIN, Math.cos(Math.min(1.1 * ringRad + 0.02, Math.PI / 2)));
      const candidate: Candidate = {
        entry,
        dir,
        x,
        y,
        w: clip.w,
        rPx,
        reachPx,
        r,
        alpha,
        shadowX,
        shadowY,
        ring,
        cosMin,
        texel: null,
        x1: x,
        y1: y,
        bin: { x, y, reachPx },
      };
      // Left out only when no height the relief anywhere stands at lifts its drawing into view.
      const { width, height } = view;
      const off = (b: Candidate['bin']) =>
        b.x + b.reachPx < 0 ||
        b.x - b.reachPx > width ||
        b.y + b.reachPx < 0 ||
        b.y - b.reachPx > height;
      if (off(candidate.bin)) {
        const lo = ring > 0 ? depths.deepest : 0;
        if (off(this.#binOf(candidate, lo, depths.highest))) continue;
      }
      candidates.push(candidate);
    }
    this.#standApart(candidates, px / 2, view);
    candidates.sort(byPriority);
    if (candidates.length > MARKS_MAX) candidates.length = MARKS_MAX;
    for (const c of candidates) this.#lift(c, kLand, depths);
    const bins = binDiscs(
      candidates.map(({ bin }) => bin),
      view.width,
      view.height,
      tunables.markTileCap,
    );

    // The table (marks.glsl.ts): each tile's first slot and its count, four a texel;
    // each slot's mark's screen disc and index; four texels a mark.
    const next = table.next;
    const ranges = Math.ceil(bins.counts.length / 4) * 4;
    next.fill(0, 0, ranges);
    const perStart = TILE_COUNT_MAX + 1;
    bins.counts.forEach((count, t) => (next[t] = (bins.starts[t] ?? 0) * perStart + count));
    const slotBase = SLOT_ROW * TABLE_WIDTH * 4;
    const slots = bins.used * 4;
    bins.slots.forEach((m, slot) => {
      const bin = candidates[m]?.bin;
      const at = slotBase + slot * 4;
      next[at] = bin?.x ?? 0;
      next[at + 1] = bin?.y ?? 0;
      next[at + 2] = bin?.reachPx ?? 0;
      next[at + 3] = m;
    });
    const markBase = MARK_ROW * TABLE_WIDTH * 4;
    candidates.forEach((c, m) => {
      const { spec, family } = c.entry;
      const { dir, texel } = c;
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
      // Where the height pool holds the ground under its anchor: its uv, slot and level, and the
      // tile's codeMid; slot −1 for none.
      next[at + 12] = texel?.u ?? 0;
      next[at + 13] = texel?.v ?? 0;
      next[at + 14] = texel ? texel.slot * HEIGHT_LEVELS + texel.level : -1;
      next[at + 15] = texel?.codeMid ?? 0;
      if (bins.binned[m] === 1) {
        const { x, y, x1, y1, rPx, alpha } = c;
        this.#placed.push({ id: spec.id, x, y, x1, y1, rPx, alpha });
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
   * nor those whose sea-level place lies past the viewport's edges though relief lifts them into it.
   */
  placed(): readonly PlacedMark[] {
    const { width, height } = this.#view;
    return this.#placed
      .filter(({ x, y, rPx }) => x + rPx > 0 && x - rPx < width && y + rPx > 0 && y - rPx < height)
      .map(({ id, x, y, rPx, alpha }) => ({ id, x, y, rPx, alpha }));
  }

  /**
   * The mark under CSS px (x, y), or null: of those drawn and not too faint whose disc reaches the
   * point, the one most likely drawn under it. Over land the disc runs from the mark's sea-level
   * place to where the highest ground its height can read would lift it, since its seal lies flat
   * at its anchor's height somewhere between; where several reach the point, as when marks stood
   * apart north and south of each other are lifted toward one another, the nearest to its likeliest
   * place, halfway along that way, is under it, and of those as near, the first in priority.
   */
  hit(x: number, y: number): string | null {
    let best: string | null = null;
    let bestD = Infinity;
    for (const mark of this.#placed) {
      if (mark.alpha < PICK_ALPHA_MIN) continue;
      if (segmentDistance(x, y, mark.x, mark.y, mark.x1, mark.y1) > mark.rPx) continue;
      const d = Math.hypot(x - (mark.x + mark.x1) / 2, y - (mark.y + mark.y1) / 2);
      if (d < bestD) {
        bestD = d;
        best = mark.id;
      }
    }
    return best;
  }

  /**
   * Where the mark with this id may stand on screen in the last draw, or null for one it did not
   * place: asked for what must stand clear of a mark, as a plate does.
   */
  span(id: string): MarkSpan | null {
    const mark = this.#placed.find((placed) => placed.id === id);
    if (!mark) return null;
    return { x0: mark.x, y0: mark.y, x1: mark.x1, y1: mark.y1 };
  }

  /**
   * Reads where the height pool holds the ground under a candidate's anchor as drawn, and where on
   * screen its seal and its drawing can stand: lifted off sea level by up to the highest ground
   * that height can read, and for a hovered ring, which is engraved on the relief, by anything
   * from the deepest sea floor to the highest ground (`depths`, displaced meters).
   */
  #lift(c: Candidate, kLand: number, depths: { highest: number; deepest: number }): void {
    // The height pool and the terrain's ceiling read the cube's frame G; three's axes are G.y,
    // G.z, G.x.
    c.texel = this.#heights?.([c.dir.z, c.dir.x, c.dir.y]) ?? null;
    const field = this.#clearance;
    const bound =
      c.texel && field && kLand > 0 ? kLand * this.#heightBound(field, c, c.texel.level) : 0;
    const top = bound > 0 ? this.#project(c.dir, bound) : null;
    [c.x1, c.y1] = top ?? [c.x, c.y];
    c.bin =
      c.ring > 0
        ? this.#binOf(c, depths.deepest, Math.max(bound, depths.highest))
        : this.#binOf(c, 0, bound);
  }

  /**
   * The screen disc a candidate's drawing stands within, its seal anywhere from `lo` to `hi`
   * meters off sea level, displaced: its reach about each end, which a lift toward the camera
   * draws larger, and the way between them.
   */
  #binOf(c: Candidate, lo: number, hi: number): Candidate['bin'] {
    const [ax, ay, aw] = (lo < 0 ? this.#project(c.dir, lo) : null) ?? [c.x, c.y, c.w];
    const [bx, by, bw] = (hi > 0 ? this.#project(c.dir, hi) : null) ?? [c.x, c.y, c.w];
    const scale = Math.max(1, c.w / aw, c.w / bw);
    return {
      x: (ax + bx) / 2,
      y: (ay + by) / 2,
      reachPx: c.reachPx * scale + Math.hypot(bx - ax, by - ay) / 2,
    };
  }

  /**
   * The highest meters, not displaced, the height pool can hold where a candidate's seal reads its
   * height from a level-`level` tile: the terrain's ceiling within its taps' reach, and as far
   * again as it stood apart (fanOffsets). Cached by place and reach, the reach a power of √2.
   */
  #heightBound(field: ClearanceField, c: Candidate, level: number): number {
    const { entry } = c;
    // A texel of the mip the look reads (marks.glsl.ts), in radians, and the taps' reach.
    const texel = Math.PI / 2 / (2 ** level * (TILE / 4));
    const cap = 1.5 * texel + entry.dir.angleTo(c.dir);
    const step = Math.ceil(2 * Math.log2(cap));
    const key = `${entry.spec.at[0]},${entry.spec.at[1]}|${step}`;
    let bound = this.#bounds.get(key);
    if (bound === undefined) {
      if (this.#bounds.size >= BOUNDS_MAX) this.#bounds.clear();
      const { dir } = entry;
      bound = Math.max(0, field.ceilingM([dir.z, dir.x, dir.y], 2 ** (step / 2), 1));
      this.#bounds.set(key, bound);
    }
    return bound;
  }

  /** Where the place at `dir`, lifted `meters` off sea level, stands on screen (CSS px), and its depth. */
  #project(dir: Vector3, meters: number): [number, number, number] | null {
    const lifted = liftedScratch.copy(dir).multiplyScalar(1 + meters / EARTH_M);
    const clip = clipScratch.set(lifted.x, lifted.y, lifted.z, 1).applyMatrix4(this.#view.toClip);
    if (clip.w <= 0) return null;
    return [
      (clip.x / clip.w / 2 + 0.5) * this.#view.width,
      (0.5 - clip.y / clip.w / 2) * this.#view.height,
      clip.w,
    ];
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

  /**
   * Stands apart marks that would overlap on screen (fanOffsets): each moved mark's anchor slides
   * on the globe by its offset, through the view's local stretch at its place, so the look draws
   * it, and the pointer finds it, where it stands.
   */
  #standApart(candidates: Candidate[], rPx: number, view: MarkView): void {
    const offsets = fanOffsets(
      // Each pushes as far as its own fade has come: the layer's strength and the limb fade every
      // mark at a spot alike, and must not draw them together or apart.
      candidates.map(({ x, y, entry: { spec } }) => ({
        x,
        y,
        alpha: Math.min(1, Math.max(0, spec.opacity)),
        score: spec.score ?? 0,
        id: spec.id,
        group: spec.group,
      })),
      rPx,
    );
    const north = new Vector3();
    const step = new Vector3();
    const clip = new Vector4();
    const screenOf = (dir: Vector3): [number, number] | null => {
      clip.set(dir.x, dir.y, dir.z, 1).applyMatrix4(view.toClip);
      if (clip.w <= 0) return null;
      return [(clip.x / clip.w / 2 + 0.5) * view.width, (0.5 - clip.y / clip.w / 2) * view.height];
    };
    candidates.forEach((c, i) => {
      const ox = offsets[2 * i] ?? 0;
      const oy = offsets[2 * i + 1] ?? 0;
      if (Math.hypot(ox, oy) < 1e-3) return;
      // The screen's stretch of a small step east and north on the globe, CSS px per radian.
      const { dir, east } = c.entry;
      north.crossVectors(dir, east);
      const h = c.r;
      const e = screenOf(step.copy(dir).addScaledVector(east, h));
      const nn = screenOf(step.copy(dir).addScaledVector(north, h));
      if (!e || !nn) return;
      const [ex, ey, nx, ny] = [
        (e[0] - c.x) / h,
        (e[1] - c.y) / h,
        (nn[0] - c.x) / h,
        (nn[1] - c.y) / h,
      ];
      const det = ex * ny - nx * ey;
      if (Math.abs(det) < 1e-9) return;
      const de = (ox * ny - nx * oy) / det;
      const dn = (ex * oy - ox * ey) / det;
      c.dir = dir.clone().addScaledVector(east, de).addScaledVector(north, dn).normalize();
      c.x += ox;
      c.y += oy;
    });
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
