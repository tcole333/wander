// Where a packed scenario's instances meet (streaming.md 5.6, 7.3): the grid vertices of different
// instances that name the same lattice point, and each T-junction with the coarse instance's
// vertices at its two neighbors. The vertex mirror's Vitest suites and the GPU readback page both
// check their values here, the mirror's in Node and the GPU's in the browser. Test data only.
import { tileKey } from '../surface/cube';
import type { PackedScenario } from './meshScenarios';
import { isTJunction, latticePoint } from './seamFlags';
import { SURFACE, type TileGrid } from './tileGrid';

/** A grid vertex of one instance. */
export interface VertexRef {
  instance: number;
  vertex: number;
}

/** (k, l, role) of grid vertex v. */
export function gridVertex(grid: TileGrid, v: number): [k: number, l: number, role: number] {
  const [k = NaN, l = NaN, role = NaN] = grid.position.subarray(3 * v, 3 * v + 3);
  return [k, l, role];
}

/** The surface vertex a grid vertex (a skirt bottom's top, or itself) sits on. */
export function surfaceVertexOf(grid: TileGrid, v: number): number {
  const [k, l] = gridVertex(grid, v);
  return l * (grid.segments + 1) + k;
}

/**
 * The surface vertices of every lattice point two or more instances hold, by latticePoint: the
 * points an in-face seam, a face edge or a cube corner shares.
 */
export function sharedPointGroups(
  packed: PackedScenario,
  grid: TileGrid,
): Map<string, VertexRef[]> {
  const G = grid.segments;
  const all = new Map<string, VertexRef[]>();
  packed.instances.forEach(({ node }, instance) => {
    for (let vertex = 0; vertex < grid.vertexCount; vertex += 1) {
      const [k, l, role] = gridVertex(grid, vertex);
      if (role !== SURFACE || (k > 0 && k < G && l > 0 && l < G)) continue;
      const key = latticePoint(node.tile, k, l, G);
      const members = all.get(key);
      if (members) members.push({ instance, vertex });
      else all.set(key, [{ instance, vertex }]);
    }
  });
  return new Map([...all].filter(([, members]) => members.length > 1));
}

export interface TJunction extends VertexRef {
  /** `tile (k, l)`. */
  at: string;
  /** The coarse instance's vertices at the T-junction's two neighbors along its edge. */
  ends: [VertexRef, VertexRef];
}

/** Every T-junction of every instance, with the coarse chord it splits. */
export function tJunctions(
  packed: PackedScenario,
  grid: TileGrid,
  groups: Map<string, VertexRef[]>,
): TJunction[] {
  const G = grid.segments;
  const out: TJunction[] = [];
  packed.instances.forEach(({ node, state }, instance) => {
    for (let vertex = 0; vertex < grid.vertexCount; vertex += 1) {
      const [k, l, role] = gridVertex(grid, vertex);
      if (role !== SURFACE || !isTJunction(state.flags, k, l, G)) continue;
      const at = `${tileKey(node.tile)} (${k}, ${l})`;
      const [dk, dl] = l === 0 || l === G ? [1, 0] : [0, 1];
      const end = (d: number): VertexRef => {
        const point = latticePoint(node.tile, k + d * dk, l + d * dl, G);
        const coarse = (groups.get(point) ?? []).find(
          (ref) => (packed.instances[ref.instance]?.node.tile.level ?? 8) < node.tile.level,
        );
        if (!coarse) throw new Error(`no coarse vertex at ${point} beside ${at}`);
        return coarse;
      };
      out.push({ instance, vertex, at, ends: [end(-1), end(1)] });
    }
  });
  return out;
}
