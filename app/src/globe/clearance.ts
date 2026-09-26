// The camera's terrain ceiling (streaming.md 5.7, Camera clearance): a continuous bound on how
// high the drawn surface can reach near a direction, built once from bounds.bin and availability. It never reads resident tiles, so it does not move when finer tiles land and the
// camera cannot pop. Land displaces by kLand·max(h, 0) and sea never rises above 0 (5.6 rule 7),
// so kLand times a node's highest reachable height bounds every vertex drawn inside it.
import {
  EDGES,
  faceOf,
  faceSt,
  neighbor,
  nodeIndex,
  stToDir,
  tileKey,
  tileOf,
  type Tile,
  type Vec3,
} from '../surface/cube';
import type { SurfaceLayer } from '../data/surfaceLayer';

/** The face's quarter circle: a level-L node spans about (π/2)/2^L radians. */
const FACE_SPAN = Math.PI / 2;

interface NodeShape {
  center: Vec3;
  /** The largest angle from the center to the node's boundary. */
  radius: number;
}

export class ClearanceField {
  readonly #layer: Pick<SurfaceLayer, 'bounds' | 'available' | 'surface'>;
  readonly #ceiling = new Map<string, number>();
  readonly #below = new Map<string, number>();
  readonly #shapes = new Map<string, NodeShape>();
  /** The lowest and highest meter bounds of any available node. */
  readonly hMin: number;
  readonly hMax: number;

  constructor(layer: Pick<SurfaceLayer, 'bounds' | 'available' | 'surface'>) {
    this.#layer = layer;
    let low = Infinity;
    let high = -Infinity;
    for (const [min, max] of layer.bounds.values()) {
      low = Math.min(low, min);
      high = Math.max(high, max);
    }
    this.hMin = low;
    this.hMax = high;
  }

  /**
   * Meters the surface can reach within `capRad` radians of `dir` (globe frame G) at relief
   * `kLand`. Levels blend by the cap's size, and nodes fade out between one and two cap radii,
   * so the result is continuous in both.
   */
  ceilingM(dir: Vec3, capRad: number, kLand: number): number {
    const maxLevel = this.#layer.surface.maxLevel;
    const level = Math.min(maxLevel, Math.max(0, Math.log2(FACE_SPAN / (2 * capRad))));
    const coarse = Math.floor(level);
    const f = level - coarse;
    const at = (l: number) => this.#atLevel(dir, capRad, kLand, l);
    return f === 0 ? at(coarse) : (1 - f) * at(coarse) + f * at(Math.min(coarse + 1, maxLevel));
  }

  /**
   * The highest meters anything drawn inside `tile` can take. With a tile of its own, that is the
   * highest bound in its available subtree: itself, and every descendant that draws there when the
   * view is finer (a coarse tile's texels average its finer tiles' peaks away, so they are needed).
   * A coarser source or the up tile at a seam draws averages of the same ground, which cannot rise
   * above that, but for the one coarse texel a seam point reaches across the node's edge: the
   * neighbors' own terms, the weights' fade band and the camera's margin cover it. Without a tile
   * of its own, the node draws its deepest available ancestor.
   */
  heightCeiling(tile: Tile): number {
    const key = tileKey(tile);
    const known = this.#ceiling.get(key);
    if (known !== undefined) return known;
    let high = this.#subtree(tile);
    for (let level = tile.level - 1; level >= 0 && high === -Infinity; level -= 1) {
      const d = tile.level - level;
      high = this.#own({ face: tile.face, level, x: tile.x >> d, y: tile.y >> d });
    }
    this.#ceiling.set(key, high);
    return high;
  }

  #atLevel(dir: Vec3, capRad: number, kLand: number, level: number): number {
    const face = faceOf(dir);
    const [s, t] = faceSt(face, dir);
    const start: Tile = { face, level, x: tileOf(s, level), y: tileOf(t, level) };
    const seen = new Set<string>([tileKey(start)]);
    const queue = [start];
    let high = 0;
    for (let i = 0; i < queue.length; i += 1) {
      const tile = queue[i];
      if (!tile) break;
      const { center, radius } = this.#shape(tile);
      const delta = Math.max(0, angle(dir, center) - radius);
      if (delta >= 2 * capRad && i > 0) continue;
      high = Math.max(high, weight(delta / capRad) * Math.max(0, kLand * this.heightCeiling(tile)));
      for (const edge of EDGES) {
        const next = neighbor(tile, edge).tile;
        const key = tileKey(next);
        if (!seen.has(key)) {
          seen.add(key);
          queue.push(next);
        }
      }
    }
    return high;
  }

  /** The node's own highest bound, or −Infinity when it has no tile. */
  #own(tile: Tile): number {
    if (!this.#layer.available(tile)) return -Infinity;
    return this.#layer.bounds.get(nodeIndex(tile))?.[1] ?? -Infinity;
  }

  /** The highest bound in the node's available subtree, itself included. */
  #subtree(tile: Tile): number {
    const key = tileKey(tile);
    const known = this.#below.get(key);
    if (known !== undefined) return known;
    let high = this.#own(tile);
    if (high > -Infinity && tile.level < this.#layer.surface.maxLevel) {
      for (let i = 0; i < 4; i += 1) {
        const child = {
          face: tile.face,
          level: tile.level + 1,
          x: 2 * tile.x + (i & 1),
          y: 2 * tile.y + (i >> 1),
        };
        high = Math.max(high, this.#subtree(child));
      }
    }
    this.#below.set(key, high);
    return high;
  }

  #shape(tile: Tile): NodeShape {
    const key = tileKey(tile);
    const known = this.#shapes.get(key);
    if (known) return known;
    const n = 2 ** tile.level;
    const s = (i: number) => -1 + (2 * i) / n;
    const center = stToDir(tile.face, s(tile.x + 0.5), s(tile.y + 0.5));
    let radius = 0;
    for (const [a, b] of [
      [0, 0],
      [0.5, 0],
      [1, 0],
      [1, 0.5],
      [1, 1],
      [0.5, 1],
      [0, 1],
      [0, 0.5],
    ] as const) {
      radius = Math.max(radius, angle(center, stToDir(tile.face, s(tile.x + a), s(tile.y + b))));
    }
    const shape = { center, radius };
    this.#shapes.set(key, shape);
    return shape;
  }
}

/** 1 within one cap radius, easing to 0 at two (smoothstep), 0 beyond. */
function weight(u: number): number {
  if (u <= 1) return 1;
  if (u >= 2) return 0;
  const x = u - 1;
  return 1 - x * x * (3 - 2 * x);
}

function angle(a: Vec3, b: Vec3): number {
  const cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return Math.atan2(Math.hypot(...cross), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
}
