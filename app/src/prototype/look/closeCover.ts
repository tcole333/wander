// A small drawn set around a target for the look harness: a disc of base-level nodes, split finer
// toward the target, balanced so node levels across an edge differ by
// at most one, each drawing its deepest available ancestor-or-self with touching sources at most
// one level apart. It is a partial cover, for seamFlags with `partial`.
import type { DrawnNode } from '../../globe/seamFlags';
import { ancestorAt } from '../../globe/seamFlags';
import { lonLatToDir, stToDir, type Tile, type Vec3 } from '../../surface/cube';

const MAX_LEVEL = 7;

export interface CoverOptions {
  /** Longitude and latitude in degrees. */
  target: [number, number];
  /** The level of the disc's nodes. */
  base: number;
  /** Base nodes whose nearest point lies within this many degrees of the target. */
  radiusDeg: number;
  /** refineDeg[L]: a level-L node splits when its nearest point lies within this many degrees. */
  refineDeg: readonly number[];
  available: (tile: Tile) => boolean;
}

export function closeCover(options: CoverOptions): DrawnNode[] {
  const { base, radiusDeg, refineDeg, available } = options;
  const target = lonLatToDir(...options.target);
  const side = 2 ** base;
  let tiles: Tile[] = [];
  for (let face = 0; face < 6; face += 1) {
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        const tile = { face, level: base, x, y };
        if (nearestDeg(tile, target) < radiusDeg) tiles.push(tile);
      }
    }
  }
  for (let level = base; level < MAX_LEVEL; level += 1) {
    const reach = refineDeg[level] ?? 0;
    tiles = tiles.flatMap((t) =>
      t.level === level && nearestDeg(t, target) < reach ? children(t) : [t],
    );
  }
  tiles = balance(tiles);
  return settleSources(
    tiles.map((tile) => {
      let source = tile.level;
      while (source > 0 && !available(ancestorAt(tile, source))) source -= 1;
      return { tile, source };
    }),
  );
}

export function children(t: Tile): Tile[] {
  const level = t.level + 1;
  return [0, 1, 2, 3].map((i) => ({
    face: t.face,
    level,
    x: 2 * t.x + (i & 1),
    y: 2 * t.y + (i >> 1),
  }));
}

/** Degrees from `target` to the tile's nearest point, bounded below by its circumscribed cap. */
function nearestDeg(t: Tile, target: Vec3): number {
  const n = 2 ** t.level;
  const st = (i: number) => -1 + (2 * i) / n;
  const center = stToDir(t.face, st(t.x + 0.5), st(t.y + 0.5));
  let cap = 0;
  for (const [a, b] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const) {
    cap = Math.max(cap, angleDeg(center, stToDir(t.face, st(t.x + a), st(t.y + b))));
  }
  return Math.max(0, angleDeg(center, target) - cap);
}

function angleDeg(a: Vec3, b: Vec3): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
}

/** The tile's closed rectangle in level-7 units on its face. */
function rect(t: Tile): [number, number, number, number] {
  const k = 2 ** (MAX_LEVEL - t.level);
  return [t.x * k, t.y * k, (t.x + 1) * k, (t.y + 1) * k];
}

/**
 * Whether two tiles on one face share an edge segment of positive length. Refinement stays far
 * from face edges, so tiles on two faces are left alone.
 */
function shareEdge(a: Tile, b: Tile): boolean {
  if (a.face !== b.face) return false;
  const [ax0, ay0, ax1, ay1] = rect(a);
  const [bx0, by0, bx1, by1] = rect(b);
  const xOverlap = Math.min(ax1, bx1) - Math.max(ax0, bx0);
  const yOverlap = Math.min(ay1, by1) - Math.max(ay0, by0);
  return (
    ((ax1 === bx0 || bx1 === ax0) && yOverlap > 0) || ((ay1 === by0 || by1 === ay0) && xOverlap > 0)
  );
}

/** Whether two tiles on one face touch at an edge or a corner. */
function touch(a: Tile, b: Tile): boolean {
  if (a.face !== b.face) return false;
  const [ax0, ay0, ax1, ay1] = rect(a);
  const [bx0, by0, bx1, by1] = rect(b);
  return ax0 <= bx1 && bx0 <= ax1 && ay0 <= by1 && by0 <= ay1;
}

/** Splits the coarser of any two edge neighbors whose levels differ by more than one. */
function balance(tiles: Tile[]): Tile[] {
  for (;;) {
    const split = tiles.find((a) => tiles.some((b) => b.level > a.level + 1 && shareEdge(a, b)));
    if (!split) return tiles;
    tiles = [...tiles.filter((t) => t !== split), ...children(split)];
  }
}

/** Lowers sources until every two touching nodes' sources differ by at most one. */
function settleSources(nodes: DrawnNode[]): DrawnNode[] {
  let changed = true;
  while (changed) {
    changed = false;
    for (const a of nodes) {
      for (const b of nodes) {
        if (a.source > b.source + 1 && touch(a.tile, b.tile)) {
          a.source = b.source + 1;
          changed = true;
        }
      }
    }
  }
  return nodes;
}
