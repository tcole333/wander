// Which nodes the streamed globe draws: a quadtree refined from the six L0 nodes while a node's
// texels cover more than `refinePx` CSS px at its nearest point, with nodes wholly behind the
// horizon or outside the frustum culled, then balanced so nodes that share an edge differ by at
// most one level, across face edges too (streaming.md 5.6 rule 1). Culled leaves take part in the
// balance and are dropped after it, so the drawn nodes are part of a whole balanced cover and
// inherit its corner bound: a diagonal node is at most two levels coarser (dN <= 2).
// Everything here is in the globe frame: three.js axes, Earth radius 1.
import { Frustum, Sphere, Vector3 } from 'three';
import { ancestorAt } from '../../globe/seamFlags';
import { EDGES, neighbor, stToDir, toThree, type Tile } from '../../surface/cube';

/** The relief exaggeration the bounds allow for, land and sea. */
export const K_MAX = 16;
export const EARTH_RADIUS_M = 6_371_008.8;
const TILE_TEXELS = 256;

export interface LodView {
  /** The camera in the globe frame. */
  eye: Vector3;
  /** The view frustum in the globe frame, or null to cull by the horizon only. */
  frustum: Frustum | null;
  /** CSS px per unit of size at unit distance: viewport height over 2·tan(fovY / 2). */
  pxPerUnit: number;
  refinePx: number;
  maxLevel: number;
  /** Whether to cull at all; off, every leaf is drawn. */
  cull: boolean;
}

export interface LodData {
  /** Whether the release has a tile for the node. */
  available(tile: Tile): boolean;
  /** Meters anything drawn inside the node can take, [min, max]. */
  heightRange(tile: Tile): readonly [number, number];
  /** The lowest meters anywhere: the horizon's occluding sphere lies below it. */
  hMin: number;
}

interface Shape {
  /** The node's center direction, unit length. */
  center: Vector3;
  /** The largest angle from the center to the node's boundary. */
  radius: number;
}

interface Leaf {
  tile: Tile;
  culled: boolean;
}

/** An integer id for a tile, as seamFlags.ts keys them: 6 faces × 128² cells per level. */
export function tileId(t: Tile): number {
  return ((t.level * 6 + t.face) * 128 + t.x) * 128 + t.y;
}

export function childrenOf(t: Tile): Tile[] {
  return [0, 1, 2, 3].map((i) => ({
    face: t.face,
    level: t.level + 1,
    x: 2 * t.x + (i & 1),
    y: 2 * t.y + (i >> 1),
  }));
}

/** The texel's angle at level `level`: a face spans π/2 across 256·2^level texels. */
export function texelAngle(level: number): number {
  return Math.PI / 2 / (TILE_TEXELS * 2 ** level);
}

export class NodeSelector {
  readonly #data: LodData;
  readonly #shapes = new Map<number, Shape>();
  /** The occluder: a sphere the displaced surface never dips below at kSea up to K_MAX. */
  readonly #occluder: number;
  readonly #sphere = new Sphere();
  /** The nodes culled in the last selection, for the stats. */
  culled = 0;

  constructor(data: LodData) {
    this.#data = data;
    this.#occluder = 1 + Math.min(0, K_MAX * data.hMin) / EARTH_RADIUS_M;
  }

  /** The drawn nodes for `view`: refined, culled and balanced. */
  select(view: LodView): Tile[] {
    const leaves = new Map<number, Leaf>();
    const visit = (tile: Tile) => {
      const culled = this.#culled(tile, view);
      if (!culled && this.#wantsSplit(tile, view)) {
        for (const child of childrenOf(tile)) visit(child);
        return;
      }
      leaves.set(tileId(tile), { tile, culled });
    };
    for (let face = 0; face < 6; face += 1) visit({ face, level: 0, x: 0, y: 0 });
    this.#balance(leaves, view);
    const drawn: Tile[] = [];
    this.culled = 0;
    for (const leaf of leaves.values()) {
      if (leaf.culled) this.culled += 1;
      else drawn.push(leaf.tile);
    }
    return drawn;
  }

  /** The node's center direction in the globe frame. */
  centerOf(tile: Tile): Vector3 {
    return this.#shape(tile).center;
  }

  #wantsSplit(tile: Tile, view: LodView): boolean {
    if (tile.level >= view.maxLevel) return false;
    const footprintPx = (texelAngle(tile.level) * view.pxPerUnit) / this.#nearest(tile, view.eye);
    if (footprintPx <= view.refinePx) return false;
    // Deeper than any tile only as far as the balance needs.
    return childrenOf(tile).some((child) => this.#data.available(child));
  }

  /** The distance from `eye` to the nearest point of the node's shell, conservatively. */
  #nearest(tile: Tile, eye: Vector3): number {
    const { center, radius } = this.#shape(tile);
    const [rMin, rMax] = this.#radii(tile);
    const d = eye.length();
    const phi = Math.max(0, eye.angleTo(center) - radius);
    const r = Math.min(rMax, Math.max(rMin, d * Math.cos(phi)));
    return Math.max(1e-9, Math.sqrt(Math.max(0, d * d + r * r - 2 * d * r * Math.cos(phi))));
  }

  #culled(tile: Tile, view: LodView): boolean {
    if (!view.cull) return false;
    const { center, radius } = this.#shape(tile);
    const [rMin, rMax] = this.#radii(tile);
    const d = view.eye.length();
    const rho = this.#occluder;
    // Wholly behind the horizon: past the occluder's horizon seen from the eye, plus the angle over
    // which the node's highest point still peeks above it.
    if (d > rho) {
      const beyond = view.eye.angleTo(center) - radius;
      if (beyond > Math.acos(rho / d) + Math.acos(Math.min(1, rho / rMax))) return true;
    }
    if (!view.frustum) return false;
    // A sphere around the shell over the node's cap: the farthest points sit on the cap's rim.
    const cosA = Math.cos(Math.min(radius, Math.PI / 2));
    const rc = (rMin * cosA + rMax) / 2;
    const reach = (r: number) => Math.sqrt(Math.max(0, r * r + rc * rc - 2 * r * rc * cosA));
    this.#sphere.center.copy(center).multiplyScalar(rc);
    this.#sphere.radius = Math.max(reach(rMin), reach(rMax));
    return !view.frustum.intersectsSphere(this.#sphere);
  }

  /** The node's lowest and highest radius at K_MAX, from its height range. */
  #radii(tile: Tile): [number, number] {
    const [low, high] = this.#data.heightRange(tile);
    return [
      1 + Math.min(0, K_MAX * low) / EARTH_RADIUS_M,
      1 + Math.max(0, K_MAX * high) / EARTH_RADIUS_M,
    ];
  }

  /**
   * Splits the coarser node wherever two leaves that share an edge differ by more than one level,
   * until none do. A leaf is rechecked after each split next to it, and new children in turn.
   */
  #balance(leaves: Map<number, Leaf>, view: LodView): void {
    const queue = [...leaves.values()];
    while (queue.length > 0) {
      const leaf = queue.pop();
      if (!leaf || leaves.get(tileId(leaf.tile)) !== leaf) continue;
      for (const edge of EDGES) {
        const coarse = coveringLeaf(leaves, neighbor(leaf.tile, edge).tile);
        if (!coarse || coarse.tile.level >= leaf.tile.level - 1) continue;
        leaves.delete(tileId(coarse.tile));
        for (const tile of childrenOf(coarse.tile)) {
          const child = { tile, culled: this.#culled(tile, view) };
          leaves.set(tileId(tile), child);
          queue.push(child);
        }
        queue.push(leaf);
        break;
      }
    }
  }

  #shape(tile: Tile): Shape {
    const id = tileId(tile);
    const known = this.#shapes.get(id);
    if (known) return known;
    const n = 2 ** tile.level;
    const s = (i: number) => -1 + (2 * i) / n;
    const dir = (a: number, b: number) =>
      new Vector3(...toThree(stToDir(tile.face, s(tile.x + a), s(tile.y + b))));
    const center = dir(0.5, 0.5);
    // Tile edges are great-circle arcs, so the farthest boundary point is a corner.
    let radius = 0;
    for (const [a, b] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const) {
      radius = Math.max(radius, center.angleTo(dir(a, b)));
    }
    const shape = { center, radius };
    this.#shapes.set(id, shape);
    return shape;
  }
}

/** The leaf that covers `tile`'s region at its level or coarser, if any. */
function coveringLeaf(leaves: Map<number, Leaf>, tile: Tile): Leaf | undefined {
  for (let level = tile.level; level >= 0; level -= 1) {
    const leaf = leaves.get(tileId(ancestorAt(tile, level)));
    if (leaf) return leaf;
  }
  return undefined;
}
