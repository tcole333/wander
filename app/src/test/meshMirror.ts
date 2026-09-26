// The vertex mirror on the fixture (streaming.md 5.6, 7.3): a scenario packed into instances, the
// fixture tiles its slots hold, the release's qLand and c200, and every grid vertex of every
// instance; then the groups of instances that hold each shared lattice point, and where a group's
// members disagree. The mirror's Vitest suites build on these.
import { tunables } from '../config/tunables';
import { nodeFromIndex, tileKey, type Tile } from '../surface/cube';
import type { DecodedWst } from '../surface/wst';
import { packScenario, type PackedScenario, type Scenario } from '../globe/meshScenarios';
import { ancestorAt, latticePoint } from '../globe/seamFlags';
import { buildTileGrid, SURFACE, type Segments, type TileGrid } from '../globe/tileGrid';
import {
  mirrorInstance,
  mirrorSlot,
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
  /** Per instance, in node order: every grid vertex, in the grid's vertex order. */
  vertices: MirrorVertex[][];
}

export interface MirrorOptions {
  /** Sea displaces by kSea when on (the default), by 0 when off. */
  bathymetry?: boolean;
  /** Stands in for wanderTanQ. */
  tanQ?: (s: number) => number;
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
  const vertices = packed.instances.map((_, i) => mirrorInstance(packed.words, i, grid, ctx));
  return { packed, grid, ctx, vertices };
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
