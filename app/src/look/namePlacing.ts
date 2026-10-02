// Which state names show and where they stand on screen (streaming.md 3.3, Names), as the look's
// names layer asks each frame (stateNames.ts). Pure: no three, no DOM.
//
// A name shows by its em on screen: fading in over `in` and out again over `out` (CSS px), its em
// drawn no larger than `cap`, so an empire's name never outweighs the map. A region shows one form
// and level of its name at a time: its short name far and its full name close, by the full name's
// em on screen, and the lowest level whose name stands at full strength, else the lowest shown at
// all, each choice kept until the view has moved past it by a margin. Names that would overlap on
// screen give way, the stronger in priority keeping its place, and none stands over an obstacle: a
// sea name, a story's callout or a plate. The event marks are no obstacle: they lie over the
// names, which the look draws under them. A name kept last frame needs less room to stay than a new
// one needs to come, so names that touch do not flicker. A name repeats on screen only far from its
// other copies. Then each kept name goes into every screen tile its footprint reaches, or, where
// one is full, none, so no name is drawn cut along a tile's edge.
import { smoothstep } from '../story/effects/timeline';

/** A plane's sizes, CSS px of em: the fade in, the largest drawn, the fade out. */
export interface NameSize {
  in: readonly [number, number];
  cap: number;
  out: readonly [number, number];
}

/** How strongly a name shows by its em on screen, `emPx` CSS px, before any other fade. */
export function sizeFade(emPx: number, size: NameSize): number {
  return (
    smoothstep(size.in[0], size.in[1], emPx) * (1 - smoothstep(size.out[0], size.out[1], emPx))
  );
}

/** A region's choice: the level its name shows at, and whether in its short form. */
export interface RegionChoice {
  level: number;
  short: boolean;
}

/** A placement of a region's name, as the region's choice reads it. */
export interface RegionEntry {
  level: number;
  short: boolean;
  /** Its size fade on screen now (sizeFade). */
  reveal: number;
  /** Its em on screen, CSS px. */
  emPx: number;
}

/** A region's choices change only past these margins: its form's in CSS px, its level's in reveal. */
export const CHOICE_MARGIN = { px: 1, full: 0.8, keep: 0.6 } as const;

/**
 * A region's form and level this frame. The level: the lowest whose placements stand at full
 * strength (a reveal of CHOICE_MARGIN.full), else the lowest shown at all; the level shown last
 * frame stays while it still stands at CHOICE_MARGIN.keep and no lower one is at full strength. The
 * form, at level 0: the full name once its em on screen reaches `fullPx`, the short name below it,
 * each kept until the em has passed `fullPx` by CHOICE_MARGIN.px; windows show the full name.
 */
export function chooseInRegion(
  entries: readonly RegionEntry[],
  fullPx: number,
  previous: RegionChoice | undefined,
): RegionChoice | null {
  const shown = entries.filter((entry) => entry.reveal > 0);
  if (shown.length === 0) return null;
  const strongest = new Map<number, number>();
  for (const entry of shown) {
    strongest.set(entry.level, Math.max(strongest.get(entry.level) ?? 0, entry.reveal));
  }
  const levels = [...strongest.keys()].sort((a, b) => a - b);
  const full = levels.find((level) => (strongest.get(level) ?? 0) >= CHOICE_MARGIN.full);
  let level = full ?? levels[0] ?? 0;
  if (previous && (strongest.get(previous.level) ?? 0) >= CHOICE_MARGIN.keep) {
    if (full === undefined || full >= previous.level) level = previous.level;
  }
  if (level !== 0) return { level, short: false };
  const fullEntry = entries.find((entry) => entry.level === 0 && !entry.short);
  const hasShort = entries.some((entry) => entry.level === 0 && entry.short);
  if (!hasShort || !fullEntry) return { level, short: false };
  const was = previous?.level === 0 ? previous.short : fullEntry.emPx < fullPx;
  const threshold = fullPx + (was ? CHOICE_MARGIN.px : -CHOICE_MARGIN.px);
  return { level, short: fullEntry.emPx < threshold };
}

/** A name's footprint on screen, CSS px: discs along its baseline, (x, y, radius) each. */
export type Footprint = Float64Array;

/** A box no name may stand over, CSS px: a sea name's, a callout's or a plate's. */
export interface ObstacleBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A name in the running for its place, in priority order. */
export interface Contender {
  id: string;
  /** Its name and plane: two copies of one name, or one name crossfading between steps. */
  name: string;
  /** The steps it is drawn from, a bit each: two names in different steps' alone crossfade. */
  sources: number;
  /** Its letters and the calm band about them, which no other name's may overlap. */
  footprint: Footprint;
  /** The share of each disc's radius its letters fill: what an obstacle may not overlap. */
  core: number;
  /** Whether it was kept last frame. */
  kept: boolean;
}

/**
 * Room around a name's footprint, CSS px: a kept name stays while it clears others by `keep`, a
 * new one comes only once it clears them by `come`.
 */
export const ROOM_PX = { keep: 0, come: 6 } as const;

/**
 * The contenders that keep their places, by id: each in turn, if its letters, grown by its room,
 * clear every obstacle, its footprint, grown by its room, clears every name already kept, and it
 * stands `apartPx` from every kept copy of its name (a name crossfading between steps excepted,
 * which neither its other step's place nor its copies hold back). An obstacle may lie over a calm
 * band, which the look draws under it.
 */
export function keepApart(
  contenders: readonly Contender[],
  obstacles: readonly ObstacleBox[],
  apartPx: number,
): Set<string> {
  const kept = new Set<string>();
  const grid = new DiscGrid(64);
  const placed: { contender: Contender; center: [number, number] }[] = [];
  for (const contender of contenders) {
    const room = contender.kept ? ROOM_PX.keep : ROOM_PX.come;
    const { footprint } = contender;
    if (hitsObstacles(footprint, contender.core, obstacles, room)) continue;
    const center = middleOf(footprint);
    const crossfade = (other: Contender) =>
      other.name === contender.name && (other.sources & contender.sources) === 0;
    const copy = placed.some(
      ({ contender: other, center: c }) =>
        other.name === contender.name &&
        !crossfade(other) &&
        Math.hypot(c[0] - center[0], c[1] - center[1]) < apartPx,
    );
    if (copy) continue;
    if (grid.hits(footprint, room, (owner) => !crossfade(owner))) continue;
    grid.add(footprint, contender);
    placed.push({ contender, center });
    kept.add(contender.id);
  }
  return kept;
}

/** The footprint's middle disc: where a name stands on screen. */
export function middleOf(footprint: Footprint): [number, number] {
  const discs = footprint.length / 3;
  const mid = Math.floor(discs / 2) * 3;
  return [footprint[mid] ?? 0, footprint[mid + 1] ?? 0];
}

function hitsObstacles(
  footprint: Footprint,
  core: number,
  boxes: readonly ObstacleBox[],
  room: number,
): boolean {
  for (let i = 0; i < footprint.length; i += 3) {
    const x = footprint[i] ?? 0;
    const y = footprint[i + 1] ?? 0;
    const r = (footprint[i + 2] ?? 0) * core + room;
    for (const box of boxes) {
      const nx = Math.max(box.x0, Math.min(x, box.x1));
      const ny = Math.max(box.y0, Math.min(y, box.y1));
      if ((x - nx) ** 2 + (y - ny) ** 2 < r * r) return true;
    }
  }
  return false;
}

/** Kept names' discs in square cells `side` CSS px across, for the overlap test. */
class DiscGrid {
  readonly #side: number;
  readonly #cells = new Map<string, { x: number; y: number; r: number; owner: Contender }[]>();

  constructor(side: number) {
    this.#side = side;
  }

  add(footprint: Footprint, owner: Contender): void {
    for (let i = 0; i < footprint.length; i += 3) {
      const disc = {
        x: footprint[i] ?? 0,
        y: footprint[i + 1] ?? 0,
        r: footprint[i + 2] ?? 0,
        owner,
      };
      for (const key of this.#keys(disc.x, disc.y, disc.r)) {
        const list = this.#cells.get(key);
        if (list) list.push(disc);
        else this.#cells.set(key, [disc]);
      }
    }
  }

  /** Whether a disc of the footprint, grown by `room`, overlaps a kept disc that `counts`. */
  hits(footprint: Footprint, room: number, counts: (owner: Contender) => boolean): boolean {
    for (let i = 0; i < footprint.length; i += 3) {
      const x = footprint[i] ?? 0;
      const y = footprint[i + 1] ?? 0;
      const r = (footprint[i + 2] ?? 0) + room;
      for (const key of this.#keys(x, y, r)) {
        for (const disc of this.#cells.get(key) ?? []) {
          const reach = r + disc.r;
          if ((x - disc.x) ** 2 + (y - disc.y) ** 2 < reach * reach && counts(disc.owner)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  #keys(x: number, y: number, r: number): string[] {
    const s = this.#side;
    const keys: string[] = [];
    for (let gy = Math.floor((y - r) / s); gy <= Math.floor((y + r) / s); gy++) {
      for (let gx = Math.floor((x - r) / s); gx <= Math.floor((x + r) / s); gx++) {
        keys.push(`${gx},${gy}`);
      }
    }
    return keys;
  }
}

/** The screen's tiles: their side in CSS px, and how many across and down. */
export interface NameGrid {
  tilePx: number;
  across: number;
  down: number;
}

/** The tiles over a viewport `width` by `height` CSS px, `tilePx` a side, doubled past `most`. */
export function nameGrid(width: number, height: number, tilePx: number, most: number): NameGrid {
  let side = tilePx;
  const tiles = (s: number) => Math.ceil(width / s) * Math.ceil(height / s);
  while (tiles(side) > most) side *= 2;
  return {
    tilePx: side,
    across: Math.max(1, Math.ceil(width / side)),
    down: Math.max(1, Math.ceil(height / side)),
  };
}

/** The tiles and what each lists, as packed into the names' table. */
export interface NameBins extends NameGrid {
  /** Per tile: its first slot and its count. */
  starts: Uint32Array;
  counts: Uint8Array;
  /** Names by slot, each tile's in priority order. */
  slots: Uint16Array;
  /** Per footprint, 1 if it went into the tiles it reaches; 0 if one was full, or slots ran out. */
  binned: Uint8Array;
}

/**
 * Bins footprints (in priority order) into the grid's tiles, at most `cap` a tile and `slotsMax`
 * in all: a name goes into every tile one of its discs, grown `grow` times, reaches, or, where one
 * of those is full, into none.
 */
export function binFootprints(
  footprints: readonly Footprint[],
  grid: NameGrid,
  cap: number,
  slotsMax: number,
  grow = 1,
): NameBins {
  const { tilePx, across, down } = grid;
  const counts = new Uint8Array(across * down);
  const binned = new Uint8Array(footprints.length);
  const pairs: number[] = [];
  const touched = new Set<number>();
  footprints.forEach((footprint, n) => {
    touched.clear();
    for (let i = 0; i < footprint.length; i += 3) {
      const x = footprint[i] ?? 0;
      const y = footprint[i + 1] ?? 0;
      const r = (footprint[i + 2] ?? 0) * grow;
      const x0 = Math.max(0, Math.floor((x - r) / tilePx));
      const x1 = Math.min(across - 1, Math.floor((x + r) / tilePx));
      const y0 = Math.max(0, Math.floor((y - r) / tilePx));
      const y1 = Math.min(down - 1, Math.floor((y + r) / tilePx));
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const nx = Math.max(tx * tilePx, Math.min(x, (tx + 1) * tilePx));
          const ny = Math.max(ty * tilePx, Math.min(y, (ty + 1) * tilePx));
          if ((nx - x) ** 2 + (ny - y) ** 2 <= r * r) touched.add(ty * across + tx);
        }
      }
    }
    if (touched.size === 0 || pairs.length / 2 + touched.size > slotsMax) return;
    for (const t of touched) if ((counts[t] ?? 0) >= cap) return;
    for (const t of touched) {
      counts[t] = (counts[t] ?? 0) + 1;
      pairs.push(t, n);
    }
    binned[n] = 1;
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
  return { ...grid, starts, counts, slots, binned };
}
