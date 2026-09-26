// Drawn sets for the tile-mesh tests (streaming.md 5.6, 7.3) until lod.ts builds them. Each
// scenario is a node list seamFlags accepts, packed into instances the way the globe packs them:
// seam flags from seamFlags, the up tile wherever a flag reads it, and slots as the surface pools
// give them. Vitest runs the vertex mirror on them, and the GPU readback draws the same instances.
import { FIXED_SLOTS } from '../gpu/slotTable';
import { nodeIndex, tileKey, type Tile } from '../surface/cube';
import { flagsNeedUp, INSTANCE_WORDS, packInstance, type InstanceState } from './instances';
import { ancestorAt, seamFlags, type DrawnNode } from './seamFlags';

export interface Scenario {
  name: string;
  nodes: DrawnNode[];
  /** Covers part of the globe: a missing neighbor counts as the node itself. */
  partial: boolean;
}

export interface PackedInstance {
  node: DrawnNode;
  state: InstanceState;
  /** The tile the node draws: its ancestor-or-self at the source level. */
  source: Tile;
  /** The source's parent, when a seam flag reads it. */
  up?: Tile;
}

export interface PackedScenario {
  scenario: Scenario;
  /** INSTANCE_WORDS per instance, in node order, as the instance buffer holds them. */
  words: Uint32Array;
  instances: PackedInstance[];
  /** The tile each pool slot must hold. */
  slots: Map<number, Tile>;
}

/** Every node drawing itself at `level`: all 6·4^level of them. */
export function wholeLevel(level: number): DrawnNode[] {
  const nodes: DrawnNode[] = [];
  const side = 2 ** level;
  for (let face = 0; face < 6; face += 1) {
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) nodes.push({ tile: { face, level, x, y }, source: level });
    }
  }
  return nodes;
}

/** 'l1-globe': the 24 L1 nodes at d = 0, sharing all 12 face edges and the 8 cube corners. */
export function l1Globe(): Scenario {
  return { name: 'l1-globe', nodes: wholeLevel(1), partial: false };
}

/** One node with no neighbors, so no seam flags, drawing its ancestor-or-self at `source`. */
export function loneNode(tile: Tile, source = tile.level): Scenario {
  return { name: `lone ${tileKey(tile)} on L${source}`, nodes: [{ tile, source }], partial: true };
}

/**
 * The scenario's instances, one per node in node order, once seamFlags accepts its cover. L0-L1
 * tiles take their fixed slots, their node indices (5.5, Fixed slots), and deeper tiles the next
 * free slot from 30. `codeMid` gives a tile's header codeMid.
 */
export function packScenario(scenario: Scenario, codeMid: (tile: Tile) => number): PackedScenario {
  const { nodes, partial } = scenario;
  const flags = seamFlags(nodes, { partial });
  const slots = new Map<number, Tile>();
  const slotOf = new Map<string, number>();
  let next = FIXED_SLOTS;
  const slot = (tile: Tile): number => {
    const key = tileKey(tile);
    const known = slotOf.get(key);
    if (known !== undefined) return known;
    const assigned = tile.level <= 1 ? nodeIndex(tile) : next++;
    slotOf.set(key, assigned);
    slots.set(assigned, tile);
    return assigned;
  };
  const words = new Uint32Array(INSTANCE_WORDS * nodes.length);
  const instances = nodes.map((node, i): PackedInstance => {
    const bits = flags.get(tileKey(node.tile));
    if (bits === undefined) throw new Error(`no seam flags for ${tileKey(node.tile)}`);
    const source = ancestorAt(node.tile, node.source);
    const state: InstanceState = {
      tile: node.tile,
      src: { slot: slot(source), level: node.source, codeMid: codeMid(source) },
      flags: bits,
    };
    if (!flagsNeedUp(bits)) {
      packInstance(words, i, state);
      return { node, state, source };
    }
    const up = ancestorAt(node.tile, node.source - 1);
    state.up = { slot: slot(up), codeMid: codeMid(up) };
    packInstance(words, i, state);
    return { node, state, source, up };
  });
  return { scenario, words, instances, slots };
}
