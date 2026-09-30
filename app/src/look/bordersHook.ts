// The look's borders hook (streaming.md 3.3): borders as a fine dotted groove engraved in the
// land, as engraved maps of the period tell frontiers from rivers, darkened like the coast's and a
// touch rougher, a constant width and pitch on screen. Lakes count as land, so a border runs on
// across them, and each ends where the look draws the coast; at sea the field's borders run on
// unseen. With its strength at 0, the default, the look is unchanged; the walk compiles it at 0
// before it starts.
//
// The look holds one border array in one sampler. Where Explore is not enabled, it is milestone
// 1's 1815 field: one R8 array of six faces, allocated with the look, given its bytes once its file
// has arrived and uploaded a face at a time (story/effects/borders.ts), and read at the face
// coordinates the look already has; visitors' program is exactly milestone 1's. Where Explore is
// enabled, it holds the border steps (borders/): an RG8 array of 1024² layers, a slot of six faces
// per step drawn (two on the full tier, one on lite) and a two-layer ring of preview cells. It
// draws two sources, each a slot or a preview cell, and dissolves between them by blending their
// drawn lines: a step's outer line as the 1815 groove, lighter and feathered where stateless land
// lies on one side, and its inner line, finer and fainter, fading in as the view narrows.
import {
  DataArrayTexture,
  NearestFilter,
  RedFormat,
  RGFormat,
  UnsignedByteType,
  Vector4,
  type Material,
} from 'three';
import type { Tier } from '../config/tunables';
import {
  BORDER_APRON,
  BORDER_FACES,
  BORDER_TEXELS,
  PREVIEW_H,
  PREVIEW_W,
  STEP_TEXELS,
} from '../data/borders';

/** How the groove is cut. */
export const BORDER_LOOK = {
  /** Its width in pixels, whatever the zoom. */
  widthPx: 2,
  /** The pitch of its dots along the border, in pixels: each dot about half of it. */
  dotPx: 5,
  /** How much it darkens the metal, and how much rougher it leaves it. */
  darken: 0.75,
  roughen: 0.2,
  /**
   * Field texels a pixel over which it fades out as the view widens: past about 5, the field's
   * reach (8 texels) no longer spans the line, and every texel beyond it would read as a border.
   */
  fadeTexPx: [4, 5],
} as const;

export interface BorderUniforms {
  /** 0 leaves the look as it is. */
  lookBorderStrength: { value: number };
  /** Six faces of signed distances in texels, each min(255, rha(128 + 16·clamp(d, −8, 8))). */
  lookBorderField: { value: DataArrayTexture };
}

/**
 * The uniforms, with the field allocated on the GPU at its first draw but not filled, and no bytes
 * of its own until its file arrives.
 */
export function createBorderUniforms(): BorderUniforms {
  const field = new DataArrayTexture(null, BORDER_TEXELS, BORDER_TEXELS, BORDER_FACES);
  field.format = RedFormat;
  field.type = UnsignedByteType;
  field.minFilter = field.magFilter = NearestFilter;
  field.generateMipmaps = false;
  field.unpackAlignment = 1;
  field.source.dataReady = false;
  field.needsUpdate = true;
  return { lookBorderStrength: { value: 0 }, lookBorderField: { value: field } };
}

/** Gives the field its six faces' bytes, one face after another, to upload a face at a time. */
export function fillBorderField(uniforms: BorderUniforms, faces: Uint8Array): void {
  const field = uniforms.lookBorderField.value;
  field.image.data = faces;
  field.source.dataReady = true;
}

/** Uploads one face of the filled field at the next draw. */
export function uploadBorderFace(uniforms: BorderUniforms, face: number): void {
  const field = uniforms.lookBorderField.value;
  field.addLayerUpdate(face);
  if (face === BORDER_FACES - 1) {
    // Faces are scheduled in order. three calls this only after uploading every pending layer;
    // clearing here, rather than when the last face is scheduled, keeps all partial reads valid.
    // The field never changes again, and a lost context reloads the page (owner decision 21).
    field.onUpdate = () => {
      field.image.data = null;
      field.onUpdate = null;
    };
  }
  field.needsUpdate = true;
}

const registry = new WeakMap<Material, BorderUniforms>();

export function registerBorders(material: Material, uniforms: BorderUniforms): void {
  registry.set(material, uniforms);
}

/** The border uniforms of a surface look's material, if it has the hook. */
export function borderUniformsOf(material: Material): BorderUniforms | undefined {
  return registry.get(material);
}

const f = (x: number) => x.toFixed(6);
const INTERIOR = BORDER_TEXELS - 2 * BORDER_APRON;

/** After the look's pars: the uniforms and lookBorders(), which reads LookSurface. */
export const BORDERS_FRAGMENT_PARS = /* glsl */ `
uniform float lookBorderStrength;
uniform highp sampler2DArray lookBorderField;

// The signed distance in field texels to the nearest border at face coordinates st: bilinear from
// the four texels around, in float, so it holds its sub-texel place close up. Its sign flips where
// the nearest border changes, in a polity's middle, without passing a border; four texels that
// span such a jump, more than a border's step apart, lie far from any.
float lookBorderDist(vec2 st, int face) {
  vec2 t = (st + 1.0) * ${f(INTERIOR / 2)} + ${f(BORDER_APRON - 0.5)};
  vec2 fr = fract(t);
  ivec2 b = clamp(ivec2(t - fr), ivec2(0), ivec2(${BORDER_TEXELS - 2}));
  vec4 d = vec4(
    texelFetch(lookBorderField, ivec3(b, face), 0).r,
    texelFetch(lookBorderField, ivec3(b + ivec2(1, 0), face), 0).r,
    texelFetch(lookBorderField, ivec3(b + ivec2(0, 1), face), 0).r,
    texelFetch(lookBorderField, ivec3(b + ivec2(1, 1), face), 0).r
  ) * ${f(255 / 16)} - 8.0;
  float lo = min(min(d.x, d.y), min(d.z, d.w));
  float hi = max(max(d.x, d.y), max(d.z, d.w));
  if (lo < 0.0 && hi > 0.0 && hi - lo > 2.0) return 8.0;
  return mix(mix(d.x, d.y, fr.x), mix(d.z, d.w, fr.x), fr.y);
}

void lookBorders(inout LookSurface s) {
  if (lookBorderStrength <= 0.0 || lookDebug != 0) return;
  float texPx = max(max(length(dFdx(vLookSt)), length(dFdy(vLookSt))) * ${f(INTERIOR / 2)}, 1e-4);
  float d = lookBorderDist(vLookSt, vLookFace);
  // Dots along the border: its screen tangent is across the gradient of d.
  vec2 g = vec2(dFdx(d), dFdy(d));
  vec2 along = vec2(-g.y, g.x) / max(length(g), 1e-6);
  float phase = abs(fract(dot(gl_FragCoord.xy, along) / ${f(BORDER_LOOK.dotPx)}) - 0.5);
  float dots = 1.0 - smoothstep(0.22, 0.32, phase);
  float wide = 1.0 - smoothstep(${f(BORDER_LOOK.fadeTexPx[0])}, ${f(BORDER_LOOK.fadeTexPx[1])}, texPx);
  float line = lookLine(abs(d) / texPx, ${f(BORDER_LOOK.widthPx)}) * dots * wide;
  float groove = line * s.ground * lookBorderStrength;
  s.albedo *= 1.0 - ${f(BORDER_LOOK.darken)} * groove;
  s.roughness = min(1.0, s.roughness + ${f(BORDER_LOOK.roughen)} * groove);
}
`;

/** After the climate's wash, before the ash hook lays its dust over the land. */
export const BORDERS_FRAGMENT_APPLY = /* glsl */ `
  lookBorders(lookS);
`;

/** A step's inner line (owner decision 36): 2 px dots every 4 px, 1.5 px wide, darkening 0.55. */
export const INNER_LOOK = { widthPx: 1.5, dotPx: 4, halfDotPx: 1, darken: 0.55 } as const;

/**
 * A step's soft edge, an outer line with stateless land on one side (owner decision 35): a third
 * lighter than a hard one, its edge feathered out to 2.5 px.
 */
export const SOFT_LOOK = { lighten: 1 / 3, featherPx: [0.25, 2.5] } as const;

/** The outer line's dots: about 2.7 px of every 5 (BORDER_LOOK.dotPx), as milestone 1's. */
const OUTER_HALF_DOT_PX = 1.35;

/** Step slots, each six faces; the preview ring's layers after them, 2 × 4 cells a layer. */
export const STEP_SLOTS: Record<Tier, number> = { lite: 1, full: 2 };
export const RING_LAYERS = 2;
export const CELL_COLUMNS = 2;
export const CELL_ROWS = 4;
export const RING_CELLS = RING_LAYERS * CELL_COLUMNS * CELL_ROWS;

/** The array's layers on a tier: its slots' faces, then the ring. */
export function stepLayers(tier: Tier): number {
  return STEP_SLOTS[tier] * BORDER_FACES + RING_LAYERS;
}

/** Where a ring cell lies: its layer and its first texel's column and row. */
export function cellPlace(tier: Tier, cell: number): { layer: number; x: number; y: number } {
  const inLayer = cell % (CELL_COLUMNS * CELL_ROWS);
  return {
    layer: STEP_SLOTS[tier] * BORDER_FACES + Math.floor(cell / (CELL_COLUMNS * CELL_ROWS)),
    x: (inLayer % CELL_COLUMNS) * PREVIEW_W,
    y: Math.floor(inLayer / CELL_COLUMNS) * PREVIEW_H,
  };
}

/**
 * What a source draws, as its uniform: (kind, layer, column, row). Kind 0 draws nothing, 1 a step
 * slot from its first layer, 2 and 3 a preview cell's R or G from its layer and first texel.
 */
export type BorderSource =
  | { kind: 'none' }
  | { kind: 'slot'; slot: number }
  | { kind: 'cell'; cell: number; channel: 0 | 1 };

export function sourceVector(tier: Tier, source: BorderSource, out = new Vector4()): Vector4 {
  if (source.kind === 'none') return out.set(0, 0, 0, 0);
  if (source.kind === 'slot') return out.set(1, source.slot * BORDER_FACES, 0, 0);
  const { layer, x, y } = cellPlace(tier, source.cell);
  return out.set(2 + source.channel, layer, x, y);
}

export interface StepUniforms {
  /** 0 leaves the look as it is. */
  lookBorderStrength: { value: number };
  /** How strongly the inner lines draw, by the view's width (borderInnerKm). */
  lookBorderInner: { value: number };
  /**
   * RG8, 1024² a layer: a step's six faces a slot, R the outer distance and G the inner with the
   * soft bit (WBF2), then the preview ring's cells, two previews a cell (WBP2).
   */
  lookBorderField: { value: DataArrayTexture };
  /** The sources dissolved between (sourceVector), and B's share. */
  lookBorderA: { value: Vector4 };
  lookBorderB: { value: Vector4 };
  lookBorderMix: { value: number };
}

/**
 * The steps' uniforms for a tier, with the array unallocated until the borders' runtime allocates
 * it at boot (borders/borderArray.ts), and both sources drawing nothing.
 */
export function createStepUniforms(tier: Tier): StepUniforms {
  const field = new DataArrayTexture(null, STEP_TEXELS, STEP_TEXELS, stepLayers(tier));
  field.format = RGFormat;
  field.type = UnsignedByteType;
  field.minFilter = field.magFilter = NearestFilter;
  field.generateMipmaps = false;
  field.flipY = false;
  field.unpackAlignment = 1;
  field.source.dataReady = false;
  field.needsUpdate = true;
  return {
    lookBorderStrength: { value: 0 },
    lookBorderInner: { value: 0 },
    lookBorderField: { value: field },
    lookBorderA: { value: new Vector4(0, 0, 0, 0) },
    lookBorderB: { value: new Vector4(0, 0, 0, 0) },
    lookBorderMix: { value: 0 },
  };
}

const stepRegistry = new WeakMap<Material, StepUniforms>();

export function registerBorderSteps(material: Material, uniforms: StepUniforms): void {
  stepRegistry.set(material, uniforms);
}

/** The step uniforms of a surface look's material, where Explore is enabled. */
export function stepUniformsOf(material: Material): StepUniforms | undefined {
  return stepRegistry.get(material);
}

const STEP_INTERIOR = STEP_TEXELS - 2 * BORDER_APRON;

/** STEPS: after the look's pars, the uniforms and lookBorders(), which reads LookSurface. */
export const STEPS_FRAGMENT_PARS = /* glsl */ `
uniform float lookBorderStrength;
uniform float lookBorderInner;
uniform highp sampler2DArray lookBorderField;
uniform vec4 lookBorderA;
uniform vec4 lookBorderB;
uniform float lookBorderMix;

// Bilinear from four taps of a signed distance: its sign flips where the nearest border changes,
// in a polity's middle, without passing a border, so four taps that span such a jump, more than a
// border's step apart, lie far from any.
float lookBorderLerp(vec4 d, vec2 fr) {
  float lo = min(min(d.x, d.y), min(d.z, d.w));
  float hi = max(max(d.x, d.y), max(d.z, d.w));
  if (lo < 0.0 && hi > 0.0 && hi - lo > 2.0) return 8.0;
  return mix(mix(d.x, d.y, fr.x), mix(d.z, d.w, fr.x), fr.y);
}

float lookBorderLerp1(vec4 v, vec2 fr) {
  return mix(mix(v.x, v.y, fr.x), mix(v.z, v.w, fr.x), fr.y);
}

// A step's distances at face coordinates st from its face's layer: x the outer (R), y the inner
// (G's bits 0-6), in field texels, and z its softness, the taps' soft bits (G's bit 7)
// interpolated, since a packed bit cannot be filtered.
vec3 lookStepDist(vec2 st, int layer) {
  vec2 t = (st + 1.0) * ${f(STEP_INTERIOR / 2)} + ${f(BORDER_APRON - 0.5)};
  vec2 fr = fract(t);
  ivec2 b = clamp(ivec2(t - fr), ivec2(0), ivec2(${STEP_TEXELS - 2}));
  vec2 t00 = texelFetch(lookBorderField, ivec3(b, layer), 0).rg;
  vec2 t10 = texelFetch(lookBorderField, ivec3(b + ivec2(1, 0), layer), 0).rg;
  vec2 t01 = texelFetch(lookBorderField, ivec3(b + ivec2(0, 1), layer), 0).rg;
  vec2 t11 = texelFetch(lookBorderField, ivec3(b + ivec2(1, 1), layer), 0).rg;
  vec4 r = vec4(t00.x, t10.x, t01.x, t11.x) * ${f(255 / 16)} - 8.0;
  vec4 g = floor(vec4(t00.y, t10.y, t01.y, t11.y) * 255.0 + 0.5);
  vec4 soft = step(127.5, g);
  vec4 inner = (g - 128.0 * soft) * 0.125 - 8.0;
  return vec3(lookBorderLerp(r, fr), lookBorderLerp(inner, fr), lookBorderLerp1(soft, fr));
}

// Whether a fragment lies too far from any line for it, or any other fragment of its quad, to
// draw one, given its nearest texel's distance to the nearest line the source draws, in the
// source's texels: more than a line reaches (2.5 px), and what a neighbor 1 px away and the taps
// around it can add. Most of the land takes that one tap, not four, and skips the line, while a
// quad that draws one keeps all its fragments, so the dots' derivatives hold.
bool lookBorderFar(float near, float texPx) {
  return near > 4.0 * texPx + 2.5;
}

// The nearest texel of a step's face layer: its distance to the nearest outer line, and to the
// nearest inner line too while inner lines draw, in field texels.
float lookStepNear(vec2 st, int layer) {
  ivec2 n = clamp(
    ivec2((st + 1.0) * ${f(STEP_INTERIOR / 2)} + ${f(BORDER_APRON)}),
    ivec2(0),
    ivec2(${STEP_TEXELS - 1})
  );
  vec2 v = texelFetch(lookBorderField, ivec3(n, layer), 0).rg;
  float outer = abs(v.x * ${f(255 / 16)} - 8.0);
  if (lookBorderInner <= 0.0) return outer;
  float g = floor(v.y * 255.0 + 0.5);
  return min(outer, abs((g - 128.0 * step(127.5, g)) * 0.125 - 8.0));
}

// The nearest texel of a preview at ll: its distance to the nearest outer line in preview texels,
// shortened by the cosine of the latitude, the most lookPreviewDist's scaling to arc can take off.
float lookPreviewNear(vec2 ll, vec4 src) {
  ivec2 n = ivec2(
    int(mod((ll.x + 180.0) * ${f(PREVIEW_W / 360)}, ${f(PREVIEW_W)})),
    clamp(int((90.0 - ll.y) * ${f(PREVIEW_H / 180)}), 0, ${PREVIEW_H - 1})
  );
  n.x = min(n.x, ${PREVIEW_W - 1});
  vec4 v = texelFetch(lookBorderField, ivec3(ivec2(src.zw + 0.5) + n, int(src.y + 0.5)), 0);
  float q = floor(floor((src.x < 2.5 ? v.r : v.g) * 255.0 + 0.5) * 0.5);
  return abs(q * 0.125 - 8.0) * cos(radians(ll.y));
}

// A preview's distance at longitude and latitude ll in degrees: x the outer, in preview texels of
// latitude, y none, and z its softness. Its taps wrap around the dateline inside their cell and
// hold at the poles, so none reads a neighboring cell. The distance is baked in the grid's texels,
// whose columns narrow by the cosine of the latitude, so it is scaled along the taps' own gradient
// to arc: lines keep their width whichever way they run.
vec3 lookPreviewDist(vec2 ll, vec4 src) {
  vec2 t = vec2((ll.x + 180.0) * ${f(PREVIEW_W / 360)}, (90.0 - ll.y) * ${f(PREVIEW_H / 180)}) - 0.5;
  vec2 fr = fract(t);
  ivec2 b = ivec2(t - fr);
  int x0 = b.x < 0 ? b.x + ${PREVIEW_W} : (b.x >= ${PREVIEW_W} ? b.x - ${PREVIEW_W} : b.x);
  int x1 = x0 == ${PREVIEW_W - 1} ? 0 : x0 + 1;
  int y0 = clamp(b.y, 0, ${PREVIEW_H - 1});
  int y1 = clamp(b.y + 1, 0, ${PREVIEW_H - 1});
  ivec2 o = ivec2(src.zw + 0.5);
  int layer = int(src.y + 0.5);
  vec4 v00 = texelFetch(lookBorderField, ivec3(o + ivec2(x0, y0), layer), 0);
  vec4 v10 = texelFetch(lookBorderField, ivec3(o + ivec2(x1, y0), layer), 0);
  vec4 v01 = texelFetch(lookBorderField, ivec3(o + ivec2(x0, y1), layer), 0);
  vec4 v11 = texelFetch(lookBorderField, ivec3(o + ivec2(x1, y1), layer), 0);
  vec4 v = src.x < 2.5 ? vec4(v00.r, v10.r, v01.r, v11.r) : vec4(v00.g, v10.g, v01.g, v11.g);
  v = floor(v * 255.0 + 0.5);
  vec4 q = floor(v * 0.5);
  vec4 soft = v - 2.0 * q;
  vec4 d = q * 0.125 - 8.0;
  float dist = lookBorderLerp(d, fr);
  vec2 g = 0.5 * vec2(d.y - d.x + d.w - d.z, d.z - d.x + d.w - d.y);
  float slope = length(g);
  if (dist < 7.9 && slope > 0.25) {
    dist *= length(vec2(g.x * cos(radians(ll.y)), g.y)) / slope;
  }
  return vec3(dist, 8.0, lookBorderLerp1(soft, fr));
}

// Dots along a border of distance d, pitchPx apart and 2 halfDotPx long on screen: the border's
// screen tangent is across the gradient of d.
float lookBorderDots(float d, float pitchPx, float halfDotPx) {
  vec2 g = vec2(dFdx(d), dFdy(d));
  vec2 along = vec2(-g.y, g.x) / max(length(g), 1e-6);
  float phase = abs(fract(dot(gl_FragCoord.xy, along) / pitchPx) - 0.5) * pitchPx;
  return 1.0 - smoothstep(halfDotPx - 0.25, halfDotPx + 0.25, phase);
}

// The groove a source cuts, as the share it darkens the metal: its outer line, a soft edge a third
// lighter and feathered, and its inner line, both faded out where a pixel spans more of the
// source's texels than their reach allows. src.x is uniform, so its branches keep derivatives.
float lookBorderGroove(vec4 src, vec2 ll, float degPx) {
  if (src.x < 0.5) return 0.0;
  vec3 fd;
  float texPx;
  if (src.x < 1.5) {
    int layer = int(src.y + 0.5) + vLookFace;
    texPx = max(max(length(dFdx(vLookSt)), length(dFdy(vLookSt))) * ${f(STEP_INTERIOR / 2)}, 1e-4);
    if (lookBorderFar(lookStepNear(vLookSt, layer), texPx)) return 0.0;
    fd = lookStepDist(vLookSt, layer);
  } else {
    texPx = max(degPx * ${f(PREVIEW_H / 180)}, 1e-4);
    if (lookBorderFar(lookPreviewNear(ll, src), texPx)) return 0.0;
    fd = lookPreviewDist(ll, src);
  }
  float wide = 1.0 - smoothstep(${f(BORDER_LOOK.fadeTexPx[0])}, ${f(BORDER_LOOK.fadeTexPx[1])}, texPx);
  float soft = fd.z;
  float distR = abs(fd.x) / texPx;
  float feathered = 1.0 - smoothstep(${f(SOFT_LOOK.featherPx[0])}, ${f(SOFT_LOOK.featherPx[1])}, distR);
  float outerLine = mix(lookLine(distR, ${f(BORDER_LOOK.widthPx)}), feathered, soft);
  float outer = outerLine * lookBorderDots(fd.x, ${f(BORDER_LOOK.dotPx)}, ${f(OUTER_HALF_DOT_PX)})
    * ${f(BORDER_LOOK.darken)} * (1.0 - ${f(SOFT_LOOK.lighten)} * soft);
  float inner = lookBorderInner > 0.0
    ? lookLine(abs(fd.y) / texPx, ${f(INNER_LOOK.widthPx)})
      * lookBorderDots(fd.y, ${f(INNER_LOOK.dotPx)}, ${f(INNER_LOOK.halfDotPx)})
      * ${f(INNER_LOOK.darken)} * lookBorderInner
    : 0.0;
  return max(outer, inner) * wide;
}

void lookBorders(inout LookSurface s) {
  if (lookBorderStrength <= 0.0 || lookDebug != 0) return;
  vec2 ll = vec2(0.0);
  float degPx = 1.0;
  if (max(lookBorderA.x, lookBorderB.x) > 1.5) {
    vec3 dir = lookDirAt(vLookSt);
    ll = lookLonLat(dir);
    degPx = max(degrees(max(length(dFdx(dir)), length(dFdy(dir)))), 1e-7);
  }
  float a = lookBorderMix < 1.0 ? lookBorderGroove(lookBorderA, ll, degPx) : 0.0;
  float b = lookBorderMix > 0.0 ? lookBorderGroove(lookBorderB, ll, degPx) : 0.0;
  float groove = mix(a, b, lookBorderMix) * s.ground * lookBorderStrength;
  s.albedo *= 1.0 - groove;
  s.roughness = min(1.0, s.roughness + ${f(BORDER_LOOK.roughen / BORDER_LOOK.darken)} * groove);
}
`;
