// The surface vertex rules (streaming.md 5.6) on the CPU, function for function with the vertex
// shader (surfaceVertex.glsl.ts): its steps 0-3 in its order, so the one ports to the other line by
// line. The mirror reads the instance words through the shader's own decode and each pool slot's
// texels as the pools hold them, and it runs in float32: every float operation is rounded with
// Math.fround in the shader's order, and integers stay integers. Up to a shared point's code, shore
// and direction every step is exact, so every instance that holds the point gets the same bits; the
// inexact tail (tan, normalize, displacement) then runs on equal inputs. Vitest proves the seams
// with it, and the GPU readback compares against it.
import constants from '@shared/constants.json' with { type: 'json' };
import { TILE, type Vec3 } from '../surface/cube';
import { halfValue } from '../surface/half';
import { EDGE_ENTRIES, EDGE_ROWS, MIP_SIZES, type DecodedWst } from '../surface/wst';
import { FACE_THREE } from './faceFrames';
import { glslDecode, type DecodedNode } from './instances';
import { SKIRT, type Segments, type TileGrid } from './tileGrid';

const f = Math.fround;

/** The shader's literal 0.7853981633974483, π/4 in float32. */
const QUARTER_PI = f(0.7853981633974483);
/** WANDER_INV_R, scene units (R = 1) per meter; the shader emits this float32 value. */
export const INV_R = f(1 / constants.cube.earthRadiusM);
/** Shore bytes at or above it are land (3.1). */
const LAND_SHORE = 128;
/** Every half-float's value, for the texel fetches. */
const HALF = Float64Array.from({ length: 0x10000 }, (_, bits) => halfValue(bits));

/** What one pool slot holds for the vertex stage: a decoded tile's GPU parts. */
export interface MirrorSlot {
  /** wanderHeight: R16F half bits of code − codeMid at 264², 132² and 66². */
  height: readonly [Uint16Array, Uint16Array, Uint16Array];
  /** wanderShore: RG8 (shore, water) at the same sizes; the vertex stage reads R. */
  channels: readonly [Uint8Array, Uint8Array, Uint8Array];
  /** wanderEdges: RG16F half bits, 257 × 12; texel (k, 4m + e) is (code − codeMid, shore byte). */
  edges: Uint16Array;
}

export function mirrorSlot(decoded: DecodedWst): MirrorSlot {
  return { height: decoded.heightMips, channels: decoded.channelMips, edges: decoded.edges };
}

/** The shader's pools, uniforms and grid. */
export interface MirrorContext {
  /** WANDER_G. */
  segments: Segments;
  /** What each pool slot holds; reading a slot missing here throws. */
  slots: ReadonlyMap<number, MirrorSlot>;
  /** wanderQLand and wanderC200: the release's qLand and c200 by level. */
  qLand: readonly number[];
  c200: readonly number[];
  /** wanderKLand, and wanderKSeaEff: kSea with Bathymetry on, else 0. */
  kLand: number;
  kSeaEff: number;
  /** tunables.skirtTexels: the skirt depth in node texels. */
  skirtTexels: number;
  /** Stands in for wanderTanQ; only the test showing why tanQ is exact at ±1 sets it. */
  tanQ?: (s: number) => number;
}

export type PointClass = 'interior' | 'edge' | 'corner' | 'tjunction';

/** One sampled point (rules 2, 3 and 7) and its direction: the shader's WanderPoint. */
export interface WanderPoint {
  /** three.js space, R = 1. */
  position: Vec3;
  /** Offset + codeMid; a weighted mean of codes where the point falls between texels. */
  code: number;
  /** The shore byte, or a weighted mean of them. */
  shore: number;
  /** Meters. */
  h: number;
  /** wanderDisplace(h, land), meters. */
  disp: number;
  /** The vertex mip and the level of the tile sampled. */
  m: number;
  lv: number;
  land: boolean;
  faceEdge: boolean;
  /** Whether it sampled the up tile, the source's parent. */
  up: boolean;
  /** WANDER_FACE[face]·(tanQ(s), tanQ(t), 1): the direction before normalize, in three.js axes. */
  dir: Vec3;
}

/**
 * The shader's WanderVertex: the final position, and the fields of the last point sampled (at a
 * T-junction, the second neighbor).
 */
export interface MirrorVertex extends Omit<WanderPoint, 'position'> {
  /** After the T-junction midpoint and the skirt drop. */
  position: Vec3;
  /** Radial: normalize(position) before any skirt drop. */
  normal: Vec3;
  /** The own source's uv (for E1). */
  uv: [number, number];
  role: number;
  count: 1 | 2;
  cls: PointClass;
}

// 0. Helpers, exact by construction.

const powBits = new Uint32Array(1);
const powFloat = new Float32Array(powBits.buffer);

/** uintBitsToFloat(uint(e + 127) << 23): 2^e exactly for e in −126..127 (ES 3.00 has no ldexp). */
export function wanderPow2(e: number): number {
  if (!Number.isInteger(e) || e < -126 || e > 127) throw new RangeError(`2^${e} is not normal`);
  powBits[0] = (e + 127) << 23;
  return powFloat[0] ?? NaN;
}

/** tan(πs/4), odd and exactly 0 at 0 and ±1 at |s| = 1: GLSL leaves tan's precision open. */
export function wanderTanQ(s: number): number {
  const a = Math.abs(s);
  const r = a === 1 ? 1 : f(Math.tan(f(a * QUARTER_PI)));
  return s < 0 ? -r : r;
}

function wanderBit(flags: number, b: number): boolean {
  return ((flags >>> b) & 1) !== 0;
}

/** Rule 7 in one function: land kLand·max(h, 0) (owner decision 18), sea kSeaEff·min(h, 0). */
export function wanderDisplace(h: number, land: boolean, kLand: number, kSeaEff: number): number {
  return land ? f(f(kLand) * Math.max(h, 0)) : f(f(kSeaEff) * Math.min(h, 0));
}

/** wanderSkirt0, skirtTexels level-0 node texels: skirtTexels·(π/2)/256 as a float32 uniform. */
export function skirtDepth0(skirtTexels: number): number {
  return f((skirtTexels * (Math.PI / 2)) / TILE);
}

function edgeTexel(slot: MirrorSlot, k: number, row: number): [number, number] {
  if (k < 0 || k >= EDGE_ENTRIES || row < 0 || row >= EDGE_ROWS) {
    throw new RangeError(`edge texel (${k}, ${row}) is outside the texture`);
  }
  const at = 2 * (row * EDGE_ENTRIES + k);
  return [HALF[slot.edges[at] ?? NaN] ?? NaN, HALF[slot.edges[at + 1] ?? NaN] ?? NaN];
}

function texelIndex(m: number, i: number, j: number): number {
  const size = MIP_SIZES[m] ?? 0;
  if (i < 0 || j < 0 || i >= size || j >= size) {
    throw new RangeError(`texel (${i}, ${j}) is outside mip ${m}`);
  }
  return j * size + i;
}

/** texelFetch(wanderHeight, (i, j, slot), m).r: code − codeMid. */
function heightTexel(slot: MirrorSlot, m: number, i: number, j: number): number {
  return HALF[slot.height[m as 0 | 1 | 2][texelIndex(m, i, j)] ?? NaN] ?? NaN;
}

/** texelFetch(wanderShore, (i, j, slot), m).r: the shore byte, normalized as RG8 unorm. */
function shoreTexel(slot: MirrorSlot, m: number, i: number, j: number): number {
  return f((slot.channels[m as 0 | 1 | 2][2 * texelIndex(m, i, j)] ?? NaN) / 255);
}

// 1. Face-edge profile (rule 3 on a face edge).

/** Side e's profile at mip m, `along` in corners 0..256 of the lv tile: (code − codeMid, shore). */
function wanderProfile(slot: MirrorSlot, e: number, m: number, along: number): [number, number] {
  const x = f(along * wanderPow2(-m));
  const x0 = Math.floor(x);
  const fx = f(x - x0);
  let p = edgeTexel(slot, x0, 4 * m + e);
  if (fx > 0) {
    // Only at m = 0 on deep sub-rects.
    const q = edgeTexel(slot, x0 + 1, 4 * m + e);
    p = [f(p[0] + f(f(q[0] - p[0]) * fx)), f(p[1] + f(f(q[1] - p[1]) * fx))];
  }
  return p;
}

// 2. One sampled point: rules 2, 3 and 7, plus the direction.

function wanderPoint(n: DecodedNode, k: number, l: number, ctx: MirrorContext): WanderPoint {
  const G = ctx.segments;
  const log2G = Math.log2(G);
  const on = [l === G, k === G, l === 0, k === 0] as const;
  const nOn = Number(on[0]) + Number(on[1]) + Number(on[2]) + Number(on[3]);
  let up = false;
  let coarse = n.level; // the coarsest node level at the point
  if (nOn === 1) {
    const e = on[0] ? 0 : on[1] ? 1 : on[2] ? 2 : 3;
    const a = e === 0 || e === 2 ? k : l;
    const s0 = wanderBit(n.flags, 4 + e);
    const s1 = wanderBit(n.flags, 8 + e);
    up = a < G / 2 ? s0 : a > G / 2 ? s1 : s0 || s1;
    coarse -= Number(wanderBit(n.flags, e));
  } else if (nOn === 2) {
    const cf = (n.flags >>> (12 + 3 * (2 * Number(on[0]) + Number(on[1])))) & 7;
    up = (cf & 1) !== 0;
    coarse -= cf >> 1;
  }
  const lv = n.src - Number(up);
  const m = Math.min(Math.max(7 - log2G - (coarse - lv), 0), 2);
  const slotIndex = up ? n.upSlot : n.srcSlot;
  const mid = up ? n.upMid : n.srcMid;
  const slot = ctx.slots.get(slotIndex);
  if (!slot) throw new RangeError(`slot ${slotIndex} holds no tile`);
  // The exact corner coordinates of the point in the lv tile, 0..256.
  const dS = n.level - lv;
  const ox = n.xy[0] - ((n.xy[0] >> dS) << dS);
  const oy = n.xy[1] - ((n.xy[1] >> dS) << dS);
  const toCorner = wanderPow2(8 - log2G - dS);
  const cx = f((ox * G + k) * toCorner);
  const cy = f((oy * G + l) * toCorner);
  // The face-global lattice.
  const gx = n.xy[0] * G + k;
  const gy = n.xy[1] * G + l;
  const span = G << n.level;
  const faceEdge = gx === 0 || gy === 0 || gx === span || gy === span;

  let code: number;
  let shore: number;
  if (faceEdge) {
    // Rule 3 on a face edge; a cube corner takes N or S.
    const e = gy === span ? 0 : gy === 0 ? 2 : gx === span ? 1 : 3;
    const pr = wanderProfile(slot, e, m, e === 0 || e === 2 ? cx : cy);
    code = f(pr[0] + mid);
    shore = pr[1];
  } else {
    // Rule 3 elsewhere: 2D, with dyadic weights.
    const toMip = wanderPow2(-m);
    const tx = f(f(f(4 + cx) * toMip) - 0.5);
    const ty = f(f(f(4 + cy) * toMip) - 0.5);
    const i = Math.floor(tx);
    const j = Math.floor(ty);
    const fx = f(tx - i);
    const fy = f(ty - j);
    const h4 = [
      heightTexel(slot, m, i, j),
      heightTexel(slot, m, i + 1, j),
      heightTexel(slot, m, i, j + 1),
      heightTexel(slot, m, i + 1, j + 1),
    ] as const;
    const byte = (v: number) => Math.floor(f(f(255 * v) + 0.5));
    const s4 = [
      byte(shoreTexel(slot, m, i, j)),
      byte(shoreTexel(slot, m, i + 1, j)),
      byte(shoreTexel(slot, m, i, j + 1)),
      byte(shoreTexel(slot, m, i + 1, j + 1)),
    ] as const;
    const w = [f(f(1 - fx) * f(1 - fy)), f(fx * f(1 - fy)), f(f(1 - fx) * fy), f(fx * fy)] as const;
    code = f(dot4(h4, w) + mid);
    shore = dot4(s4, w);
  }
  // Codes to meters: an exact bracket, then one correctly rounded multiply.
  const q = f(ctx.qLand[lv] ?? NaN);
  const c2 = f(ctx.c200[lv] ?? NaN);
  const h = f((code >= c2 ? code : f(c2 + f(4 * f(code - c2)))) * q);
  const land = shore >= LAND_SHORE;
  const disp = wanderDisplace(h, land, ctx.kLand, ctx.kSeaEff);
  // s and t are exact, exactly ±1 on face edges.
  const toSt = wanderPow2(-(log2G + n.level));
  const st = [f(f(2 * gx * toSt) - 1), f(f(2 * gy * toSt) - 1)] as const;
  const dir = faceDirection(n.face, st[0], st[1], ctx.tanQ ?? wanderTanQ);
  const unit = normalize(dir);
  const r = f(1 + f(disp * INV_R));
  const position: Vec3 = [f(unit[0] * r), f(unit[1] * r), f(unit[2] * r)];
  return { position, code, shore, h, disp, m, lv, land, faceEdge, up, dir };
}

/**
 * WANDER_FACE[face]·(tanQ(s), tanQ(t), 1). Every entry is 0 or ±1, so each component is one of
 * ±tanQ(s), ±tanQ(t) and ±1, exactly, with no rounding to emulate.
 */
function faceDirection(face: number, s: number, t: number, tanQ: (s: number) => number): Vec3 {
  const columns = FACE_THREE[face];
  if (!columns) throw new RangeError(`no face ${face}`);
  const [U, V, C] = columns;
  const a = tanQ(s);
  const b = tanQ(t);
  return [U[0] * a + V[0] * b + C[0], U[1] * a + V[1] * b + C[1], U[2] * a + V[2] * b + C[2]];
}

/** dot(a, b), summed in order. */
function dot4(a: readonly number[], b: readonly number[]): number {
  let sum = f((a[0] ?? NaN) * (b[0] ?? NaN));
  for (let i = 1; i < 4; i += 1) sum = f(sum + f((a[i] ?? NaN) * (b[i] ?? NaN)));
  return sum;
}

/**
 * v·inversesqrt(dot(v, v)), correctly rounded. GLSL leaves normalize's precision open, so the GPU
 * is compared to this within a tolerance; shared points get it on equal inputs either way.
 */
function normalize(v: Vec3): Vec3 {
  const inv = f(1 / Math.sqrt(f(f(f(v[0] * v[0]) + f(v[1] * v[1])) + f(v[2] * v[2]))));
  return [f(v[0] * inv), f(v[1] * inv), f(v[2] * inv)];
}

// 3. The vertex: rules 4 and 8, with one call site.

function wanderVertex(
  n: DecodedNode,
  k: number,
  l: number,
  role: number,
  ctx: MirrorContext,
): MirrorVertex {
  const G = ctx.segments;
  const log2G = Math.log2(G);
  const on = [l === G, k === G, l === 0, k === 0] as const;
  const nOn = Number(on[0]) + Number(on[1]) + Number(on[2]) + Number(on[3]);
  let count: 1 | 2 = 1;
  let step: [number, number] = [0, 0];
  if (nOn === 1) {
    const e = on[0] ? 0 : on[1] ? 1 : on[2] ? 2 : 3;
    const ns = e === 0 || e === 2;
    if (wanderBit(n.flags, e) && ((ns ? k : l) & 1) === 1) {
      count = 2;
      step = ns ? [1, 0] : [0, 1];
    }
  }
  // The only call site: ordinary points and both T-junction neighbors.
  let sum: Vec3 = [0, 0, 0];
  let p: WanderPoint | undefined;
  for (let i = 0; i < count; i += 1) {
    const d = count === 1 ? 0 : i === 0 ? -1 : 1;
    p = wanderPoint(n, k + d * step[0], l + d * step[1], ctx);
    // 0 + P is exact when count is 1.
    sum = [f(sum[0] + p.position[0]), f(sum[1] + p.position[1]), f(sum[2] + p.position[2])];
  }
  if (!p) throw new Error('no point sampled');
  let position: Vec3 = count === 1 ? sum : [f(sum[0] * 0.5), f(sum[1] * 0.5), f(sum[2] * 0.5)];
  const normal = normalize(position);
  if (role === SKIRT) {
    // Rule 8: skirtTexels node texels, radially.
    const depth = f(skirtDepth0(ctx.skirtTexels) * wanderPow2(-n.level));
    position = [
      f(position[0] - f(normal[0] * depth)),
      f(position[1] - f(normal[1] * depth)),
      f(position[2] - f(normal[2] * depth)),
    ];
  }
  // The own source's uv, affine in (k, l).
  const dO = n.level - n.src;
  const toCorner = wanderPow2(8 - log2G - dO);
  const ox = n.xy[0] - ((n.xy[0] >> dO) << dO);
  const oy = n.xy[1] - ((n.xy[1] >> dO) << dO);
  const size = MIP_SIZES[0];
  const uv: [number, number] = [
    f(f(4 + f((ox * G + k) * toCorner)) / size),
    f(f(4 + f((oy * G + l) * toCorner)) / size),
  ];
  const cls: PointClass =
    nOn === 0 ? 'interior' : nOn === 2 ? 'corner' : count === 2 ? 'tjunction' : 'edge';
  return { ...p, position, normal, uv, role, count, cls };
}

/** Grid vertex (k, l, role) of instance `instance` in `words`, as the vertex shader computes it. */
export function mirrorVertex(
  words: Uint32Array,
  instance: number,
  k: number,
  l: number,
  role: number,
  ctx: MirrorContext,
): MirrorVertex {
  return wanderVertex(glslDecode(words, instance), k, l, role, ctx);
}

/** Every vertex of `grid` for instance `instance`, in the grid's vertex order. */
export function mirrorInstance(
  words: Uint32Array,
  instance: number,
  grid: TileGrid,
  ctx: MirrorContext,
): MirrorVertex[] {
  if (grid.segments !== ctx.segments) {
    throw new RangeError(`a ${grid.segments}-segment grid in a ${ctx.segments}-segment context`);
  }
  const n = glslDecode(words, instance);
  const vertices: MirrorVertex[] = [];
  for (let v = 0; v < grid.vertexCount; v += 1) {
    const [k = NaN, l = NaN, role = NaN] = grid.position.subarray(3 * v, 3 * v + 3);
    vertices.push(wanderVertex(n, k, l, role, ctx));
  }
  return vertices;
}
