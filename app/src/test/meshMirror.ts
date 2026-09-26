// The vertex mirror on the fixture (streaming.md 5.6, 7.3): a scenario packed into instances, the
// fixture tiles its slots hold, the release's qLand and c200, and every grid vertex of every
// instance; then the groups of instances that hold each shared lattice point, where a group's
// members disagree, how far T-junctions sit off the coarse chords, and the same scenario with one
// seam flag bit flipped. The mirror's Vitest suites build on these.
import { tunables } from '../config/tunables';
import { FIXED_SLOTS } from '../gpu/slotTable';
import { nodeFromIndex, nodeIndex, tileKey, type Tile, type Vec3 } from '../surface/cube';
import type { DecodedWst } from '../surface/wst';
import { flagsNeedUp, packInstance, type InstanceState } from '../globe/instances';
import { packScenario, type PackedScenario, type Scenario } from '../globe/meshScenarios';
import { ancestorAt, isTJunction, latticePoint } from '../globe/seamFlags';
import { buildTileGrid, SURFACE, type Segments, type TileGrid } from '../globe/tileGrid';
import {
  mirrorInstance,
  mirrorSlot,
  mirrorVertex,
  type MirrorContext,
  type MirrorVertex,
} from '../globe/vertexMirror';
import {
  hasSurfaceTile,
  loadSurfaceTile,
  readStageRecord,
  readSurfaceRecord,
  surfaceAvailability,
} from './fixture';
import type { CoverageRecord } from './region';

export interface MirroredScenario {
  packed: PackedScenario;
  grid: TileGrid;
  ctx: MirrorContext;
  /**
   * Per instance, in node order: every grid vertex, in the grid's vertex order. With `boundary`,
   * only the surface boundary's, and the other indices are holes.
   */
  vertices: MirrorVertex[][];
  options: MirrorOptions;
}

export interface MirrorOptions {
  /** Sea displaces by kSea when on (the default), by 0 when off. */
  bathymetry?: boolean;
  /** Stands in for wanderTanQ. */
  tanQ?: (s: number) => number;
  /** Mirrors only the surface boundary, the vertices other instances can share. */
  boundary?: boolean;
}

/** A grid vertex of one instance. */
export interface VertexRef {
  instance: number;
  vertex: number;
}

const decodedTiles = new Map<string, Promise<DecodedWst>>();

/** A fixture tile as the decoder hands it to the pools, decoded once per test file. */
export function fixtureTile(tile: Tile): Promise<DecodedWst> {
  const key = tileKey(tile);
  let decoded = decodedTiles.get(key);
  if (!decoded) {
    decoded = loadSurfaceTile(readSurfaceRecord(), key).then((t) => t.decoded);
    decodedTiles.set(key, decoded);
  }
  return decoded;
}

/** Every tile the fixture holds, in node order. */
export function fixtureTiles(): Tile[] {
  const avail = surfaceAvailability(readSurfaceRecord());
  const tiles: Tile[] = [];
  for (let k = 0; k < 8 * avail.length; k += 1) {
    if (((avail[k >> 3] ?? 0) >> (k & 7)) & 1) tiles.push(nodeFromIndex(k));
  }
  return tiles;
}

/**
 * Packs `scenario` and runs the mirror on every vertex of every instance, with the fixture's tiles
 * in the slots, its qLand and c200, and tunables' kLand, kSea and skirtTexels.
 */
export async function mirrorScenario(
  scenario: Scenario,
  segments: Segments,
  options: MirrorOptions = {},
): Promise<MirroredScenario> {
  const record = readSurfaceRecord();
  // A node reads its source, and its source's parent where a flag says so; load both up front,
  // since packing needs their codeMids.
  const candidates = scenario.nodes.flatMap(({ tile, source }) => [
    ancestorAt(tile, source),
    ...(source > 0 ? [ancestorAt(tile, source - 1)] : []),
  ]);
  const tiles = new Map<string, DecodedWst>();
  for (const tile of candidates) {
    const key = tileKey(tile);
    if (!tiles.has(key) && hasSurfaceTile(record, key)) tiles.set(key, await fixtureTile(tile));
  }
  const decoded = (tile: Tile): DecodedWst => {
    const found = tiles.get(tileKey(tile));
    if (!found) throw new Error(`${scenario.name} reads ${tileKey(tile)}, which the fixture lacks`);
    return found;
  };
  const packed = packScenario(scenario, (tile) => decoded(tile).header.codeMid);
  const coverage = readStageRecord<CoverageRecord>('coverage');
  const ctx: MirrorContext = {
    segments,
    slots: new Map([...packed.slots].map(([slot, tile]) => [slot, mirrorSlot(decoded(tile))])),
    qLand: coverage.qLand,
    c200: coverage.c200,
    kLand: tunables.kLand,
    kSeaEff: (options.bathymetry ?? true) ? tunables.kSea : 0,
    skirtTexels: tunables.skirtTexels,
    ...(options.tanQ ? { tanQ: options.tanQ } : {}),
  };
  const grid = buildTileGrid(segments);
  const vertices = packed.instances.map((_, i) => mirrorOne(packed.words, i, grid, ctx, options));
  return { packed, grid, ctx, vertices, options };
}

function mirrorOne(
  words: Uint32Array,
  instance: number,
  grid: TileGrid,
  ctx: MirrorContext,
  options: MirrorOptions,
): MirrorVertex[] {
  if (!options.boundary) return mirrorInstance(words, instance, grid, ctx);
  const G = grid.segments;
  const vertices: MirrorVertex[] = [];
  for (let v = 0; v < grid.vertexCount; v += 1) {
    const [k, l, role] = gridVertex(grid, v);
    if (role !== SURFACE || (k > 0 && k < G && l > 0 && l < G)) continue;
    vertices[v] = mirrorVertex(words, instance, k, l, role, ctx);
  }
  return vertices;
}

/** (k, l, role) of grid vertex v. */
export function gridVertex(grid: TileGrid, v: number): [k: number, l: number, role: number] {
  const [k = NaN, l = NaN, role = NaN] = grid.position.subarray(3 * v, 3 * v + 3);
  return [k, l, role];
}

/**
 * The surface vertices of every lattice point two or more instances hold, by latticePoint: the
 * points an in-face seam, a face edge or a cube corner shares.
 */
export function sharedGroups(mirrored: MirroredScenario): Map<string, VertexRef[]> {
  const { grid, packed } = mirrored;
  const G = grid.segments;
  const all = new Map<string, VertexRef[]>();
  packed.instances.forEach(({ node }, instance) => {
    for (let vertex = 0; vertex < grid.vertexCount; vertex += 1) {
      const [k, l, role] = gridVertex(grid, vertex);
      if (role !== SURFACE || (k > 0 && k < G && l > 0 && l < G)) continue;
      const key = latticePoint(node.tile, k, l, G);
      all.set(key, [...(all.get(key) ?? []), { instance, vertex }]);
    }
  });
  return new Map([...all].filter(([, members]) => members.length > 1));
}

/** The fields every instance holding a shared point must agree on, bit for bit. */
export const SHARED_FIELDS = ['code', 'shore', 'land', 'h', 'dir', 'position'] as const;
export type SharedField = (typeof SHARED_FIELDS)[number];

/**
 * Each place a group's member differs from the group's first in a field, as `point field: a vs b`.
 * Values must be identical: equal, of the same sign at zero, and not NaN.
 */
export function sharedMismatches(
  mirrored: MirroredScenario,
  groups: Map<string, VertexRef[]>,
  fields: readonly SharedField[] = SHARED_FIELDS,
): string[] {
  const out: string[] = [];
  const at = ({ instance, vertex }: VertexRef) => {
    const v = mirrored.vertices[instance]?.[vertex];
    const tile = mirrored.packed.instances[instance]?.node.tile;
    if (!v || !tile) throw new RangeError(`no vertex ${vertex} of instance ${instance}`);
    const [k, l] = gridVertex(mirrored.grid, vertex);
    return { v, name: `${tileKey(tile)} (${k}, ${l})` };
  };
  for (const [point, members] of groups) {
    const [first, ...rest] = members.map(at);
    if (!first) continue;
    for (const other of rest) {
      for (const field of fields) {
        const a = [first.v[field]].flat();
        const b = [other.v[field]].flat();
        if (!a.every((value, i) => value === b[i] && Object.is(value, b[i]))) {
          out.push(`${point} ${field}: ${first.name} ${a.join()} vs ${other.name} ${b.join()}`);
        }
      }
    }
  }
  return out;
}

export interface ChordOffset {
  /** The T-junction, as `tile (k, l)`. */
  at: string;
  /** Its distance from the coarse node's chord between its two neighbors, R = 1. */
  offset: number;
}

/**
 * Every T-junction of every instance, and how far it sits from the chord it splits: the segment
 * between the coarse instance's own vertices at the T-junction's two neighbors.
 */
export function chordOffsets(
  mirrored: MirroredScenario,
  groups: Map<string, VertexRef[]>,
): ChordOffset[] {
  const { grid, packed, vertices } = mirrored;
  const G = grid.segments;
  const out: ChordOffset[] = [];
  packed.instances.forEach(({ node, state }, instance) => {
    for (let v = 0; v < grid.vertexCount; v += 1) {
      const [k, l, role] = gridVertex(grid, v);
      if (role !== SURFACE || !isTJunction(state.flags, k, l, G)) continue;
      const at = `${tileKey(node.tile)} (${k}, ${l})`;
      const [dk, dl] = l === 0 || l === G ? [1, 0] : [0, 1];
      const [a, b] = [-1, 1].map((d) => {
        const point = latticePoint(node.tile, k + d * dk, l + d * dl, G);
        const coarse = (groups.get(point) ?? []).find(
          (ref) => (packed.instances[ref.instance]?.node.tile.level ?? 8) < node.tile.level,
        );
        const end = coarse && vertices[coarse.instance]?.[coarse.vertex];
        if (!end) throw new Error(`no coarse vertex at ${point} beside ${at}`);
        return end.position;
      });
      const t = vertices[instance]?.[v];
      if (!t || !a || !b) throw new RangeError(`no vertex ${at}`);
      out.push({ at, offset: segmentDistance(t.position, a, b) });
    }
  });
  return out;
}

function segmentDistance(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const;
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]] as const;
  const along =
    (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2);
  const t = Math.min(1, Math.max(0, along));
  return Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1], ap[2] - t * ab[2]);
}

/**
 * The scenario with instance `instance` packed with seam flags `flags` instead, and mirrored again.
 * When the new flags read an up tile the instance had none of, its source's parent joins the pools.
 */
export async function withFlags(
  mirrored: MirroredScenario,
  instance: number,
  flags: number,
): Promise<MirroredScenario> {
  const { packed, grid, ctx, options } = mirrored;
  const packedInstance = packed.instances[instance];
  if (!packedInstance) throw new RangeError(`no instance ${instance}`);
  const { node, state } = packedInstance;
  const next: InstanceState = { tile: state.tile, src: state.src, flags };
  let slots = ctx.slots;
  if (flagsNeedUp(flags) && state.up) next.up = state.up;
  if (flagsNeedUp(flags) && !state.up) {
    if (node.source === 0) throw new RangeError(`${tileKey(node.tile)} draws L0, which has no up`);
    const tile = ancestorAt(node.tile, node.source - 1);
    const decoded = await fixtureTile(tile);
    const known = [...packed.slots].find(([, held]) => tileKey(held) === tileKey(tile));
    const slot =
      known?.[0] ??
      (tile.level <= 1 ? nodeIndex(tile) : Math.max(FIXED_SLOTS - 1, ...packed.slots.keys()) + 1);
    slots = new Map(slots).set(slot, mirrorSlot(decoded));
    next.up = { slot, codeMid: decoded.header.codeMid };
  }
  const words = packed.words.slice();
  packInstance(words, instance, next);
  const flipped = { ...ctx, slots };
  const vertices = [...mirrored.vertices];
  vertices[instance] = mirrorOne(words, instance, grid, flipped, options);
  return { ...mirrored, packed: { ...packed, words }, ctx: flipped, vertices };
}
