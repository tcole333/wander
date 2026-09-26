// The GPU readback page's logic (e2e/globe-mesh.html; streaming.md 5.6, 7.3): the fixture's tiles
// decoded in the decode workers and uploaded through the upload queue into the real surface pools,
// every mesh scenario packed against the slots its tiles landed in, and the surface vertex read
// back on both tiers. The page checks every value the GPU writes, against the other instances that
// share its point and against the vertex mirror run on the same decoded tiles, and reports counts
// and worst cases rather than 17 million vertices.
import { WebGLRenderer } from 'three';
import { tunables, type Tier } from '../config/tunables';
import type { Release } from '../data/release';
import { loadSurfaceLayer } from '../data/surfaceLayer';
import { rendererName } from '../gpu/poolReadback';
import { FIXED_SLOTS, SlotTable } from '../gpu/slotTable';
import { createSurfacePools, surfaceParts } from '../gpu/surfaceUploads';
import { UploadQueue } from '../gpu/uploadQueue';
import { tileKey, type Tile } from '../surface/cube';
import type { DecodedWst } from '../surface/wst';
import { decodeTiles } from '../workers/decodeTiles';
import { flagsNeedUp, INSTANCE_CAPACITY, INSTANCE_WORDS, packInstance } from './instances';
import {
  gridVertex,
  sharedPointGroups,
  surfaceVertexOf,
  tJunctions,
  type VertexRef,
} from './meshGroups';
import { createMeshReadback, infoField, type MeshReadback, type MeshReadout } from './meshReadback';
import {
  combinationKey,
  combinationsOf,
  EXCLUDED,
  fixtureFamilies,
  matches,
  packScenario,
  REQUIRED_COMBINATIONS,
  type PackedScenario,
  type Scenario,
} from './meshScenarios';
import { ancestorAt, isTJunction, sharedPoint } from './seamFlags';
import { createSurfaceVertexUniforms } from './surfaceVertex.glsl';
import { buildTileGrid, GRID_SEGMENTS, SKIRT, type TileGrid } from './tileGrid';
import {
  mirrorInstance,
  mirrorSlot,
  mirrorVertex,
  type MirrorContext,
  type MirrorVertex,
} from './vertexMirror';

const f = Math.fround;
/** Differences kept per scenario for a failure message. */
const SAMPLES = 8;
const CLASSES = ['interior', 'edge', 'corner', 'tjunction'] as const;

/** Vertices where the GPU and the mirror differ, per field, and the largest float gaps. */
export interface MirrorCheck {
  code: number;
  shore: number;
  land: number;
  h: number;
  disp: number;
  m: number;
  cls: number;
  /** lv, the face-edge test, the up read and the T-junction bit. */
  info: number;
  /** The largest |GPU − mirror| of a position component, R = 1, and of a uv component. */
  posWorst: number;
  uvWorst: number;
}

export interface ScenarioCheck {
  name: string;
  family: string;
  instances: number;
  /** Pixels that hold no vertex of their role: 0 when every vertex was drawn once. */
  unwritten: number;
  /** Lattice points two or more instances hold. */
  sharedPoints: number;
  /** Instances whose position, code, shore, land or h differs in bits from the point's first. */
  seamMismatches: number;
  tJunctions: number;
  /** A T-junction component's largest distance, in float32 steps, from fround(fround(P0 + P1)·0.5). */
  tJunctionWorstUlp: number;
  mirror: MirrorCheck;
  /** Where the position differs most from the mirror's. */
  posWorstAt: string;
  /** Skirt bottoms: how many, how many hang from T-junctions and deep sources, the largest gap. */
  skirts: { count: number; tjunctions: number; deep: number; worst: number };
  /** combinationsOf(scenario, tier): what the scenario exercises. */
  combinations: string[];
  /** The first few differences each check found, for a failure message. */
  samples: { mirror: string[]; seams: string[]; tJunctions: string[] };
}

export type ControlKind = 'cS' | 'cN' | 'dN';

export interface ControlCheck {
  kind: ControlKind;
  /** `scenario: tile bit b`, or 'none'. */
  flip: string;
  /** Flips of this kind tried, up to the first the mirror shows. */
  tried: number;
  /** Shared-point pairs the flip makes disagree, on the mirror and on the GPU. */
  mirrorMismatches: number;
  gpuMismatches: number;
  /** The flipped instance's shared vertices whose GPU code, shore or h differ from the mirror's. */
  mirrorDiffs: number;
}

export interface TierCheck {
  tier: Tier;
  segments: number;
  instances: number;
  scenarios: ScenarioCheck[];
  controls: ControlCheck[];
  /** REQUIRED_COMBINATIONS on this tier, less the EXCLUDED ones. */
  required: string[];
  /** Milliseconds packing, drawing and reading back, mirroring, and checking. */
  ms: { pack: number; gpu: number; mirror: number; checks: number; total: number };
}

export interface ProgramCheck {
  name: string;
  linked: boolean;
  /** Its active attributes, as getActiveAttrib names them. */
  attributes: string[];
}

export interface MeshReport {
  renderer: string;
  tiles: string[];
  decodeErrors: { key: string; error: string }[];
  tiers: TierCheck[];
  programs: ProgramCheck[];
  glError: number;
  ms: number;
}

declare global {
  interface Window {
    /** Set by meshProbe.main.ts when e2e/globe-mesh.html loads. */
    globeMesh?: Promise<MeshReport>;
  }
}

/** What a tier's run reads: the grid, the mirror, the readback and the resident tiles. */
interface TierRun {
  grid: TileGrid;
  ctx: MirrorContext;
  readback: MeshReadback;
  /** The slot a resident tile holds. */
  resident: (tile: Tile) => number;
  codeMid: (tile: Tile) => number;
  ms: TierCheck['ms'];
}

interface Entry {
  family: string;
  scenario: Scenario;
  packed: PackedScenario;
}

export async function runMeshProbe(dataHost: string, tiers: readonly Tier[]): Promise<MeshReport> {
  const start = performance.now();
  const release = (await (await fetch(`${dataHost}/release.json`)).json()) as Release;
  const layer = await loadSurfaceLayer(release);
  const tiles = layer.tiles();

  const renderer = new WebGLRenderer({ antialias: false });
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const slots = FIXED_SLOTS + tiles.filter((t) => t.level > 1).length;
  const pools = createSurfacePools(renderer, slots);
  const all = [pools.height, pools.shoreWater, pools.edges];
  for (const pool of all) pool.warm();
  const table = new SlotTable({
    slots,
    quarantineFrames: tunables.slotQuarantine,
    fixedRoots: true,
  });
  const queue = new UploadQueue({
    stopMs: tunables.uploadStopMs,
    slowCallMs: tunables.uploadSlowCall,
  });

  // Every fixture tile, decoded as the runtime decodes, uploaded into the slot the table gives it.
  const decoded = new Map<string, DecodedWst>();
  const decodeErrors = await decodeTiles(layer, tiles, ({ key, tile }) => {
    decoded.set(key, tile);
  });
  for (const [key, tile] of decoded) {
    const slot = table.reserve(key);
    if (slot === undefined) throw new Error(`no slot for ${key}`);
    queue.enqueue({
      key,
      parts: surfaceParts(pools, slot, tile),
      onDone: () => table.publish(key),
    });
  }
  while (queue.length > 0) {
    queue.run(tunables.uploadIdle.full);
    table.endFrame();
  }
  const resident = (tile: Tile): number => {
    const key = tileKey(tile);
    const slot = table.slotOf(key);
    if (slot === undefined || table.stateOf(key) !== 'resident') {
      throw new Error(`${key} is not resident`);
    }
    return slot;
  };
  const codeMid = (tile: Tile): number => {
    const held = decoded.get(tileKey(tile));
    if (!held) throw new Error(`${tileKey(tile)} was not decoded`);
    return held.header.codeMid;
  };

  const relief = {
    kLand: tunables.kLand,
    kSeaEff: tunables.kSea,
    skirtTexels: tunables.skirtTexels,
  };
  const uniforms = createSurfaceVertexUniforms(pools, release.surface, relief);
  const mirrorSlots = new Map(
    [...decoded.values()].map((tile) => [resident(tile.header), mirrorSlot(tile)]),
  );
  const scenarios = fixtureFamilies().flatMap(({ name, scenarios }) =>
    scenarios.map((scenario) => ({ family: name, scenario })),
  );

  const report: MeshReport = {
    renderer: rendererName(gl),
    tiles: [...decoded.keys()],
    decodeErrors,
    tiers: [],
    programs: [],
    glError: 0,
    ms: 0,
  };
  for (const tier of tiers) {
    const segments = GRID_SEGMENTS[tier];
    const grid = buildTileGrid(segments);
    const readback = createMeshReadback(renderer, grid, uniforms);
    const ctx: MirrorContext = {
      segments,
      slots: mirrorSlots,
      qLand: release.surface.qLand,
      c200: release.surface.c200,
      ...relief,
    };
    const ms = { pack: 0, gpu: 0, mirror: 0, checks: 0, total: 0 };
    report.tiers.push(runTier(tier, scenarios, { grid, ctx, readback, resident, codeMid, ms }));
    // @types/three leaves the GL program and its attribute map untyped.
    for (const program of renderer.info.programs ?? []) {
      if (report.programs.some(({ name }) => name === program.name)) continue;
      const linked =
        gl.getProgramParameter(program.program as WebGLProgram, gl.LINK_STATUS) === true;
      const attributes = Object.keys(program.getAttributes() as Record<string, unknown>);
      report.programs.push({ name: program.name, linked, attributes });
    }
    readback.dispose();
  }
  report.glError = gl.getError();
  for (const pool of all) pool.dispose();
  renderer.dispose();
  report.ms = performance.now() - start;
  return report;
}

function runTier(tier: Tier, scenarios: Omit<Entry, 'packed'>[], run: TierRun): TierCheck {
  const start = performance.now();
  const { ms, readback } = run;
  let t = performance.now();
  const entries: Entry[] = scenarios.map((entry) => ({
    ...entry,
    packed: packScenario(entry.scenario, run.codeMid, run.resident),
  }));
  ms.pack = performance.now() - t;

  // Whole scenarios per draw, up to the instance buffer's capacity.
  const checks: ScenarioCheck[] = [];
  for (let first = 0; first < entries.length;) {
    let count = 0;
    let last = first;
    for (; last < entries.length; last += 1) {
      const instances = entries[last]?.packed.instances.length ?? 0;
      if (count + instances > INSTANCE_CAPACITY) break;
      count += instances;
    }
    const batch = entries.slice(first, last);
    const words = new Uint32Array(count * INSTANCE_WORDS);
    let offset = 0;
    for (const { packed } of batch) {
      words.set(packed.words, offset * INSTANCE_WORDS);
      offset += packed.instances.length;
    }
    const readout = readback.read(words, count);
    ms.gpu += readout.ms;
    offset = 0;
    for (const entry of batch) {
      checks.push(checkScenario(entry, new Readout(readout, offset), tier, run));
      offset += entry.packed.instances.length;
    }
    first = last;
  }

  t = performance.now();
  const controls = (['cS', 'cN', 'dN'] as const).map((kind) => negativeControl(kind, entries, run));
  ms.checks += performance.now() - t;
  ms.total = performance.now() - start;
  const excluded = new Set(
    REQUIRED_COMBINATIONS.filter((c) => EXCLUDED.some(({ where }) => matches(c, where))).map(
      combinationKey,
    ),
  );
  const required = REQUIRED_COMBINATIONS.filter((c) => c.tier === tier)
    .map(combinationKey)
    .filter((key) => !excluded.has(key));
  return {
    tier,
    segments: run.grid.segments,
    instances: entries.reduce((sum, e) => sum + e.packed.instances.length, 0),
    scenarios: checks,
    controls,
    required,
    ms,
  };
}

/** One scenario's instances in a readout, as floats and as float bits. */
class Readout {
  readonly vertices: number;
  readonly position: Float32Array;
  readonly data: Float32Array;
  readonly extra: Float32Array;
  readonly positionBits: Uint32Array;
  readonly dataBits: Uint32Array;
  readonly extraBits: Uint32Array;

  constructor(
    readout: MeshReadout,
    readonly offset: number,
  ) {
    this.vertices = readout.vertices;
    this.position = readout.position;
    this.data = readout.data;
    this.extra = readout.extra;
    this.positionBits = new Uint32Array(readout.position.buffer);
    this.dataBits = new Uint32Array(readout.data.buffer);
    this.extraBits = new Uint32Array(readout.extra.buffer);
  }

  /** Where instance `instance`'s vertex `vertex` starts, in every pass. */
  at(instance: number, vertex: number): number {
    return 4 * ((this.offset + instance) * this.vertices + vertex);
  }

  positionOf({ instance, vertex }: VertexRef): [number, number, number] {
    const i = this.at(instance, vertex);
    return [this.position[i] ?? NaN, this.position[i + 1] ?? NaN, this.position[i + 2] ?? NaN];
  }

  /** The fields in which two vertices of one lattice point differ in bits. */
  seamFields(a: VertexRef, b: VertexRef): string[] {
    const i = this.at(a.instance, a.vertex);
    const j = this.at(b.instance, b.vertex);
    const same = (bits: Uint32Array, c: number) => bits[i + c] === bits[j + c];
    const fields: string[] = [];
    if (![0, 1, 2].every((c) => same(this.positionBits, c))) fields.push('position');
    if (!same(this.dataBits, 0)) fields.push('code');
    if (!same(this.dataBits, 1)) fields.push('h');
    if (!same(this.extraBits, 0)) fields.push('shore');
    const land = (k: number) => infoField(this.data[k + 3] ?? NaN, 'land');
    if (land(i) !== land(j)) fields.push('land');
    return fields;
  }
}

function checkScenario(entry: Entry, out: Readout, tier: Tier, run: TierRun): ScenarioCheck {
  const { packed, scenario, family } = entry;
  const { grid, ctx, ms } = run;
  const G = grid.segments;
  const samples: ScenarioCheck['samples'] = { mirror: [], seams: [], tJunctions: [] };
  const sample = (kind: keyof typeof samples, text: string) => {
    if (samples[kind].length < SAMPLES) samples[kind].push(text);
  };
  const name = ({ instance, vertex }: VertexRef) => {
    const tile = packed.instances[instance]?.node.tile;
    const [k, l, role] = gridVertex(grid, vertex);
    return `${tile ? tileKey(tile) : '?'} (${k}, ${l}${role === SKIRT ? ', skirt' : ''})`;
  };
  const mirror: MirrorCheck = {
    code: 0,
    shore: 0,
    land: 0,
    h: 0,
    disp: 0,
    m: 0,
    cls: 0,
    info: 0,
    posWorst: 0,
    uvWorst: 0,
  };
  const check: ScenarioCheck = {
    name: scenario.name,
    family,
    instances: packed.instances.length,
    unwritten: 0,
    sharedPoints: 0,
    seamMismatches: 0,
    tJunctions: 0,
    tJunctionWorstUlp: 0,
    mirror,
    posWorstAt: '',
    skirts: { count: 0, tjunctions: 0, deep: 0, worst: 0 },
    combinations: [...combinationsOf(scenario, tier)],
    samples,
  };

  // Assert 3: every vertex against the mirror, the exact fields bit for bit.
  let t = performance.now();
  const mirrored = packed.instances.map((_, i) => mirrorInstance(packed.words, i, grid, ctx));
  ms.mirror += performance.now() - t;
  t = performance.now();
  mirrored.forEach((vertices, instance) => {
    vertices.forEach((v, vertex) => {
      const ref = { instance, vertex };
      const i = out.at(instance, vertex);
      const info = out.data[i + 3] ?? NaN;
      if (out.position[i + 3] !== v.role || !(info >= 0) || out.extra[i + 3] !== 1) {
        check.unwritten += 1;
      }
      const diff = (field: keyof MirrorCheck, gpu: number | undefined, cpu: number) => {
        if (Object.is(gpu, cpu)) return;
        mirror[field] += 1;
        sample('mirror', `${name(ref)} ${field}: GPU ${gpu} vs mirror ${cpu}`);
      };
      diff('code', out.data[i], v.code);
      diff('h', out.data[i + 1], v.h);
      diff('disp', out.data[i + 2], v.disp);
      diff('shore', out.extra[i], v.shore);
      diff('land', infoField(info, 'land'), Number(v.land));
      diff('m', infoField(info, 'm'), v.m);
      diff('cls', infoField(info, 'cls'), CLASSES.indexOf(v.cls));
      const rest = (['lv', 'faceEdge', 'up', 'tjunction'] as const)
        .map((k) => infoField(info, k))
        .join();
      const expected = [v.lv, Number(v.faceEdge), Number(v.up), v.count - 1].join();
      if (rest !== expected) {
        mirror.info += 1;
        sample('mirror', `${name(ref)} lv, faceEdge, up, T-junction: GPU ${rest} vs ${expected}`);
      }
      for (let c = 0; c < 3; c += 1) {
        const gap = Math.abs((out.position[i + c] ?? NaN) - (v.position[c] ?? NaN));
        if (gap <= mirror.posWorst) continue;
        mirror.posWorst = Number.isNaN(gap) ? Infinity : gap;
        const [gpu, cpu] = [out.positionOf(ref).join(), v.position.join()];
        check.posWorstAt = `${name(ref)}: GPU ${gpu} vs mirror ${cpu}`;
      }
      for (let c = 0; c < 2; c += 1) {
        const gap = Math.abs((out.extra[i + 1 + c] ?? NaN) - (v.uv[c] ?? NaN));
        if (!(gap <= mirror.uvWorst)) mirror.uvWorst = Number.isNaN(gap) ? Infinity : gap;
      }
    });
  });

  // Assert 1: every instance holding a shared point writes the same bits.
  const groups = sharedPointGroups(packed, grid);
  check.sharedPoints = groups.size;
  for (const [point, [first, ...rest]] of groups) {
    if (!first) continue;
    for (const other of rest) {
      const fields = out.seamFields(first, other);
      if (fields.length === 0) continue;
      check.seamMismatches += 1;
      sample('seams', `${point} ${fields.join()}: ${name(other)} vs ${name(first)}`);
    }
  }

  // Assert 2: T-junctions sit at the midpoint of the coarse instance's read-back chord.
  const junctions = tJunctions(packed, grid, groups);
  check.tJunctions = junctions.length;
  for (const junction of junctions) {
    const p = out.positionOf(junction);
    const [a, b] = junction.ends.map((end) => out.positionOf(end));
    for (let c = 0; c < 3; c += 1) {
      const midpoint = f(f((a?.[c] ?? NaN) + (b?.[c] ?? NaN)) * 0.5);
      const ulps = ulpDistance(p[c] ?? NaN, midpoint);
      if (ulps <= check.tJunctionWorstUlp) continue;
      check.tJunctionWorstUlp = ulps;
      if (ulps > 1) sample('tJunctions', `${junction.at} component ${c}: ${ulps} steps off`);
    }
  }

  // Assert 4: skirt bottoms hang skirtTexels node texels radially below their tops.
  packed.instances.forEach(({ node, state }, instance) => {
    const depth = (ctx.skirtTexels * (Math.PI / 2)) / (256 * 2 ** node.tile.level);
    for (let vertex = 0; vertex < grid.vertexCount; vertex += 1) {
      const [k, l, role] = gridVertex(grid, vertex);
      if (role !== SKIRT) continue;
      check.skirts.count += 1;
      if (isTJunction(state.flags, k, l, G)) check.skirts.tjunctions += 1;
      if (node.source !== node.tile.level) check.skirts.deep += 1;
      const top = out.positionOf({ instance, vertex: surfaceVertexOf(grid, vertex) });
      const bottom = out.positionOf({ instance, vertex });
      const r = Math.hypot(...top);
      top.forEach((value, c) => {
        const gap = Math.abs(value - (bottom[c] ?? NaN) - (value / r) * depth);
        if (!(gap <= check.skirts.worst)) check.skirts.worst = Number.isNaN(gap) ? Infinity : gap;
      });
    }
  });
  ms.checks += performance.now() - t;
  return check;
}

const ulpView = new DataView(new ArrayBuffer(4));

/** How many float32 steps apart two float32 values are (±0 alike); Infinity with a NaN. */
function ulpDistance(a: number, b: number): number {
  if (Number.isNaN(a) || Number.isNaN(b)) return Infinity;
  const ordered = (x: number) => {
    ulpView.setFloat32(0, x);
    const bits = ulpView.getUint32(0);
    return bits >= 0x80000000 ? 0x80000000 - bits : bits;
  };
  return Math.abs(ordered(a) - ordered(b));
}

/**
 * Candidate single-bit flips of `flags`: a half-edge or corner cS bit, an edge's cN bit, or a
 * corner dN bit that leaves dN at 2 or less.
 */
function flips(flags: number, kind: ControlKind): number[] {
  switch (kind) {
    case 'cS':
      return [4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 18, 21];
    case 'cN':
      return [0, 1, 2, 3];
    case 'dN':
      return [0, 1, 2, 3].flatMap((c) =>
        [13 + 3 * c, 14 + 3 * c].filter((bit) => (((flags ^ (1 << bit)) >>> (13 + 3 * c)) & 3) < 3),
      );
  }
}

const SHARED_FIELDS = ['code', 'shore', 'land', 'h', 'dir', 'position'] as const;

function sameShared(a: MirrorVertex, b: MirrorVertex): boolean {
  return SHARED_FIELDS.every((field) => {
    const y = [b[field]].flat();
    return [a[field]].flat().every((value, i) => Object.is(value, y[i]));
  });
}

/**
 * Assert 5: the first flip of `kind`, in scenario, instance and bit order, that changes what an
 * instance derives at a point it shares and that the mirror shows as a seam mismatch, drawn on the
 * GPU with its source's parent in the up slot wherever a cS bit reads it. The GPU must show the
 * same mismatches and agree with the mirror on the flipped instance.
 */
function negativeControl(kind: ControlKind, entries: Entry[], run: TierRun): ControlCheck {
  const { grid, ctx, readback } = run;
  const G = grid.segments;
  const mirrorAt = (words: Uint32Array, { instance, vertex }: VertexRef) => {
    const [k, l, role] = gridVertex(grid, vertex);
    return mirrorVertex(words, instance, k, l, role, ctx);
  };
  let tried = 0;
  for (const { packed } of entries) {
    const groups = sharedPointGroups(packed, grid);
    const holds = packed.instances.map(() => new Set<number>());
    for (const members of groups.values()) {
      for (const { instance, vertex } of members) holds[instance]?.add(vertex);
    }
    const baseline = new Map<string, MirrorVertex>();
    const base = (ref: VertexRef) => {
      const key = `${ref.instance}:${ref.vertex}`;
      let v = baseline.get(key);
      if (!v) baseline.set(key, (v = mirrorAt(packed.words, ref)));
      return v;
    };
    for (const [instance, { node, state }] of packed.instances.entries()) {
      const held = [...(holds[instance] ?? [])];
      for (const bit of flips(state.flags, kind)) {
        const flags = (state.flags ^ (1 << bit)) >>> 0;
        if (flagsNeedUp(flags) && node.source === 0) continue;
        const changes = held.some((vertex) => {
          const [k, l] = gridVertex(grid, vertex);
          const was = sharedPoint(node, state.flags, k, l, G);
          const now = sharedPoint(node, flags, k, l, G);
          return (
            was.lv !== now.lv ||
            was.m !== now.m ||
            isTJunction(state.flags, k, l, G) !== isTJunction(flags, k, l, G)
          );
        });
        if (!changes) continue;
        tried += 1;
        const words = packed.words.slice();
        const up = () => {
          const tile = ancestorAt(node.tile, node.source - 1);
          return state.up ?? { slot: run.resident(tile), codeMid: run.codeMid(tile) };
        };
        packInstance(words, instance, {
          tile: state.tile,
          src: state.src,
          flags,
          ...(flagsNeedUp(flags) ? { up: up() } : {}),
        });
        const flipped = new Map(
          held.map((vertex) => [vertex, mirrorAt(words, { instance, vertex })]),
        );
        const value = (ref: VertexRef) =>
          (ref.instance === instance && flipped.get(ref.vertex)) || base(ref);
        const touched = [...groups.values()].filter((g) => g.some((r) => r.instance === instance));
        const pairs = touched.flatMap(([first, ...rest]) =>
          first ? rest.map((other): [VertexRef, VertexRef] => [first, other]) : [],
        );
        const mirrorMismatches = pairs.filter(([a, b]) => !sameShared(value(a), value(b))).length;
        if (mirrorMismatches === 0) continue;
        const out = new Readout(readback.read(words, packed.instances.length), 0);
        const gpuMismatches = pairs.filter(([a, b]) => out.seamFields(a, b).length > 0).length;
        let mirrorDiffs = 0;
        for (const [vertex, v] of flipped) {
          const i = out.at(instance, vertex);
          const same =
            Object.is(out.data[i], v.code) &&
            Object.is(out.data[i + 1], v.h) &&
            Object.is(out.extra[i], v.shore);
          if (!same) mirrorDiffs += 1;
        }
        const flip = `${packed.scenario.name}: ${tileKey(node.tile)} bit ${bit}`;
        return { kind, flip, tried, mirrorMismatches, gpuMismatches, mirrorDiffs };
      }
    }
  }
  return { kind, flip: 'none', tried, mirrorMismatches: 0, gpuMismatches: 0, mirrorDiffs: 0 };
}
