// The border steps' bake (streaming.md 3.3, 7.3), as `npm run verify:bake -- global` reads it: the
// borders record and its release section, the WBF2 steps and WBP2 preview chunks decoded, the
// lakes' shores and the land the stage writes beside its record, and the checks the verify runs
// on them. Node only; the app's own decoders come with the client (task 6 of #80).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import constants from '@shared/constants.json' with { type: 'json' };
import type { BorderStepsRelease } from '../data/release';
import { dirToLonLat, faceOf, faceSt, lonLatToDir, stToDir } from '../surface/cube';
import { CODE_PATHS } from './region';
import { treeSha } from './stamp';

const STEP_MAGIC: string = constants.formats.borderStep.magic;
const STEP_VERSION: number = constants.formats.borderStep.version;
const PREVIEW_MAGIC: string = constants.formats.borderPreviews.magic;
const PREVIEW_VERSION: number = constants.formats.borderPreviews.version;
const STEP_HEADER = 16;
const PREVIEW_HEADER = 12;
export const FACES = 6;
export const CHANNELS = 2;
export const PREVIEW_WIDTH = 512;
export const PREVIEW_HEIGHT = 256;
/** A texel at a face center, km: a quarter of the Earth's circumference over 1,016 texels. */
export const TEXEL_KM = (2 * Math.PI * 6371.0088) / 4 / 1016;
/**
 * Leaves valid in the years task 0 compared (#80), in Cliopatria v0.2.0: every step holding one of
 * these years draws that many, apart from corrections.
 */
export const COMPARED_LEAVES: Readonly<Record<number, number>> = {
  1000: 126,
  1500: 130,
  1800: 121,
  1815: 139,
  1914: 74,
};

/** The borders stage's record (7.2), as far as the verify reads it. */
export interface BordersRecord {
  steps?: BorderStepsRelease;
  unacknowledged?: { polities: string[]; steps: number[] }[];
  unclassified?: { composites: string[]; relations: string[] };
  /** The stateless holes and gaps the history pass owes a cited verdict. */
  owed?: { holes: unknown[]; gaps: unknown[] };
  inputs?: { code: string; cliopatria: string };
}

/** One step's review entry in borders-review.json, as the verify reads it. */
export interface StepReview {
  /** Cliopatria's POLITY rows valid in the step's year, not composites. */
  leaves: number;
  drawn: number;
  /** The leaves the step draws that no valid row gives it. */
  added?: string[];
  /** The leaves a valid row gives the step that it does not draw. */
  removed?: string[];
  /**
   * Of those added and removed, the ones neither a correction the step applies names nor the
   * carry-through draws.
   */
  unexplained?: string[];
  /** The corrections that changed the step, by label. */
  corrections?: string[];
}

/** polities.json: each polity's id, Wikidata ids and runs of steps under one outer unit. */
export type Polities = Record<
  string,
  { id: number; wikidata: string[]; steps: [first: number, last: number, outer: string][] }
>;

export interface BorderBake {
  record: BordersRecord & { steps: BorderStepsRelease };
  /** The output root, which holds the keys. */
  root: string;
  review: { byStep: Record<string, StepReview> };
  /** Per face, the signed distance to the drawn lakes' shores, as R stores it, + off the lakes. */
  shores: Uint8Array;
  /** Per face, 1 where a texel lies on land less lakes. */
  land: Uint8Array;
  polities: Polities;
}

export class StaleBorderBake extends Error {
  override name = 'StaleBorderBake';
}

/**
 * The global bake's border steps, once its record holds them and was built from the working tree's
 * pipeline code and the pinned Cliopatria. Throws a StaleBorderBake naming the command otherwise.
 */
export function readBorderBake(repo: string): BorderBake {
  const stale = (reason: string) =>
    new StaleBorderBake(
      `build/out's border steps are missing or stale (${reason}): run ` +
        '`uv run prebuild borders` in pipeline/',
    );
  const stages = join(repo, 'build', 'stages', 'global');
  const path = join(stages, 'borders.json');
  if (!existsSync(path)) throw stale('it has no borders record');
  const record = JSON.parse(readFileSync(path, 'utf8')) as BordersRecord;
  const { steps, inputs } = record;
  if (!steps) throw stale('its borders record holds no steps');
  if (inputs?.code !== treeSha(CODE_PATHS, repo)) {
    throw stale('it was built from other pipeline code, configs or shared constants');
  }
  const pinned = readFileSync(join(repo, 'pipeline', 'sources.toml'), 'utf8');
  if (!pinned.includes(`"${inputs.cliopatria}"`)) {
    throw stale('it read another Cliopatria than pipeline/sources.toml pins');
  }
  const root = join(repo, 'build', 'out');
  const read = (name: string) => readFileSync(join(stages, name));
  const size = steps.size * steps.size * FACES;
  const shores = new Uint8Array(gunzipSync(read('borders-lakes.bin')));
  const land = new Uint8Array(gunzipSync(read('borders-land.bin')));
  if (shores.length !== size || land.length !== size) {
    throw stale(`its lakes and land hold ${shores.length} and ${land.length} texels, not ${size}`);
  }
  return {
    record: { ...record, steps },
    root,
    review: JSON.parse(read('borders-review.json').toString('utf8')) as BorderBake['review'],
    shores,
    land,
    polities: JSON.parse(readFileSync(join(root, steps.polities), 'utf8')) as Polities,
  };
}

export class BorderFormatError extends Error {
  override name = 'BorderFormatError';
}

export interface DecodedStep {
  year: number;
  size: number;
  apron: number;
  /** [face][row][column][R, G], row 0 the smallest t. */
  planes: Uint8Array;
}

/** A stored WBF2 step, checking its header and length. */
export function decodeStep(stored: Uint8Array): DecodedStep {
  const raw = gunzipSync(stored);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const magic = String.fromCharCode(...raw.subarray(0, 4));
  if (magic !== STEP_MAGIC || view.getUint8(4) !== STEP_VERSION) {
    throw new BorderFormatError(`not a version ${STEP_VERSION} border step: ${magic}`);
  }
  const faces = view.getUint8(5);
  const size = view.getUint16(6, true);
  const apron = view.getUint16(8, true);
  const year = view.getInt16(10, true);
  const channels = view.getUint8(12);
  const planes: Uint8Array = raw.subarray(STEP_HEADER);
  if (
    faces !== FACES ||
    channels !== CHANNELS ||
    planes.length !== faces * size * size * channels
  ) {
    throw new BorderFormatError(`${faces} faces of ${size}² x ${channels} in ${planes.length} B`);
  }
  return { year, size, apron, planes };
}

export interface DecodedChunk {
  years: number[];
  /** Each step's preview, [row][column], row 0 the northmost. */
  layers: Uint8Array[];
}

/** A stored WBP2 chunk, each layer summed back from its differences. */
export function decodeChunk(stored: Uint8Array): DecodedChunk {
  const raw = gunzipSync(stored);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const magic = String.fromCharCode(...raw.subarray(0, 4));
  if (magic !== PREVIEW_MAGIC || view.getUint8(4) !== PREVIEW_VERSION) {
    throw new BorderFormatError(`not a version ${PREVIEW_VERSION} preview chunk: ${magic}`);
  }
  const count = view.getUint16(6, true);
  const width = view.getUint16(8, true);
  const height = view.getUint16(10, true);
  const years = Array.from({ length: count }, (_, k) =>
    view.getInt32(PREVIEW_HEADER + 4 * k, true),
  );
  const offset = PREVIEW_HEADER + 4 * count;
  const cells = width * height;
  if (
    width !== PREVIEW_WIDTH ||
    height !== PREVIEW_HEIGHT ||
    raw.length !== offset + count * cells
  ) {
    throw new BorderFormatError(`${count} previews of ${width} x ${height} in ${raw.length} B`);
  }
  const layers: Uint8Array[] = [];
  let previous = new Uint8Array(cells);
  for (let k = 0; k < count; k += 1) {
    const deltas = raw.subarray(offset + k * cells, offset + (k + 1) * cells);
    const layer = new Uint8Array(cells);
    for (let c = 0; c < cells; c += 1) layer[c] = (previous[c]! + deltas[c]!) & 255;
    layers.push(layer);
    previous = layer;
  }
  return { years, layers };
}

/** R's distance in texels. */
export const outerDistance = (byte: number): number => byte / 16 - 8;
/** G's and a preview's distance in texels, from bits 0-6 (a preview's q is v >> 1). */
export const innerDistance = (q: number): number => (q & 127) / 8 - 8;

/** Which plane's borders a check reads: R, G or, by default, both. */
export type Plane = 'R' | 'G' | 'both';

/** A texel a border passes through: within half a texel of an R or a G border. */
export function onBorder(r: number, g: number, plane: Plane = 'both'): boolean {
  const outer = plane !== 'G' && Math.abs(outerDistance(r)) <= 0.5;
  return outer || (plane !== 'R' && Math.abs(innerDistance(g)) <= 0.5);
}

/** How far a lake must reach from its shore, in texels, for a border in it to clear the shore. */
export const WIDE_LAKE = 1;
/** How near such lake texels must lie to a shore texel, in texels (a square). */
export const WIDE_LAKE_REACH = 3;

/**
 * Per face, the texels off the lakes within a texel of a lake's shore where the lake is wide
 * enough to hold a border clear of it: some lake texel at least WIDE_LAKE from the shore lies
 * within WIDE_LAKE_REACH. A lake narrower than about two texels holds any border that follows it
 * within a texel of both its shores.
 */
export function shoreBand(shores: Uint8Array, size: number): Uint8Array {
  const cells = size * size;
  const band = new Uint8Array(shores.length);
  const faces = shores.length / cells;
  const rows = new Uint8Array(cells);
  for (let face = 0; face < faces; face += 1) {
    const base = face * cells;
    // The wide lake texels, dilated along rows and then along columns.
    rows.fill(0);
    for (let y = 0; y < size; y += 1) {
      let last = -Infinity;
      for (let x = 0; x < size; x += 1) {
        if (outerDistance(shores[base + y * size + x]!) <= -WIDE_LAKE) last = x;
        if (x - last <= WIDE_LAKE_REACH) rows[y * size + x] = 1;
      }
      last = Infinity;
      for (let x = size - 1; x >= 0; x -= 1) {
        if (outerDistance(shores[base + y * size + x]!) <= -WIDE_LAKE) last = x;
        if (last - x <= WIDE_LAKE_REACH) rows[y * size + x] = 1;
      }
    }
    for (let x = 0; x < size; x += 1) {
      let last = -Infinity;
      const near = new Uint8Array(size);
      for (let y = 0; y < size; y += 1) {
        if (rows[y * size + x]) last = y;
        if (y - last <= WIDE_LAKE_REACH) near[y] = 1;
      }
      last = Infinity;
      for (let y = size - 1; y >= 0; y -= 1) {
        if (rows[y * size + x]) last = y;
        if (last - y <= WIDE_LAKE_REACH) near[y] = 1;
      }
      for (let y = 0; y < size; y += 1) {
        const d = outerDistance(shores[base + y * size + x]!);
        if (near[y] && d > 0 && d <= 1) band[base + y * size + x] = 1;
      }
    }
  }
  return band;
}

export interface ShoreRun {
  face: number;
  /** The run's first texel, column and row. */
  at: [number, number];
  texels: number;
  /** The run's bounding box, columns and rows: x0, y0, x1, y1, inclusive. */
  box: [number, number, number, number];
  /** The diagonal of the run's bounding box, at TEXEL_KM a texel. */
  km: number;
}

/**
 * The runs of border texels in a shore band (shoreBand) on one face, 8-connected, longest first,
 * of both planes' borders or one's. A border the fill carries across a lake meets each shore in a
 * few texels; one that follows or rings a shore runs beside it.
 */
export function shoreRuns(
  planes: Uint8Array,
  band: Uint8Array,
  size: number,
  face: number,
  plane: Plane = 'both',
): ShoreRun[] {
  const cells = size * size;
  const base = face * cells;
  const hit = new Uint8Array(cells);
  for (let k = 0; k < cells; k += 1) {
    const texel = base + k;
    if (band[texel] === 1 && onBorder(planes[2 * texel]!, planes[2 * texel + 1]!, plane)) {
      hit[k] = 1;
    }
  }
  const runs: ShoreRun[] = [];
  const stack: number[] = [];
  for (let start = 0; start < cells; start += 1) {
    if (hit[start] !== 1) continue;
    hit[start] = 2;
    stack.push(start);
    let texels = 0;
    let [x0, y0, x1, y1] = [size, size, -1, -1];
    while (stack.length > 0) {
      const k = stack.pop()!;
      const x = k % size;
      const y = (k - x) / size;
      texels += 1;
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const next = ny * size + nx;
          if (hit[next] === 1) {
            hit[next] = 2;
            stack.push(next);
          }
        }
      }
    }
    const km = Math.hypot(x1 - x0 + 1, y1 - y0 + 1) * TEXEL_KM;
    const at: [number, number] = [start % size, Math.floor(start / size)];
    runs.push({ face, at, texels, box: [x0, y0, x1, y1], km });
  }
  return runs.sort((a, b) => b.km - a.km);
}

/** A step texel's center, longitude and latitude in degrees (streaming.md 3.3, Geometry). */
export function texelLonLat(
  face: number,
  column: number,
  row: number,
  size: number,
  apron: number,
): [number, number] {
  const interior = size - 2 * apron;
  const s = -1 + (2 * (column - apron) + 1) / interior;
  const t = -1 + (2 * (row - apron) + 1) / interior;
  return dirToLonLat(stToDir(face, s, t));
}

/** The texel of a step under each preview texel's center, and whether it lies on land. */
export interface PreviewMap {
  texel: Int32Array;
  land: Uint8Array;
}

export function previewMap(size: number, apron: number, land: Uint8Array): PreviewMap {
  const texel = new Int32Array(PREVIEW_WIDTH * PREVIEW_HEIGHT);
  const onLand = new Uint8Array(texel.length);
  const interior = size - 2 * apron;
  for (let j = 0; j < PREVIEW_HEIGHT; j += 1) {
    const lat = 90 - ((j + 0.5) * 180) / PREVIEW_HEIGHT;
    for (let i = 0; i < PREVIEW_WIDTH; i += 1) {
      const lon = -180 + ((i + 0.5) * 360) / PREVIEW_WIDTH;
      const p = lonLatToDir(lon, lat);
      const face = faceOf(p);
      const [s, t] = faceSt(face, p);
      const column = Math.min(size - 1, Math.floor(((s + 1) / 2) * interior) + apron);
      const row = Math.min(size - 1, Math.floor(((t + 1) / 2) * interior) + apron);
      const k = face * size * size + row * size + column;
      texel[j * PREVIEW_WIDTH + i] = k;
      onLand[j * PREVIEW_WIDTH + i] = land[k]!;
    }
  }
  return { texel, land: onLand };
}

/** Field texels either side of a preview texel's center that its footprint spans, about. */
export const PREVIEW_SPAN = 4;

/**
 * On land near an R border, 2 to 7 field texels from it and at least half a preview texel, where
 * the field keeps one sign across the preview texel's footprint (no sign jump between two borders
 * lies in it), how often a step's preview and its field agree on which side of the border they lie.
 */
export function previewAgreement(
  planes: Uint8Array,
  layer: Uint8Array,
  map: PreviewMap,
  size: number,
): { compared: number; agreed: number } {
  let compared = 0;
  let agreed = 0;
  const cells = size * size;
  for (let c = 0; c < layer.length; c += 1) {
    if (map.land[c] !== 1) continue;
    const texel = map.texel[c]!;
    const field = outerDistance(planes[2 * texel]!);
    const preview = innerDistance(layer[c]! >> 1);
    if (Math.abs(field) < 2 || Math.abs(field) > 7 || Math.abs(preview) < 0.5) continue;
    if (!oneSigned(planes, texel, size, cells, field > 0)) continue;
    compared += 1;
    if (Math.sign(field) === Math.sign(preview)) agreed += 1;
  }
  return { compared, agreed };
}

/** Whether R keeps the sign `positive` over the texels within PREVIEW_SPAN of one on its face. */
function oneSigned(
  planes: Uint8Array,
  texel: number,
  size: number,
  cells: number,
  positive: boolean,
): boolean {
  const base = Math.floor(texel / cells) * cells;
  const column = (texel - base) % size;
  const row = (texel - base - column) / size;
  for (
    let y = Math.max(0, row - PREVIEW_SPAN);
    y <= Math.min(size - 1, row + PREVIEW_SPAN);
    y += 1
  ) {
    for (
      let x = Math.max(0, column - PREVIEW_SPAN);
      x <= Math.min(size - 1, column + PREVIEW_SPAN);
      x += 1
    ) {
      if (outerDistance(planes[2 * (base + y * size + x)]!) > 0 !== positive) return false;
    }
  }
  return true;
}

/** Each step's drawn leaves, the names polities.json lists in it not in parentheses. */
export function drawnLeaves(polities: Polities, years: readonly number[]): number[] {
  const counts = years.map(() => 0);
  for (const [name, { steps }] of Object.entries(polities)) {
    if (name.startsWith('(')) continue;
    years.forEach((year, k) => {
      if (steps.some(([first, last]) => first <= year && year <= last)) counts[k]! += 1;
    });
  }
  return counts;
}

/**
 * What the steps' leaves owe Cliopatria (streaming.md 7.3): each step draws as many leaves as it
 * has rows valid in its year, with those its corrections and the carry-through add and less those
 * they take away, each of them a polity some correction the step applies names or the
 * carry-through draws; and the steps holding the years task 0 compared have that comparison's
 * rows. `drawn` is each step's drawnLeaves.
 */
export function leafFindings(
  years: readonly number[],
  drawn: readonly number[],
  byStep: Readonly<Record<string, StepReview>>,
  compared: Readonly<Record<number, number>> = COMPARED_LEAVES,
): string[] {
  const found: string[] = [];
  years.forEach((year, k) => {
    const review = byStep[String(year)];
    const { added, removed, unexplained } = review ?? {};
    if (!review || !added || !removed || !unexplained) {
      found.push(`${year}: its review entry records no leaves added or taken away`);
      return;
    }
    const expected = review.leaves + added.length - removed.length;
    if (drawn[k] !== expected) {
      found.push(
        `${year}: ${drawn[k]} leaves drawn, not ${review.leaves} rows valid, ` +
          `${added.length} added and ${removed.length} taken away`,
      );
    }
    if (unexplained.length > 0) {
      found.push(`${year}: no correction names ${unexplained.join(', ')}`);
    }
  });
  for (const [year, leaves] of Object.entries(compared)) {
    const held = years[stepHolding(years, Number(year))];
    const review = held === undefined ? undefined : byStep[String(held)];
    if (review?.leaves !== leaves) {
      found.push(`${year}: ${review?.leaves ?? 'no'} rows valid, not the comparison's ${leaves}`);
    }
  }
  return found;
}

/** The step holding `year`: the last one beginning at or before it, or -1. */
export function stepHolding(years: readonly number[], year: number): number {
  let index = -1;
  while (index + 1 < years.length && years[index + 1]! <= year) index += 1;
  return index;
}
