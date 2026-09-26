// Drawn sets for the tile-mesh tests (streaming.md 5.6, 7.3) until lod.ts builds them. Each
// scenario is a node list seamFlags accepts, packed into instances the way the globe packs them:
// seam flags from seamFlags, the up tile wherever a flag reads it, and slots as the surface pools
// give them. Vitest runs the vertex mirror on them, and the GPU readback draws the same instances.
// The families read only tiles the fixture bakes, and together they exercise every combination of
// the seam rules a shared point can meet (REQUIRED_COMBINATIONS), less the ones EXCLUDED says no
// cover reaches. Test data only: nothing in the app imports this module.
import { FIXED_SLOTS } from '../gpu/slotTable';
import {
  EDGES,
  FACE_EDGES,
  neighbor,
  nodeIndex,
  tileKey,
  type Edge,
  type Tile,
} from '../surface/cube';
import { flagsNeedUp, INSTANCE_WORDS, packInstance, type InstanceState } from './instances';
import {
  ancestorAt,
  checkCover,
  CoverError,
  DrawnGroups,
  isTJunction,
  LATTICE,
  latticePoint,
  seamFlags,
  sharedPoint,
  type DrawnNode,
} from './seamFlags';
import { GRID_SEGMENTS, type Segments } from './tileGrid';

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
 * The scenario's instances, one per node in node order, once seamFlags accepts its cover. `codeMid`
 * gives a tile's header codeMid, and `resident` the slot a tile already holds, where the pools hold
 * every tile before the scenario packs. Otherwise L0-L1 tiles take their fixed slots, their node
 * indices (5.5, Fixed slots), and deeper tiles the next free slot from 30.
 */
export function packScenario(
  scenario: Scenario,
  codeMid: (tile: Tile) => number,
  resident?: (tile: Tile) => number,
): PackedScenario {
  const { nodes, partial } = scenario;
  const flags = seamFlags(nodes, { partial });
  const slots = new Map<number, Tile>();
  const slotOf = new Map<string, number>();
  let next = FIXED_SLOTS;
  const slot = (tile: Tile): number => {
    const key = tileKey(tile);
    const known = slotOf.get(key);
    if (known !== undefined) return known;
    const assigned = resident ? resident(tile) : tile.level <= 1 ? nodeIndex(tile) : next++;
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

// Where the families draw: tiles the fixture bakes.

/**
 * Whether the fixture bakes `tile` (pipeline/config/fixture.yaml): all of L0-L1, the Sumbawa
 * chain 2/1/3/1 to 7/1/103/50 with 7/1/102/50, and the three Kirkuk corner tiles at L2-L7.
 */
export function fixtureBakes(tile: Tile): boolean {
  const { face, level, x, y } = tile;
  if (level <= 1) return true;
  const last = 2 ** level - 1;
  const kirkuk =
    (face === 0 && x === last && y === last) ||
    (face === 1 && x === 0 && y === last) ||
    (face === 4 && x === last && y === 0);
  const chain = ancestorAt({ face: 1, level: 7, x: 103, y: 50 }, level);
  const sumbawa = face === 1 && y === chain.y && (x === chain.x || (level === 7 && x === 102));
  return kirkuk || sumbawa;
}

/** The deepest level at or above `level` (and at or above 0) whose ancestor of `tile` is baked. */
function bakedSource(tile: Tile, level: number): number {
  let s = Math.max(0, Math.min(level, tile.level));
  while (!fixtureBakes(ancestorAt(tile, s))) s -= 1;
  return s;
}

/** A face and one of its corners, SW 0, SE 1, NW 2, NE 3: one face's name for a cube corner. */
type FaceCorner = readonly [face: number, corner: number];

/** The Kirkuk corner (45°E 35.26°N), where faces 0, 1 and 4 meet along unreversed edges. */
const KIRKUK: readonly FaceCorner[] = [
  [0, 3],
  [1, 2],
  [4, 1],
];

/** The cube corner of faces 2, 3 and 4, where the reversed 2N–4N and 3N–4W meet. */
const REVERSED_CORNER: readonly FaceCorner[] = [
  [2, 3],
  [3, 2],
  [4, 2],
];

/**
 * A face refined toward one of its corners: the 2×2 block of `fine` nodes at the corner, and at
 * each coarser level down to `base` (at least 1) the three nodes of that level's corner block the
 * finer block does not replace. Neighboring levels meet 2:1.
 */
function gradedCorner([face, corner]: FaceCorner, fine: number, base: number): Tile[] {
  const tiles: Tile[] = [];
  for (let level = base; level <= fine; level += 1) {
    const last = 2 ** level - 1;
    const cx = corner & 1 ? last : 0;
    const cy = corner & 2 ? last : 0;
    for (const x of [cx, cx === 0 ? 1 : last - 1]) {
      for (const y of [cy, cy === 0 ? 1 : last - 1]) {
        if (level < fine && x === cx && y === cy) continue;
        tiles.push({ face, level, x, y });
      }
    }
  }
  return tiles;
}

/**
 * The three faces at a cube corner, each refined toward it to its level in `levels` (within one
 * level of each other, so the face edges stay balanced) down to `base`, each node drawing
 * `source(tile)`.
 */
function cubeCorner(
  name: string,
  site: readonly FaceCorner[],
  levels: readonly number[],
  base: number,
  source: (tile: Tile) => number,
): Scenario {
  const nodes = site.flatMap((corner, i) =>
    gradedCorner(corner, levels[i] ?? NaN, base).map((tile) => ({ tile, source: source(tile) })),
  );
  return { name, nodes, partial: true };
}

/** The 15 level triples in F − 1..F + 1 whose levels lie within one of each other. */
function balancedTriples(F: number): number[][] {
  const cube = (lo: number) =>
    [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [lo + (i & 1), lo + ((i >> 1) & 1), lo + (i >> 2)]);
  return [...cube(F - 1), ...cube(F).slice(1)];
}

/** Whether checkCover accepts the scenario: the grids below keep only the covers it accepts. */
function accepted(scenario: Scenario): boolean {
  try {
    checkCover(scenario.nodes, { partial: scenario.partial });
    return true;
  } catch (error) {
    if (error instanceof CoverError) return false;
    throw error;
  }
}

// The families (streaming.md 7.3).

/**
 * 'l0-l1-mixed': faces 0, 2 and 4 at L1 and faces 1, 3 and 5 at L0, each node drawing itself: 2:1
 * across eight face edges, the reversed 3N–4W and 2S–5S among them.
 */
export function l0l1Mixed(): Scenario {
  const nodes = wholeLevel(1).filter(({ tile }) => tile.face % 2 === 0);
  for (const face of [1, 3, 5]) nodes.push({ tile: { face, level: 0, x: 0, y: 0 }, source: 0 });
  return { name: 'l0-l1-mixed', nodes, partial: false };
}

/**
 * The Kirkuk families, where faces 0, 1 and 4 meet along unreversed face edges on real relief:
 * - each face refined toward the corner to one of the 15 balanced level triples around F, for F
 *   in {3, 6}, from F − 2 up; face f's nodes draw c_f in {0, 1, 2} levels above themselves (the
 *   per-face source caps), or higher where the fixture bakes nothing nearer, and every cap triple
 *   whose sources stay within one level where nodes touch is kept
 * - the corner's 2×2 blocks at L7 drawing L4 and L2 (d = 3 and 5): deep sub-rects, lerping the
 *   face-edge profiles on both tiers
 */
export function kirkuk(): Scenario[] {
  const out: Scenario[] = [];
  for (const F of [3, 6]) {
    for (const levels of balancedTriples(F)) {
      for (let i = 0; i < 27; i += 1) {
        const caps = [i % 3, Math.floor(i / 3) % 3, Math.floor(i / 9)];
        const cap = new Map(KIRKUK.map(([face], j) => [face, caps[j] ?? 0]));
        const scenario = cubeCorner(
          `kirkuk F${F} L${levels.join('')} caps ${caps.join('')}`,
          KIRKUK,
          levels,
          F - 2,
          (tile) => bakedSource(tile, tile.level - (cap.get(tile.face) ?? 0)),
        );
        if (accepted(scenario)) out.push(scenario);
      }
    }
  }
  for (const source of [4, 2]) {
    out.push(cubeCorner(`kirkuk L7 on L${source}`, KIRKUK, [7, 7, 7], 7, () => source));
  }
  return out;
}

/**
 * The reversed cube corner of faces 2, 3 and 4, where 2N–4N and 3N–4W meet (2E–3W runs the same
 * way on both faces): each face refined toward it to one of the 15 balanced level triples around F,
 * for F in {2, 4}, so L1-L5 nodes, on L0 and L1 sources, which the fixture bakes everywhere:
 * - 'L1' and 'L0': every node on one level (an L0 node on L0)
 * - 'even' and 'odd': a checkerboard, L0 where x + y is even (odd), so the two finer nodes along a
 *   coarse edge differ and split it
 * - 'L0 from F' and 'L0 from F + 1': that level and finer on L0, coarser on L1, so coarse nodes on
 *   L1 meet finer ones on L0 across whole edges
 * L5 on L0 is d = 5, so profile lerps land on reversed edges on both tiers.
 */
export function reversedCorner(): Scenario[] {
  const out: Scenario[] = [];
  for (const F of [2, 4]) {
    const maps: [string, (tile: Tile) => number][] = [
      ['L1', (tile) => Math.min(tile.level, 1)],
      ['L0', () => 0],
      ['even', (tile) => Math.min(tile.level, (tile.x + tile.y) & 1)],
      ['odd', (tile) => Math.min(tile.level, 1 - ((tile.x + tile.y) & 1))],
      [`L0 from L${F}`, (tile) => (tile.level >= F ? 0 : 1)],
      [`L0 from L${F + 1}`, (tile) => (tile.level > F ? 0 : 1)],
    ];
    for (const levels of balancedTriples(F)) {
      for (const [map, source] of maps) {
        const name = `reversed-corner F${F} L${levels.join('')} ${map}`;
        const scenario = cubeCorner(name, REVERSED_CORNER, levels, Math.max(1, F - 2), source);
        if (accepted(scenario)) out.push(scenario);
      }
    }
  }
  return out;
}

/**
 * The four nodes around corner `corner` of `a` (level N; the same corner of its parent and
 * grandparent): `a`, its two neighbors through the corner at N − 1, and the node diagonally across
 * at N − 2, so from `a` the corner is dN 2. The point may lie on a face edge. `sources` in that
 * order.
 */
function span2(a: Tile, corner: number, sources: readonly number[]): DrawnNode[] {
  const ex: Edge = corner & 1 ? 'E' : 'W';
  const ey: Edge = corner & 2 ? 'N' : 'S';
  const parent = ancestorAt(a, a.level - 1);
  const grand = ancestorAt(a, a.level - 2);
  // Step inside the face first, so the step across a face edge is named in this face's frame.
  const last = 2 ** grand.level - 1;
  const xLeaves = ex === 'E' ? grand.x === last : grand.x === 0;
  const [first, second] = xLeaves ? [ey, ex] : [ex, ey];
  const diagonal = neighbor(neighbor(grand, first).tile, second).tile;
  const tiles = [a, neighbor(parent, ex).tile, neighbor(parent, ey).tile, diagonal];
  return tiles.map((tile, i) => ({ tile, source: sources[i] ?? NaN }));
}

/**
 * 'corner-span2': a node at N, its two neighbors through one corner at N − 1 and the diagonal at
 * N − 2, which edge-only node balance allows. On face 0, at N = 3-6, around the face's center and
 * around the midpoint of its E edge (0E–1W), on L1, or with the diagonal on L0 so the others read
 * up there; and beside Sumbawa's L2 tile on 1E–2W, the node drawing that tile, its parent, so the
 * corner is dN 2 with cS 1 at m 2 on full.
 */
export function cornerSpan2(): Scenario[] {
  const out: Scenario[] = [];
  for (const N of [3, 4, 5, 6]) {
    const half = 2 ** (N - 1) - 1;
    const sites: [string, Tile][] = [
      ['center', { face: 0, level: N, x: half, y: half }],
      ['0E', { face: 0, level: N, x: 2 * half + 1, y: half }],
    ];
    for (const [where, a] of sites) {
      out.push(
        {
          name: `corner-span2 ${where} L${N} on L1`,
          nodes: span2(a, 3, [1, 1, 1, 1]),
          partial: true,
        },
        {
          name: `corner-span2 ${where} L${N} diagonal on L0`,
          nodes: span2(a, 3, [1, 1, 1, 0]),
          partial: true,
        },
      );
    }
  }
  out.push({
    name: 'corner-span2 1E L3',
    nodes: span2({ face: 1, level: 3, x: 7, y: 3 }, 3, [2, 1, 1, 1]),
    partial: true,
  });
  return out;
}

/**
 * Sumbawa, on face 1:
 * - 'sumbawa-l7': 7/1/102-103/50 at d = 0 and 7/1/102-103/51 at d = 1, around Tambora
 * - 'sumbawa-l2': 2/1/3/1 drawing itself beside L1 nodes, in-face and across 1E–2W: the finer
 *   node reads its parent at m 2 on full where the coarser one draws itself
 */
export function sumbawa(): Scenario[] {
  const node = (face: number, level: number, x: number, y: number, source: number) => ({
    tile: { face, level, x, y },
    source,
  });
  return [
    {
      name: 'sumbawa-l7',
      nodes: [
        node(1, 7, 102, 50, 7),
        node(1, 7, 103, 50, 7),
        node(1, 7, 102, 51, 6),
        node(1, 7, 103, 51, 6),
      ],
      partial: true,
    },
    {
      name: 'sumbawa-l2',
      nodes: [node(1, 2, 3, 1, 2), node(1, 1, 1, 1, 1), node(2, 1, 0, 0, 1), node(2, 1, 0, 1, 1)],
      partial: true,
    },
  ];
}

export interface Family {
  name: string;
  scenarios: Scenario[];
}

/** Every family the tile-mesh tests run on the fixture (streaming.md 7.3). */
export function fixtureFamilies(): Family[] {
  return [
    { name: 'l1-globe', scenarios: [l1Globe()] },
    { name: 'l0-l1-mixed', scenarios: [l0l1Mixed()] },
    { name: 'kirkuk', scenarios: kirkuk() },
    { name: 'reversed-corner', scenarios: reversedCorner() },
    { name: 'corner-span2', scenarios: cornerSpan2() },
    { name: 'sumbawa', scenarios: sumbawa() },
  ];
}

// What a scenario exercises.

export type Tier = keyof typeof GRID_SEGMENTS;
export const TIERS = Object.keys(GRID_SEGMENTS) as Tier[];

/** Where a node's edge lies: inside a face, on a face edge, or on one of the four reversed ones. */
export type Seam = 'in-face' | 'face' | 'face-rev';
/** The node across a shared edge: the same level, one coarser (so this side is fine), or finer. */
export type Side = 'same' | 'fine' | 'coarse';
/**
 * The nodes around a shared corner: four inside a face or on a face edge, three at a cube corner,
 * or three at a coarse edge's midpoint, which the two finer nodes hold as a corner.
 */
export type CornerKind = 'inface4' | 'face4' | 'cube3' | 'mid3';
type Mip = 0 | 1 | 2;

/**
 * One combination of the rules at a vertex some other instance shares, or at a T-junction:
 * - edge: a shared point along one edge of the node (not a corner, not a T-junction), with the
 *   edge's cS bits (both halves the same, or split) and the vertex mip
 * - tjunction: an odd vertex on the fine side of a 2:1 edge
 * - corner: a node corner every node around it shares, with its dN, cS and the vertex mip
 * - lerp: a shared face-edge point between two profile entries (rule 3, m 0 on a deep sub-rect)
 */
export type Combination =
  | { rule: 'edge'; seam: Seam; side: Side; cS: 0 | 1 | 'split'; m: Mip; tier: Tier }
  | { rule: 'tjunction'; seam: Seam; tier: Tier }
  | { rule: 'corner'; corner: CornerKind; dN: 0 | 1 | 2; cS: 0 | 1; m: Mip; tier: Tier }
  | { rule: 'lerp'; seam: Exclude<Seam, 'in-face'>; tier: Tier };

/** A set of combinations: the rule and any of its fields. */
export type CombinationPattern = {
  [R in Combination['rule']]: { rule: R } & Partial<Extract<Combination, { rule: R }>>;
}[Combination['rule']];

export function combinationKey(c: Combination): string {
  switch (c.rule) {
    case 'edge':
      return `edge ${c.seam} ${c.side} cS=${c.cS} m=${c.m} ${c.tier}`;
    case 'tjunction':
      return `tjunction ${c.seam} ${c.tier}`;
    case 'corner':
      return `corner ${c.corner} dN=${c.dN} cS=${c.cS} m=${c.m} ${c.tier}`;
    case 'lerp':
      return `lerp ${c.seam} ${c.tier}`;
  }
}

export function matches(c: Combination, pattern: CombinationPattern): boolean {
  const fields = c as Readonly<Record<string, unknown>>;
  return Object.entries(pattern).every(([field, value]) => fields[field] === value);
}

const SEAMS: readonly Seam[] = ['in-face', 'face', 'face-rev'];
const MIPS: readonly Mip[] = [0, 1, 2];

/** Every combination 5.6's rules name, on both tiers. */
export const REQUIRED_COMBINATIONS: readonly Combination[] = TIERS.flatMap((tier) => [
  ...SEAMS.flatMap((seam) =>
    (['same', 'fine', 'coarse'] as const).flatMap((side) =>
      ([0, 1, 'split'] as const).flatMap((cS) =>
        MIPS.map((m): Combination => ({ rule: 'edge', seam, side, cS, m, tier })),
      ),
    ),
  ),
  ...SEAMS.map((seam): Combination => ({ rule: 'tjunction', seam, tier })),
  ...(['inface4', 'face4', 'cube3', 'mid3'] as const).flatMap((corner) =>
    ([0, 1, 2] as const).flatMap((dN) =>
      ([0, 1] as const).flatMap((cS) =>
        MIPS.map((m): Combination => ({ rule: 'corner', corner, dN, cS, m, tier })),
      ),
    ),
  ),
  ...(['face', 'face-rev'] as const).map((seam): Combination => ({ rule: 'lerp', seam, tier })),
]);

export interface Exclusion {
  where: CombinationPattern;
  reason: string;
}

const COARSEST_UP =
  'on full, m 2 needs the coarsest source at the point on the coarsest node level (lv = coarse), ' +
  'but a node that is itself the coarsest there and reads its source’s parent puts lv below it';
const MIDPOINT =
  'the two nodes that hold a coarse edge’s midpoint as a corner are one level finer than the ' +
  'node whose edge it halves, so from them it is always dN 1';
const NESTED =
  'on full, m 2 with cS 1 at an in-face corner needs the coarsest node there to draw itself ' +
  'beside a baked tile one level below it that the node draws (its own or its parent), neither ' +
  'inside the other; below L1 the fixture bakes only the nested Kirkuk and Sumbawa chains, which ' +
  'meet such a corner only on a face edge';

/** Required combinations no scenario reaches, each with the reason. */
export const EXCLUDED: readonly Exclusion[] = [
  {
    where: { rule: 'edge', side: 'same', cS: 'split' },
    reason: 'a same-level neighbor spans the whole edge, so both halves share its source',
  },
  {
    where: { rule: 'edge', side: 'fine', cS: 'split' },
    reason: 'the coarser neighbor spans the whole edge, so both halves share its source',
  },
  {
    where: { rule: 'corner', corner: 'cube3', dN: 2 },
    reason: 'the three nodes at a cube corner share edges pairwise, so their levels lie within one',
  },
  { where: { rule: 'corner', corner: 'mid3', dN: 0 }, reason: MIDPOINT },
  { where: { rule: 'corner', corner: 'mid3', dN: 2 }, reason: MIDPOINT },
  { where: { rule: 'edge', side: 'same', cS: 1, m: 2, tier: 'full' }, reason: COARSEST_UP },
  { where: { rule: 'edge', side: 'coarse', cS: 1, m: 2, tier: 'full' }, reason: COARSEST_UP },
  { where: { rule: 'corner', dN: 0, cS: 1, m: 2, tier: 'full' }, reason: COARSEST_UP },
  {
    where: { rule: 'corner', corner: 'inface4', dN: 1, cS: 1, m: 2, tier: 'full' },
    reason: NESTED,
  },
  {
    where: { rule: 'corner', corner: 'inface4', dN: 2, cS: 1, m: 2, tier: 'full' },
    reason: NESTED,
  },
];

/**
 * The shared points a scenario's vertices exercise on `tier`, as combinationKey strings. A point
 * counts only where the configuration around it is whole: an edge whose both halves meet drawn
 * nodes, and a corner every node of its kind holds; a partial scenario's open border does not.
 */
export function combinationsOf(scenario: Scenario, tier: Tier): Set<string> {
  const G: Segments = GRID_SEGMENTS[tier];
  const { nodes, partial } = scenario;
  const flags = seamFlags(nodes, { partial });
  const groups = new DrawnGroups(nodes);
  const boundary = gridBoundary(G);
  // Per shared point, its holders: their level and whether they hold it as a corner.
  const holders = new Map<string, { level: number; corner: boolean }[]>();
  for (const node of nodes) {
    const bits = flags.get(tileKey(node.tile)) ?? 0;
    for (const [k, l] of boundary) {
      if (isTJunction(bits, k, l, G)) continue;
      const point = latticePoint(node.tile, k, l, G);
      const corner = (k === 0 || k === G) && (l === 0 || l === G);
      holders.set(point, [...(holders.get(point) ?? []), { level: node.tile.level, corner }]);
    }
  }
  const out = new Set<string>();
  const add = (c: Combination) => out.add(combinationKey(c));
  for (const node of nodes) {
    const { tile } = node;
    const bits = flags.get(tileKey(tile)) ?? 0;
    const span = LATTICE >> tile.level;
    const last = 2 ** tile.level - 1;
    const onFace = [tile.y === last, tile.x === last, tile.y === 0, tile.x === 0];
    for (const [k, l] of boundary) {
      const on = [l === G, k === G, l === 0, k === 0];
      const X = tile.x * span + (k * span) / G;
      const Y = tile.y * span + (l * span) / G;
      if (on.filter(Boolean).length === 2) {
        const held = holders.get(latticePoint(tile, k, l, G)) ?? [];
        const onEdge = (v: number) => v === 0 || v === LATTICE;
        const corner: CornerKind =
          onEdge(X) && onEdge(Y)
            ? 'cube3'
            : held.some((h) => !h.corner)
              ? 'mid3'
              : onEdge(X) || onEdge(Y)
                ? 'face4'
                : 'inface4';
        if (held.length !== (corner === 'cube3' || corner === 'mid3' ? 3 : 4)) continue;
        const c = 2 * Number(l === G) + Number(k === G);
        const dN = ((bits >>> (13 + 3 * c)) & 3) as 0 | 1 | 2;
        const cS = ((bits >>> (12 + 3 * c)) & 1) as 0 | 1;
        add({ rule: 'corner', corner, dN, cS, m: sharedPoint(node, bits, k, l, G).m, tier });
        continue;
      }
      const e = on.indexOf(true);
      const seam: Seam = !onFace[e]
        ? 'in-face'
        : FACE_EDGES[tile.face]?.[EDGES[e] ?? 'N'][2]
          ? 'face-rev'
          : 'face';
      if (isTJunction(bits, k, l, G)) {
        add({ rule: 'tjunction', seam, tier });
        continue;
      }
      // An edge point: whole when drawn nodes lie across both halves of the edge.
      const across = [span / 4, (3 * span) / 4].map((t) =>
        groups
          .at(
            tile.face,
            tile.x * span + (e === 1 ? span : e === 3 ? 0 : t),
            tile.y * span + (e === 0 ? span : e === 2 ? 0 : t),
          )
          .filter((other) => other !== node),
      );
      if (across.some((others) => others.length === 0)) continue;
      const levels = across.flat().map((other) => other.tile.level);
      const side: Side = levels.some((v) => v < tile.level)
        ? 'fine'
        : levels.some((v) => v > tile.level)
          ? 'coarse'
          : 'same';
      const s0 = (bits >>> (4 + e)) & 1;
      const s1 = (bits >>> (8 + e)) & 1;
      const { m, lv } = sharedPoint(node, bits, k, l, G);
      add({ rule: 'edge', seam, side, cS: s0 === s1 ? (s0 as 0 | 1) : 'split', m, tier });
      if (seam === 'in-face') continue;
      // Rule 3 reads the profile at corner c of the level-lv tile at mip m, and lerps where
      // c / 2^m falls between entries.
      const dS = tile.level - lv;
      const offset = (e === 0 || e === 2 ? tile.x : tile.y) % 2 ** dS;
      const a = e === 0 || e === 2 ? k : l;
      const shift = 8 - Math.log2(G) - dS - m;
      if (shift < 0 && (offset * G + a) % 2 ** -shift !== 0) add({ rule: 'lerp', seam, tier });
    }
  }
  return out;
}

/** The boundary points (k, l) of a G-segment grid, each once. */
function gridBoundary(G: number): [number, number][] {
  const points: [number, number][] = [];
  for (let l = 0; l <= G; l += 1) {
    for (let k = 0; k <= G; k += 1) {
      if (k === 0 || l === 0 || k === G || l === G) points.push([k, l]);
    }
  }
  return points;
}
