// Seam flags for a drawn set of nodes (streaming.md 5.6 rules 1-4). A point on a node's boundary
// is shared with every drawn node whose closure holds it: across in-face edges, across face edges
// and at cube corners. Each node's flags say, relative to its own level and source, which group
// it is in at each edge half and each corner: the coarsest node there and the coarsest source.
// From those bits every node sharing a point derives the same source level and mip for it, so
// they sample the same values. lod.ts calls this after balancing; the tests call it on fixed sets.
// Neighbors come from FACE_EDGES and integer lattice coordinates, never from float comparisons.
import { FACE_EDGES, tileKey, type Edge, type Tile } from '../surface/cube';
import { flag } from './instances';
import type { Segments } from './tileGrid';

export interface DrawnNode {
  tile: Tile;
  /** The source level: the node draws its ancestor-or-self at this level. */
  source: number;
}

/** Lattice units per face side: a node's G segments at level 7 and G = 32 are one unit each. */
export const LATTICE = 4096;
const MAX_LEVEL = 7;

/** The edges in flag order, N 0, E 1, S 2, W 3, and the corners SW 0, SE 1, NW 2, NE 3. */
export const EDGE_ORDER: readonly Edge[] = ['N', 'E', 'S', 'W'];

export class CoverError extends Error {
  override name = 'CoverError';
}

interface Rep {
  face: number;
  X: number;
  Y: number;
}

/** Every face's name for a lattice point: one inside a face, two on a face edge, three at a corner. */
export function representations(face: number, X: number, Y: number): Rep[] {
  const reps: Rep[] = [{ face, X, Y }];
  for (let i = 0; i < reps.length; i += 1) {
    const rep = reps[i];
    if (!rep) break;
    for (const edge of edgesOn(rep.X, rep.Y)) {
      const mapped = across(rep, edge);
      if (!reps.some((r) => r.face === mapped.face)) reps.push(mapped);
    }
  }
  return reps;
}

/** A name for the point (k, l) of `tile`'s grid that every face agrees on: the lowest face's. */
export function latticePoint(tile: Tile, k: number, l: number, segments: Segments): string {
  const step = LATTICE / (segments * 2 ** tile.level);
  const X = (tile.x * segments + k) * step;
  const Y = (tile.y * segments + l) * step;
  const lowest = representations(tile.face, X, Y).reduce((a, b) => (b.face < a.face ? b : a));
  return `${lowest.face}:${lowest.X}:${lowest.Y}`;
}

/**
 * The drawn nodes that hold each lattice point, looked up by integer ids and remembered per
 * point: `lod.ts` runs this on every change of the drawn set, so it has to be cheap.
 */
export class DrawnGroups {
  readonly #index = new Map<number, DrawnNode>();
  readonly #groups = new Map<number, DrawnNode[]>();
  readonly #levels: [number, number];
  readonly duplicates: boolean;

  constructor(nodes: readonly DrawnNode[]) {
    let low = MAX_LEVEL;
    let high = 0;
    for (const node of nodes) {
      this.#index.set(tileId(node.tile), node);
      low = Math.min(low, node.tile.level);
      high = Math.max(high, node.tile.level);
    }
    this.#levels = [low, high];
    this.duplicates = this.#index.size !== nodes.length;
  }

  has(tile: Tile): boolean {
    return this.#index.has(tileId(tile));
  }

  /** Every drawn node whose closure holds the lattice point (face, X, Y), from any face. */
  at(face: number, X: number, Y: number): DrawnNode[] {
    const reps = representations(face, X, Y);
    const lowest = reps.reduce((a, b) => (b.face < a.face ? b : a));
    const key = (lowest.face * (LATTICE + 1) + lowest.X) * (LATTICE + 1) + lowest.Y;
    const known = this.#groups.get(key);
    if (known) return known;
    const group: DrawnNode[] = [];
    for (const rep of reps) {
      for (let level = this.#levels[0]; level <= this.#levels[1]; level += 1) {
        const span = LATTICE >> level;
        for (const x of cells(rep.X, span, 2 ** level)) {
          for (const y of cells(rep.Y, span, 2 ** level)) {
            const node = this.#index.get(tileId({ face: rep.face, level, x, y }));
            if (node && !group.includes(node)) group.push(node);
          }
        }
      }
    }
    this.#groups.set(key, group);
    return group;
  }
}

/**
 * Refuses a set lod.ts must never draw: a node drawn twice or with its ancestor (overlap), a gap
 * (unless `partial`, for test sets that cover part of the globe), node levels 2 apart across an
 * edge, sources 2 apart between nodes that touch at an edge or only at a corner, or a source
 * level that is not the node's own or an ancestor's.
 */
export function checkCover(nodes: readonly DrawnNode[], opts: { partial?: boolean } = {}): void {
  analyze(nodes, opts);
}

/**
 * The 24 seam bits of every node (instances.ts `flag`), by tile key, once the set passes
 * checkCover's rules. With `partial`, a missing neighbor counts as the node itself.
 */
export function seamFlags(
  nodes: readonly DrawnNode[],
  opts: { partial?: boolean } = {},
): Map<string, number> {
  return analyze(nodes, opts);
}

/** checkCover's rules and seamFlags' bits from one pass over each node's edge and corner groups. */
function analyze(nodes: readonly DrawnNode[], opts: { partial?: boolean }): Map<string, number> {
  const groups = new DrawnGroups(nodes);
  if (groups.duplicates) throw new CoverError('a node is drawn twice');
  let area = 0;
  for (const { tile, source } of nodes) {
    const key = tileKey(tile);
    if (!Number.isInteger(source) || source < 0 || source > tile.level) {
      throw new CoverError(`${key} draws source level ${source}, not an ancestor-or-self`);
    }
    for (let level = tile.level - 1; level >= 0; level -= 1) {
      const ancestor = ancestorAt(tile, level);
      if (groups.has(ancestor)) {
        throw new CoverError(`${key} overlaps its ancestor ${tileKey(ancestor)}`);
      }
    }
    area += 4 ** (MAX_LEVEL - tile.level);
  }
  if (!opts.partial && area !== 6 * 4 ** MAX_LEVEL) {
    throw new CoverError('the drawn nodes leave a hole');
  }

  const flags = new Map<string, number>();
  for (const node of nodes) {
    const { tile, source } = node;
    const key = tileKey(tile);
    const refuse = (group: readonly DrawnNode[], edge: boolean) => {
      for (const other of group) {
        const pair = `${key} and ${tileKey(other.tile)}`;
        if (edge && Math.abs(other.tile.level - tile.level) > 1) {
          throw new CoverError(`${pair} meet at an edge with node levels 2 apart`);
        }
        if (Math.abs(other.source - source) > 1) {
          throw new CoverError(`${pair} touch with sources 2 apart`);
        }
      }
    };
    const span = LATTICE >> tile.level;
    let bits = 0;
    EDGE_ORDER.forEach((edge, e) => {
      const halves = [1, 3].map((quarter) => {
        const { X, Y } = alongEdge(tile, edge, (quarter * span) / 4);
        const group = groups.at(tile.face, X, Y);
        refuse(group, true);
        return group;
      });
      if (halves.some((g) => g.some((other) => other.tile.level === tile.level - 1))) {
        bits |= flag.cN(e);
      }
      halves.forEach((g, half) => {
        if (coarsestSource(g) === source - 1) bits |= half === 0 ? flag.cS0(e) : flag.cS1(e);
      });
    });
    for (let c = 0; c < 4; c += 1) {
      const { X, Y } = corner(tile, c);
      const group = groups.at(tile.face, X, Y);
      refuse(group, false);
      const dN = tile.level - Math.min(...group.map((other) => other.tile.level));
      if (dN > 2) {
        throw new CoverError(`${key} has a node ${dN} levels coarser at a corner`);
      }
      bits |= flag.cornerDN(c, dN);
      if (coarsestSource(group) === source - 1) bits |= flag.cornerCS(c);
    }
    flags.set(key, bits);
  }
  return flags;
}

/** Rule 2's mip: clamp(7 − log2 G − (coarse − sample), 0, 2). */
export function vertexMip(segments: Segments, coarse: number, sample: number): 0 | 1 | 2 {
  const m = 7 - Math.log2(segments) - (coarse - sample);
  return Math.min(2, Math.max(0, m)) as 0 | 1 | 2;
}

export interface SharedPoint {
  /** The coarsest node level touching the point. */
  coarse: number;
  /** The source level the point samples: the coarsest source touching it. */
  lv: number;
  m: 0 | 1 | 2;
  /** Whether it samples the up tile (the source's parent). */
  up: boolean;
}

/**
 * What a node derives for its grid point (k, l) from its own bits, as the vertex shader does:
 * an edge point reads its half's cS bit (both at the midpoint) and the edge's cN bit; a corner
 * reads the corner's cS and dN; an interior point is the node's own.
 */
export function sharedPoint(
  node: DrawnNode,
  flags: number,
  k: number,
  l: number,
  segments: Segments,
): SharedPoint {
  const G = segments;
  const on = [l === G, k === G, l === 0, k === 0];
  const count = on.filter(Boolean).length;
  let up = false;
  let coarse = node.tile.level;
  if (count === 1) {
    const e = on.indexOf(true);
    const a = e === 0 || e === 2 ? k : l;
    const s0 = bit(flags, 4 + e);
    const s1 = bit(flags, 8 + e);
    up = a < G / 2 ? s0 : a > G / 2 ? s1 : s0 || s1;
    coarse -= Number(bit(flags, e));
  } else if (count === 2) {
    const c = 2 * Number(l === G) + Number(k === G);
    const cf = (flags >>> (12 + 3 * c)) & 7;
    up = (cf & 1) !== 0;
    coarse -= cf >> 1;
  }
  const lv = node.source - Number(up);
  return { coarse, lv, m: vertexMip(segments, coarse, lv), up };
}

/** Whether grid point (k, l) is a T-junction: an odd vertex on an edge whose neighbor is coarser. */
export function isTJunction(flags: number, k: number, l: number, segments: Segments): boolean {
  const G = segments;
  const on = [l === G, k === G, l === 0, k === 0];
  if (on.filter(Boolean).length !== 1) return false;
  const e = on.indexOf(true);
  return bit(flags, e) && ((e === 0 || e === 2 ? k : l) & 1) === 1;
}

/** The ancestor of `tile` at `level`. */
export function ancestorAt(tile: Tile, level: number): Tile {
  const d = tile.level - level;
  return { face: tile.face, level, x: tile.x >> d, y: tile.y >> d };
}

/** An integer id for a tile: 6 faces × 128² cells per level. */
function tileId(t: Tile): number {
  return ((t.level * 6 + t.face) * 128 + t.x) * 128 + t.y;
}

function coarsestSource(group: readonly DrawnNode[]): number {
  return Math.min(...group.map((node) => node.source));
}

function bit(flags: number, b: number): boolean {
  return ((flags >>> b) & 1) === 1;
}

/** The cells of size `span` (of `count`) whose closure holds coordinate `v`. */
function cells(v: number, span: number, count: number): number[] {
  const q = Math.floor(v / span);
  const candidates = v % span === 0 ? [q - 1, q] : [q];
  return candidates.filter((c) => c >= 0 && c < count);
}

function edgesOn(X: number, Y: number): Edge[] {
  const edges: Edge[] = [];
  if (Y === LATTICE) edges.push('N');
  if (X === LATTICE) edges.push('E');
  if (Y === 0) edges.push('S');
  if (X === 0) edges.push('W');
  return edges;
}

/** The same point named by the face across `edge`. */
function across(rep: Rep, edge: Edge): Rep {
  const faceEdges = FACE_EDGES[rep.face];
  if (!faceEdges) throw new RangeError(`no face ${rep.face}`);
  const [face, facing, reversed] = faceEdges[edge];
  const along = edge === 'N' || edge === 'S' ? rep.X : rep.Y;
  const a = reversed ? LATTICE - along : along;
  switch (facing) {
    case 'N':
      return { face, X: a, Y: LATTICE };
    case 'S':
      return { face, X: a, Y: 0 };
    case 'E':
      return { face, X: LATTICE, Y: a };
    case 'W':
      return { face, X: 0, Y: a };
  }
}

/** The lattice point `t` units along `edge` of `tile`, from its S or W end. */
function alongEdge(tile: Tile, edge: Edge, t: number): { X: number; Y: number } {
  const span = LATTICE >> tile.level;
  const x0 = tile.x * span;
  const y0 = tile.y * span;
  switch (edge) {
    case 'N':
      return { X: x0 + t, Y: y0 + span };
    case 'S':
      return { X: x0 + t, Y: y0 };
    case 'E':
      return { X: x0 + span, Y: y0 + t };
    case 'W':
      return { X: x0, Y: y0 + t };
  }
}

/** Corner c of `tile`: SW 0, SE 1, NW 2, NE 3. */
function corner(tile: Tile, c: number): { X: number; Y: number } {
  const span = LATTICE >> tile.level;
  return { X: (tile.x + (c & 1)) * span, Y: (tile.y + (c >> 1)) * span };
}
