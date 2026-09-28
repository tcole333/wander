// The look's borders hook (streaming.md 3.3): the 1815 borders as a fine groove engraved in the
// land, darkened like the coast's and a touch rougher, a constant width on screen. Lakes count as
// land, so a border runs on across them, and each ends where the look draws the coast; at sea the
// field's borders run on unseen. The field is one R8 array of six faces, allocated with the look
// and filled a face at a time as its file arrives (story/effects/borders.ts), and read at the face
// coordinates the look already has. With its strength at 0, the default, the look is unchanged; the
// walk compiles it at 0 before it starts.
import { DataArrayTexture, NearestFilter, RedFormat, UnsignedByteType, type Material } from 'three';
import { BORDER_APRON, BORDER_FACES, BORDER_TEXELS } from '../data/borders';

/** How the groove is cut. */
export const BORDER_LOOK = {
  /** Its width in pixels, whatever the zoom: a little finer than the coast's line. */
  widthPx: 1.5,
  /** How much it darkens the metal, and how much rougher it leaves it. */
  darken: 0.6,
  roughen: 0.2,
} as const;

export interface BorderUniforms {
  /** 0 leaves the look as it is. */
  lookBorderStrength: { value: number };
  /** Six faces of signed distances in texels, each min(255, rha(128 + 16·clamp(d, −8, 8))). */
  lookBorderField: { value: DataArrayTexture };
}

/**
 * The uniforms, with the field allocated on the GPU at its first draw but not filled: its bytes
 * are 0, as far from any border as a field reaches, until faces arrive.
 */
export function createBorderUniforms(): BorderUniforms {
  const field = new DataArrayTexture(
    new Uint8Array(BORDER_FACES * BORDER_TEXELS * BORDER_TEXELS),
    BORDER_TEXELS,
    BORDER_TEXELS,
    BORDER_FACES,
  );
  field.format = RedFormat;
  field.type = UnsignedByteType;
  field.minFilter = field.magFilter = NearestFilter;
  field.generateMipmaps = false;
  field.unpackAlignment = 1;
  field.source.dataReady = false;
  field.needsUpdate = true;
  return { lookBorderStrength: { value: 0 }, lookBorderField: { value: field } };
}

/** Uploads one face of the field, whose bytes are in place, at the next draw. */
export function uploadBorderFace(uniforms: BorderUniforms, face: number): void {
  const field = uniforms.lookBorderField.value;
  field.source.dataReady = true;
  field.addLayerUpdate(face);
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
  float groove = lookLine(abs(d) / texPx, ${f(BORDER_LOOK.widthPx)}) * s.ground * lookBorderStrength;
  s.albedo *= 1.0 - ${f(BORDER_LOOK.darken)} * groove;
  s.roughness = min(1.0, s.roughness + ${f(BORDER_LOOK.roughen)} * groove);
}
`;

/** After the climate's wash, before the ash hook lays its dust over the land. */
export const BORDERS_FRAGMENT_APPLY = /* glsl */ `
  lookBorders(lookS);
`;
