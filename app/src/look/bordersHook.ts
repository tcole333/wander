// The look's borders hook (streaming.md 3.3): borders cut into the land at a constant size on
// screen. Lakes count as land, so a border runs on across them, and each ends where the look draws
// the coast; at sea the field's borders run on unseen. With its strength at 0, the default, the
// look is unchanged; the walk compiles it at 0 before it starts.
//
// Where the release names the border steps the look holds them (borders/) in one border array in
// one sampler: an RG8 array of 1024² layers, a slot of six faces per step drawn (two on the full
// tier, one on lite) and a two-layer ring of preview cells. It draws two sources, each a slot or a
// preview cell, and dissolves between them by blending their drawn lines: a step's outer line as
// an etched bright cut with a hairline shadow on the lamp's side (owner decision 42), dimmer where
// stateless land lies on one side, and its inner lines, finer and fainter, fading in as the view
// narrows. Where the release names none the look has no hook, array or sampler and draws no
// borders.
import {
  Color,
  DataArrayTexture,
  NearestFilter,
  RGFormat,
  UnsignedByteType,
  Vector2,
  Vector4,
  type Material,
} from 'three';
import { tunables, type Tier } from '../config/tunables';
import { BORDER_APRON, BORDER_FACES, PREVIEW_H, PREVIEW_W, STEP_TEXELS } from '../data/borders';

/**
 * What every line the steps draw shares: `fadeTexPx`, the field texels a pixel over which a line
 * fades out as the view widens, since past about 5 the field's reach, 8 texels, no longer spans
 * the line and every texel beyond it would read as a border; and `roughenPerShade`, how much
 * rougher a shadow leaves the metal beside a cut, for each unit it darkens it.
 */
export const BORDER_LOOK = {
  fadeTexPx: [4, 5],
  roughenPerShade: 0.2 / 0.75,
} as const;

const f = (x: number) => x.toFixed(6);

/**
 * A step's lines (owner decision 42): an etched cut through the patina, lighter than the bronze,
 * with a hairline shadow on the lamp's side, where the cut's near wall faces away from the lamp,
 * sized in CSS px. `outer`: the outer line's cut and shadow and how much the shadow darkens the
 * metal. `inner`: the inner lines', finer and fainter (owner decision 34), their brightness, and
 * `close`, their brightness at `borderInnerCloseKm.near` across and closer. `soft`: a soft edge's
 * share of the cut's brightness, drawn without its shadow (owner decision 35). `far`: the outer
 * line's size at `borderWeightKm.far` across and wider, as a share of its near size, since under
 * Explore's lighting the near line is hard to see that far out (owner decision 40). Then the
 * polished metal's color and roughness, and `cap`, the most light a cut reflects, in luminance,
 * under the bloom's threshold, so a cut never glows. The dev page tunes the metal, the shadow's
 * darkening and the cap.
 */
export const ETCHED_LOOK = {
  outer: { cutPx: 1.25, shadowPx: 0.75, shade: 0.7 },
  inner: { cutPx: 0.75, shadowPx: 0.5, bright: 0.45, shade: 0.3, close: 0.79 },
  soft: 0.55,
  far: 1.27,
  color: '#e4d2aa',
  roughness: 0.5,
  cap: 0.7,
} as const;

/** Where `viewKm` lies between `near` and `far` on a log scale, 0 to 1. */
const logShare = (viewKm: number, { near, far }: { near: number; far: number }) =>
  Math.min(1, Math.max(0, Math.log(viewKm / near) / Math.log(far / near)));

/**
 * The outer line's size at a view `viewKm` across, as a share of its near size: 1 at
 * `borderWeightKm.near` across and closer, growing evenly on a log scale of the view's width to
 * ETCHED_LOOK.far at `borderWeightKm.far` and wider.
 */
export function etchedScale(viewKm: number): number {
  return 1 + (ETCHED_LOOK.far - 1) * logShare(viewKm, tunables.borderWeightKm);
}

/**
 * How strongly the inner lines draw at a view `viewKm` across, 0 to 1: none at `borderInnerKm.far`
 * and wider, fading in to all at its near, and dimmed on a log scale of the view's width to
 * ETCHED_LOOK.inner.close at `borderInnerCloseKm.near` and closer.
 */
export function innerShare(viewKm: number): number {
  const { near, far } = tunables.borderInnerKm;
  const t = Math.min(1, Math.max(0, (viewKm - near) / (far - near)));
  const close = ETCHED_LOOK.inner.close;
  return (
    (1 - t * t * (3 - 2 * t)) *
    (close + (1 - close) * logShare(viewKm, tunables.borderInnerCloseKm))
  );
}

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
  /** How strongly the inner lines draw, by the view's width (innerShare). */
  lookBorderInner: { value: number };
  /** The outer line's size by the view's width, as a share of its near size (etchedScale). */
  lookBorderScale: { value: number };
  /** Device px a CSS px, which the lines are sized in. */
  lookBorderPixelRatio: { value: number };
  /** The cut's polished metal; its roughness, and its shadows' share of ETCHED_LOOK's darkening. */
  lookBorderEtched: { value: Color };
  lookBorderEtchedLook: { value: Vector2 };
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
    lookBorderScale: { value: 1 },
    lookBorderPixelRatio: { value: 1 },
    lookBorderEtched: { value: new Color(ETCHED_LOOK.color) },
    lookBorderEtchedLook: { value: new Vector2(ETCHED_LOOK.roughness, 1) },
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

/** The step uniforms of a surface look's material, where the release names the steps. */
export function stepUniformsOf(material: Material): StepUniforms | undefined {
  return stepRegistry.get(material);
}

const STEP_INTERIOR = STEP_TEXELS - 2 * BORDER_APRON;

/** STEPS: after the look's pars, the uniforms and lookBorders(), which reads LookSurface. */
export const STEPS_FRAGMENT_PARS = /* glsl */ `
uniform float lookBorderStrength;
uniform float lookBorderInner;
uniform float lookBorderScale;
uniform float lookBorderPixelRatio;
uniform vec3 lookBorderEtched;
uniform vec2 lookBorderEtchedLook;
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
// quad that draws one keeps all its fragments, so the lines' derivatives hold.
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

// Where a fragment lies across a line of distance d: x, its distance from the line's middle in
// device px, positive on the lamp's side (lampPx, the lamp's direction on screen); and y, how
// squarely the line faces the lamp, 0 where it runs toward it.
vec2 lookBorderAcross(float d, float texPx, vec2 lampPx) {
  vec2 g = vec2(dFdx(d), dFdy(d));
  float facing = dot(g, lampPx) / max(length(g), 1e-6);
  return vec2(d / texPx * (facing < 0.0 ? -1.0 : 1.0), abs(facing));
}

// An etched line, given where a fragment lies across it (lookBorderAcross): (its shadow, its
// cut). The cut is cutPx wide about the line's middle; the shadow, shadowPx wide, lies beside it on
// the lamp's side, where the cut's near wall faces away from the lamp, and fades as the line turns
// toward the lamp.
vec2 lookEtched(vec2 across, float cutPx, float shadowPx) {
  float cut = lookLine(abs(across.x), cutPx);
  float shadow = lookLine(abs(across.x - 0.5 * (cutPx + shadowPx)), shadowPx);
  return vec2(shadow * smoothstep(0.15, 0.6, across.y), cut);
}

// What a source cuts into the metal: x the share its shadows darken it, y the share its cuts take
// the polished metal's color. Its outer line at lookBorderScale, a soft edge dimmer and without its
// shadow, and its inner lines at lookBorderInner's strength, all faded out where a pixel spans
// more of the source's texels than their reach allows. Where the field's reach, 8 texels, ends
// within a shadow, the distance stops changing there, so the shadow, which faces the lamp by the
// distance's gradient, fades out rather than spread. src.x is uniform, so its branches keep
// derivatives.
vec2 lookBorderCut(vec4 src, vec2 ll, float degPx, vec2 lampPx) {
  if (src.x < 0.5) return vec2(0.0);
  vec3 fd;
  float texPx;
  if (src.x < 1.5) {
    int layer = int(src.y + 0.5) + vLookFace;
    texPx = max(max(length(dFdx(vLookSt)), length(dFdy(vLookSt))) * ${f(STEP_INTERIOR / 2)}, 1e-4);
    if (lookBorderFar(lookStepNear(vLookSt, layer), texPx)) return vec2(0.0);
    fd = lookStepDist(vLookSt, layer);
  } else {
    texPx = max(degPx * ${f(PREVIEW_H / 180)}, 1e-4);
    if (lookBorderFar(lookPreviewNear(ll, src), texPx)) return vec2(0.0);
    fd = lookPreviewDist(ll, src);
  }
  float wide = 1.0 - smoothstep(${f(BORDER_LOOK.fadeTexPx[0])}, ${f(BORDER_LOOK.fadeTexPx[1])}, texPx);
  float soft = fd.z;
  float px = lookBorderPixelRatio;
  vec2 outer = lookEtched(
    lookBorderAcross(fd.x, texPx, lampPx),
    ${f(ETCHED_LOOK.outer.cutPx)} * lookBorderScale * px,
    ${f(ETCHED_LOOK.outer.shadowPx)} * lookBorderScale * px
  ) * vec2(${f(ETCHED_LOOK.outer.shade)} * (1.0 - soft), mix(1.0, ${f(ETCHED_LOOK.soft)}, soft));
  vec2 inner = vec2(0.0);
  if (lookBorderInner > 0.0) {
    inner = lookEtched(
      lookBorderAcross(fd.y, texPx, lampPx),
      ${f(ETCHED_LOOK.inner.cutPx)} * px,
      ${f(ETCHED_LOOK.inner.shadowPx)} * px
    ) * vec2(${f(ETCHED_LOOK.inner.shade)}, ${f(ETCHED_LOOK.inner.bright)}) * lookBorderInner;
  }
  return max(outer, inner) * wide;
}

// lampPx: the lamp's direction on screen, for the cuts' shadows (STEPS_FRAGMENT_APPLY).
void lookBorders(inout LookSurface s, vec2 lampPx) {
  if (lookBorderStrength <= 0.0 || lookDebug != 0) return;
  vec2 ll = vec2(0.0);
  float degPx = 1.0;
  if (max(lookBorderA.x, lookBorderB.x) > 1.5) {
    vec3 dir = lookDirAt(vLookSt);
    ll = lookLonLat(dir);
    degPx = max(degrees(max(length(dFdx(dir)), length(dFdy(dir)))), 1e-7);
  }
  vec2 a = lookBorderMix < 1.0 ? lookBorderCut(lookBorderA, ll, degPx, lampPx) : vec2(0.0);
  vec2 b = lookBorderMix > 0.0 ? lookBorderCut(lookBorderB, ll, degPx, lampPx) : vec2(0.0);
  vec2 cut = mix(a, b, lookBorderMix) * s.ground * lookBorderStrength;
  // The cut through the patina is polished metal, whose light the look caps (s.cut); its shadow
  // darkens the metal beside it and leaves it rougher.
  s.cut = cut.y;
  s.albedo = mix(s.albedo, lookBorderEtched, cut.y);
  s.roughness = mix(s.roughness, lookBorderEtchedLook.x, cut.y);
  s.metalness = mix(s.metalness, 1.0, cut.y);
  float shadow = min(cut.x * lookBorderEtchedLook.y, 0.95);
  s.albedo *= 1.0 - shadow;
  s.roughness = min(1.0, s.roughness + ${f(BORDER_LOOK.roughenPerShade)} * shadow);
}
`;

/**
 * STEPS: after the climate's wash, before the ash hook lays its dust over the land, with the key
 * lamp's direction on screen at the fragment for the cuts' shadows: the lamp's direction along the
 * surface, as the view projects it there; up and to the left where the scene has no spot light.
 */
export const STEPS_FRAGMENT_APPLY = /* glsl */ `
  {
    vec2 lookLampPx = vec2(-0.6, 0.8);
#if NUM_SPOT_LIGHTS > 0
    if (lookBorderStrength > 0.0) {
      vec3 lookLampAt = -vViewPosition;
      vec3 lookLampL = normalize(spotLights[0].position - lookLampAt);
      vec3 lookLampN = normalize(cross(vLookTs, vLookTt));
      if (dot(lookLampN, vViewPosition) < 0.0) lookLampN = -lookLampN;
      vec3 lookLampT = lookLampL - lookLampN * dot(lookLampL, lookLampN);
      vec2 lookLampS = vec2(
        lookLampT.x * -lookLampAt.z + lookLampAt.x * lookLampT.z,
        lookLampT.y * -lookLampAt.z + lookLampAt.y * lookLampT.z
      );
      if (dot(lookLampS, lookLampS) > 1e-12) lookLampPx = normalize(lookLampS);
    }
#endif
    lookBorders(lookS, lookLampPx);
  }
`;
