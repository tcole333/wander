// The surface vertex shader (streaming.md 5.6): one GLSL ES 3.00 source that places every drawn
// tile's grid vertices from its instance words and the surface pools. The globe's materials inject
// it into three's shaders, and the GPU readback (meshReadback.ts) wraps the same text in a program
// of its own. It ports vertexMirror.ts line by line, steps 0-3 in the mirror's order, so every
// value up to a point's code, shore and direction is exact and equals the mirror's bit for bit.
// Float constants are emitted as their float32 bits, so the GPU holds the mirror's values rather
// than its own rounding of a decimal, and the source is ASCII, comments too, for every validator.
// It never declares `position`: three, or the readback program, declares it before the pars.
import type { DataArrayTexture } from 'three';
import type { SurfaceRelease } from '../data/release';
import type { SurfacePools } from '../gpu/surfaceUploads';
import { MIP_SIZES } from '../surface/wst';
import { FACE_THREE, type FaceColumns } from './faceFrames';
import { SKIRT, type Segments } from './tileGrid';
import { INV_R, QUARTER_PI, skirtDepth0, TAN_POLY } from './vertexMirror';

export interface SurfaceVertexOptions {
  /** WANDER_G: the grid's segments, 32 on full and 16 on lite. */
  segments: Segments;
  /** Debug builds tint skirts cyan (5.5), where the key check joins them. */
  debugChecks: boolean;
}

/** The pieces a material injects (5.8). */
export interface SurfaceVertexChunk {
  /** For the material's `defines`, which three emits ahead of the shader. */
  defines: Record<string, number>;
  /** Declarations and functions, at global scope before main: after three's `#include <common>`. */
  pars: string;
  /** The first statements of main: `WanderVertex wv` for the rest of the shader to read. */
  mainStart: string;
  /** Fragment declarations the debug checks read; empty without them. */
  fragmentPars: string;
  /** Fragment statements that tint the debug checks' pixels, after three's last write of the color. */
  fragmentDebug: string;
}

/** Levels wanderQLand and wanderC200 hold: L0-L7. */
export const SURFACE_LEVELS = 8;

/** The uniforms the pars declare, in the shape three's materials take. */
export interface SurfaceVertexUniforms {
  wanderHeight: { value: DataArrayTexture };
  wanderShore: { value: DataArrayTexture };
  wanderEdges: { value: DataArrayTexture };
  /** The release's qLand and c200 by level, so both sides of a seam use the same values. */
  wanderQLand: { value: number[] };
  wanderC200: { value: number[] };
  wanderKLand: { value: number };
  /** kSea with Bathymetry on, else 0. */
  wanderKSeaEff: { value: number };
  /** skirtDepth0(skirtTexels): the skirt depth of a level-0 node. */
  wanderSkirt0: { value: number };
}

export interface Relief {
  kLand: number;
  kSeaEff: number;
  skirtTexels: number;
}

export function createSurfaceVertexUniforms(
  pools: SurfacePools,
  surface: Pick<SurfaceRelease, 'qLand' | 'c200'>,
  relief: Relief,
): SurfaceVertexUniforms {
  if (surface.qLand.length > SURFACE_LEVELS || surface.c200.length > SURFACE_LEVELS) {
    throw new RangeError(`the pars hold qLand and c200 for ${SURFACE_LEVELS} levels`);
  }
  return {
    wanderHeight: { value: pools.height.texture },
    wanderShore: { value: pools.shoreWater.texture },
    wanderEdges: { value: pools.edges.texture },
    wanderQLand: { value: [...surface.qLand] },
    wanderC200: { value: [...surface.c200] },
    wanderKLand: { value: relief.kLand },
    wanderKSeaEff: { value: relief.kSeaEff },
    wanderSkirt0: { value: skirtDepth0(relief.skirtTexels) },
  };
}

const bits = new DataView(new ArrayBuffer(4));

/**
 * A float32 as GLSL that yields exactly its bits, uintBitsToFloat of them, where a decimal literal
 * would leave the rounding to the compiler.
 */
export function glslFloatBits(value: number): string {
  if (!Number.isFinite(value) || Math.fround(value) !== value) {
    throw new RangeError(`${value} is not a finite float32`);
  }
  bits.setFloat32(0, value);
  const word = bits.getUint32(0).toString(16).padStart(8, '0').toUpperCase();
  return `uintBitsToFloat(0x${word}u)`;
}

/** WANDER_FACE: per face, a mat3 whose columns are U, V and C in three.js axes, entries 0 or ±1. */
export function glslFaceTable(faces: readonly FaceColumns[] = FACE_THREE): string {
  const entry = (value: number) => {
    if (value !== 0 && value !== 1 && value !== -1) throw new RangeError(`${value} is not 0 or ±1`);
    return value === 0 ? '0.0' : `${value}.0`;
  };
  const matrices = faces.map((columns) => `  mat3(${columns.flat().map(entry).join(', ')})`);
  return `const mat3 WANDER_FACE[${faces.length}] = mat3[${faces.length}](\n${matrices.join(',\n')}\n);`;
}

export function surfaceVertexChunk(options: SurfaceVertexOptions): SurfaceVertexChunk {
  const { segments, debugChecks } = options;
  const defines: Record<string, number> = {
    WANDER_G: segments,
    WANDER_LOG2G: Math.log2(segments),
  };
  if (debugChecks) defines.WANDER_DEBUG_CHECKS = 1;
  return {
    defines,
    pars: PARS,
    mainStart: /* glsl */ `
  WanderVertex wv = wanderVertex();
#ifdef WANDER_DEBUG_CHECKS
  vWanderSkirt = float(wv.role);
#endif
`,
    fragmentPars: debugChecks ? 'in float vWanderSkirt;\n' : '',
    // A skirt's top edge interpolates to 0, so a depth tie on the shared edge never counts.
    fragmentDebug: debugChecks
      ? '  if (vWanderSkirt > 0.0) gl_FragColor = vec4(0.0, 1.0, 1.0, 1.0);\n'
      : '',
  };
}

/** P(z) of wanderTan by Horner's rule, highest power first: ((c0·z + c1)·z + …) + c5. */
function glslTanPoly(): string {
  const [first = NaN, ...rest] = TAN_POLY;
  return rest.reduce((p, c) => `(${p} * z + ${glslFloatBits(c)})`, glslFloatBits(first));
}

const poly = glslTanPoly();

const PARS = /* glsl */ `
// The surface vertex (streaming.md 5.6, surfaceVertex.glsl.ts).
#define WANDER_M0 (7 - WANDER_LOG2G)
#define WANDER_INV_R ${glslFloatBits(INV_R)}
#define WANDER_QUARTER_PI ${glslFloatBits(QUARTER_PI)}
#define WANDER_TEXELS ${MIP_SIZES[0]}.0

invariant gl_Position;

in uvec4 wanderNode;
in uvec4 wanderPrev;
uniform highp sampler2DArray wanderHeight;
uniform highp sampler2DArray wanderShore;
uniform highp sampler2DArray wanderEdges;
uniform float wanderQLand[${SURFACE_LEVELS}];
uniform float wanderC200[${SURFACE_LEVELS}];
uniform float wanderKLand;
uniform float wanderKSeaEff;
uniform float wanderSkirt0;
#ifdef WANDER_DEBUG_CHECKS
out float vWanderSkirt;
#endif

// 0. Helpers, exact by construction.

// 2^e from its bits: ES 3.00 has no ldexp, and exp2 need not be exact.
float wanderPow2(int e) { return uintBitsToFloat(uint(e + 127) << 23); }

// tan(x) for 0 <= x <= pi/4: Cephes' tanf polynomial, since GLSL leaves tan's precision open.
float wanderTan(float x) {
  float z = x * x;
  float p = ${poly};
  return p * z * x + x;
}

// tan(pi s/4), odd and exactly +-1 at |s| = 1, where a tan of float32 pi/4 may land an ulp off 1.
float wanderTanQ(float s) {
  float a = abs(s);
  float r = a == 1.0 ? 1.0 : wanderTan(a * WANDER_QUARTER_PI);
  return s < 0.0 ? -r : r;
}

bool wanderBit(uint flags, int b) { return ((flags >> uint(b)) & 1u) != 0u; }

${glslFaceTable()}

struct WanderNode {
  ivec2 xy;
  int level, face, src, srcSlot, upSlot;
  float srcMid, upMid;
  uint flags;
};

WanderNode wanderDecode(uvec4 w) {
  WanderNode n;
  n.xy = ivec2(w.x & 0xFFu, (w.x >> 8) & 0xFFu);
  n.level = int((w.x >> 16) & 0xFu);
  n.face = int((w.x >> 20) & 7u);
  n.src = int((w.x >> 23) & 0xFu);
  n.srcMid = float(int(w.y & 0xFFFFu) - 32768);
  n.upMid = float(int(w.y >> 16) - 32768);
  n.srcSlot = int(w.z & 0xFFu);
  n.upSlot = int((w.z >> 8) & 0xFFu);
  n.flags = w.w;
  return n;
}

// Rule 7 in one function: land kLand*max(h, 0) (owner decision 18), sea kSeaEff*min(h, 0).
float wanderDisplace(float h, bool land) {
  return land ? wanderKLand * max(h, 0.0) : wanderKSeaEff * min(h, 0.0);
}

// 1. Face-edge profile (rule 3 on a face edge): side e at mip m, along in corners 0..256 of the lv
// tile, as (code - codeMid, shore byte).
vec2 wanderProfile(int slot, int e, int m, float along) {
  float x = along * wanderPow2(-m);
  float x0 = floor(x);
  float f = x - x0;
  ivec3 i = ivec3(int(x0), 4 * m + e, slot);
  vec2 p = texelFetch(wanderEdges, i, 0).rg;
  // Only at m = 0 on deep sub-rects.
  if (f > 0.0) {
    vec2 q = texelFetch(wanderEdges, i + ivec3(1, 0, 0), 0).rg;
    p = p + (q - p) * f;
  }
  return p;
}

// 2. One sampled point: rules 2, 3 and 7, plus the direction.

struct WanderPoint {
  vec3 position;
  // WANDER_FACE[face] * (tanQ(s), tanQ(t), 1), before normalize.
  vec3 dir;
  float code, shore, h, disp;
  int m, lv;
  bool land, faceEdge, up;
};

WanderPoint wanderPoint(WanderNode n, ivec2 kl) {
  bvec4 on = bvec4(kl.y == WANDER_G, kl.x == WANDER_G, kl.y == 0, kl.x == 0);
  int nOn = int(on.x) + int(on.y) + int(on.z) + int(on.w);
  bool up = false;
  // The coarsest node level at the point.
  int coarse = n.level;
  if (nOn == 1) {
    int e = on.x ? 0 : on.y ? 1 : on.z ? 2 : 3;
    int a = (e == 0 || e == 2) ? kl.x : kl.y;
    bool s0 = wanderBit(n.flags, 4 + e);
    bool s1 = wanderBit(n.flags, 8 + e);
    up = a < WANDER_G / 2 ? s0 : a > WANDER_G / 2 ? s1 : (s0 || s1);
    coarse -= int(wanderBit(n.flags, e));
  } else if (nOn == 2) {
    uint cf = (n.flags >> uint(12 + 3 * (2 * int(on.x) + int(on.y)))) & 7u;
    up = (cf & 1u) != 0u;
    coarse -= int(cf >> 1);
  }
  int lv = n.src - int(up);
  int m = clamp(WANDER_M0 - (coarse - lv), 0, 2);
  int slot = up ? n.upSlot : n.srcSlot;
  float mid = up ? n.upMid : n.srcMid;
  // The exact corner coordinates of the point in the lv tile, 0..256.
  int dS = n.level - lv;
  ivec2 o = n.xy - ((n.xy >> dS) << dS);
  vec2 c = vec2(o * WANDER_G + kl) * wanderPow2(8 - WANDER_LOG2G - dS);
  // The face-global lattice.
  ivec2 g = n.xy * WANDER_G + kl;
  int span = WANDER_G << n.level;
  WanderPoint p;
  p.faceEdge = g.x == 0 || g.y == 0 || g.x == span || g.y == span;
  if (p.faceEdge) {
    // Rule 3 on a face edge; a cube corner takes N or S.
    int e = g.y == span ? 0 : g.y == 0 ? 2 : g.x == span ? 1 : 3;
    vec2 pr = wanderProfile(slot, e, m, (e == 0 || e == 2) ? c.x : c.y);
    p.code = pr.x + mid;
    p.shore = pr.y;
  } else {
    // Rule 3 elsewhere: 2D, with dyadic weights.
    vec2 T = (4.0 + c) * wanderPow2(-m) - 0.5;
    vec2 T0 = floor(T);
    vec2 f = T - T0;
    ivec3 i = ivec3(ivec2(T0), slot);
    ivec3 X = ivec3(1, 0, 0);
    ivec3 Y = ivec3(0, 1, 0);
    vec4 h = vec4(
      texelFetch(wanderHeight, i, m).r,
      texelFetch(wanderHeight, i + X, m).r,
      texelFetch(wanderHeight, i + Y, m).r,
      texelFetch(wanderHeight, i + X + Y, m).r
    );
    vec4 s = floor(255.0 * vec4(
      texelFetch(wanderShore, i, m).r,
      texelFetch(wanderShore, i + X, m).r,
      texelFetch(wanderShore, i + Y, m).r,
      texelFetch(wanderShore, i + X + Y, m).r
    ) + 0.5);
    vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
    p.code = dot(h, w) + mid;
    p.shore = dot(s, w);
  }
  // Codes to meters: an exact bracket, then one correctly rounded multiply.
  float q = wanderQLand[lv];
  float c2 = wanderC200[lv];
  p.h = (p.code >= c2 ? p.code : c2 + 4.0 * (p.code - c2)) * q;
  p.land = p.shore >= 128.0;
  p.disp = wanderDisplace(p.h, p.land);
  // s and t are exact, exactly +-1 on face edges.
  vec2 st = vec2(g * 2) * wanderPow2(-(WANDER_LOG2G + n.level)) - 1.0;
  p.dir = WANDER_FACE[n.face] * vec3(wanderTanQ(st.x), wanderTanQ(st.y), 1.0);
  p.position = normalize(p.dir) * (1.0 + p.disp * WANDER_INV_R);
  p.m = m;
  p.lv = lv;
  p.up = up;
  return p;
}

// 3. The vertex: rules 4 and 8, with one call site.

struct WanderVertex {
  // After the T-junction midpoint and the skirt drop.
  vec3 position;
  // Radial: normalize(position) before any skirt drop.
  vec3 normal;
  // The own source's uv, affine in (k, l).
  vec2 uv;
  // The last point sampled: at a T-junction, the second neighbor.
  WanderPoint last;
  int role, count;
  // Interior 0, edge 1, corner 2, T-junction 3.
  int cls;
};

WanderVertex wanderVertex() {
  WanderNode n = wanderDecode(wanderNode);
  ivec2 kl = ivec2(position.xy);
  int role = int(position.z);
  bvec4 on = bvec4(kl.y == WANDER_G, kl.x == WANDER_G, kl.y == 0, kl.x == 0);
  int nOn = int(on.x) + int(on.y) + int(on.z) + int(on.w);
  int count = 1;
  ivec2 stepAlong = ivec2(0);
  if (nOn == 1) {
    int e = on.x ? 0 : on.y ? 1 : on.z ? 2 : 3;
    bool ns = e == 0 || e == 2;
    if (wanderBit(n.flags, e) && ((ns ? kl.x : kl.y) & 1) == 1) {
      count = 2;
      stepAlong = ns ? ivec2(1, 0) : ivec2(0, 1);
    }
  }
  // The only call site: ordinary points and both T-junction neighbors.
  vec3 sum = vec3(0.0);
  WanderPoint p;
  for (int i = 0; i < count; ++i) {
    p = wanderPoint(n, kl + (count == 1 ? ivec2(0) : i == 0 ? -stepAlong : stepAlong));
    // 0 + P is exact when count is 1.
    sum += p.position;
  }
  WanderVertex v;
  v.position = count == 1 ? sum : sum * 0.5;
  v.normal = normalize(v.position);
  // Rule 8: skirtTexels node texels, radially.
  if (role == ${SKIRT}) v.position -= v.normal * (wanderSkirt0 * wanderPow2(-n.level));
  int dO = n.level - n.src;
  ivec2 oo = n.xy - ((n.xy >> dO) << dO);
  v.uv = (4.0 + vec2(oo * WANDER_G + kl) * wanderPow2(8 - WANDER_LOG2G - dO)) / WANDER_TEXELS;
  v.last = p;
  v.role = role;
  v.count = count;
  v.cls = nOn == 0 ? 0 : nOn == 2 ? 2 : count == 2 ? 3 : 1;
  return v;
}
`;
