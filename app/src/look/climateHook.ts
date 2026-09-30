// The look's climate hook (streaming.md 3.5): ModE-RA's temperature anomaly for one month, a
// 192 x 96 field on the source's grid that the walk's effects fill (story/effects/climate.ts), as a
// frost and verdigris wash on the metal. Cold lands take a blue-green patina that tints the metal
// rather than covering it, so its wear, rivers and coast still show, and lose some of their
// polish; warm lands blush a rosy copper; the sea's lacquer takes a third of either. The palette
// saturates at the look's climateRangeK either side of the 1901-2000 average, and the field is
// sampled with a B-spline, so its 1.9-degree cells never show. With its strength at 0, the
// default, the look is unchanged; the walk compiles it at 0 before it starts. Where the look cuts
// marks, each keeps its family's material: the wash lies on the casting around a mark, not on the
// mark (globe-language.md, principle 4: nature's channel never takes another pace layer's).
import {
  ClampToEdgeWrapping,
  DataTexture,
  HalfFloatType,
  LinearFilter,
  RepeatWrapping,
  RGFormat,
  Vector4,
  type Material,
} from 'three';
import { KEY_LAMP_CSS } from '../scene/lens';

/** The source's grid, which the field matches: 192 columns of 1.875 degrees, 96 Gaussian rows. */
export const CLIMATE_GRID = { nlon: 192, nlat: 96 } as const;

/** The wash's colors and how far each pulls the metal at full saturation. */
export const CLIMATE_LOOK = {
  /**
   * Verdigris, blue enough that the warm lamp leaves it blue-green rather than khaki, which would
   * read as the ash beat's dust.
   */
  frost: '#5fb3c4',
  frostMix: 0.85,
  /**
   * The metal's linear luminance at which the frost takes its own color: brighter metal takes a
   * brighter frost and darker a darker (within 0.3 and 1.7 of it), so the frost keeps the metal's
   * engraving and the dark sea stays lacquer.
   */
  frostLuminance: 0.16,
  /** A rosy copper toward garnet, which the warm lamp cannot turn into the metal's own orange. */
  copper: '#9a4f5a',
  copperMix: 0.65,
  /** The sea's share of the land's wash. */
  seaShare: 1 / 3,
  /** Where full cold takes the metal's roughness and metalness. */
  coldRoughness: 0.72,
  coldMetalness: 0.55,
} as const;

export interface ClimateUniforms {
  /** 0 leaves the look as it is. */
  lookClimateStrength: { value: number };
  /** RG16F: the anomaly in K times its coverage, and the coverage (0 where the source has none). */
  lookClimateField: { value: DataTexture };
  /** Column 0's longitude, the column step, row 0's latitude and the row step southward, degrees. */
  lookClimateGrid: { value: Vector4 };
  /** K at which the palette saturates. */
  lookClimateRange: { value: number };
}

export function createClimateUniforms(): ClimateUniforms {
  const { nlon, nlat } = CLIMATE_GRID;
  const field = new DataTexture(
    new Uint16Array(nlon * nlat * 2),
    nlon,
    nlat,
    RGFormat,
    HalfFloatType,
  );
  field.wrapS = RepeatWrapping;
  field.wrapT = ClampToEdgeWrapping;
  field.minFilter = field.magFilter = LinearFilter;
  field.needsUpdate = true;
  return {
    lookClimateStrength: { value: 0 },
    lookClimateField: { value: field },
    lookClimateGrid: { value: new Vector4(-180, 360 / nlon, 88.572169, 1.864677) },
    lookClimateRange: { value: 4 },
  };
}

const registry = new WeakMap<Material, ClimateUniforms>();

export function registerClimate(material: Material, uniforms: ClimateUniforms): void {
  registry.set(material, uniforms);
}

/** The climate uniforms of a surface look's material, if it has the hook. */
export function climateUniformsOf(material: Material): ClimateUniforms | undefined {
  return registry.get(material);
}

/** An sRGB hex color in linear RGB, as three's color management turns a Color uniform. */
export function linearRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
}

function srgbHex([r, g, b]: [number, number, number]): string {
  const enc = (v: number) => {
    const c = Math.min(1, Math.max(0, v));
    const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(s * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${enc(r)}${enc(g)}${enc(b)}`;
}

const mix3 = (a: number[], b: number[], t: number): [number, number, number] => [
  (a[0] ?? 0) + ((b[0] ?? 0) - (a[0] ?? 0)) * t,
  (a[1] ?? 0) + ((b[1] ?? 0) - (a[1] ?? 0)) * t,
  (a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * t,
];

const luminance = ([r, g, b]: number[]) =>
  0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);

/** A linear color under the museum's warm key lamp (scene/lens.ts), at the same luminance. */
function underLamp(rgb: [number, number, number]): [number, number, number] {
  const [lr, lg, lb] = linearRgb(KEY_LAMP_CSS);
  const lit: [number, number, number] = [rgb[0] * lr, rgb[1] * lg, rgb[2] * lb];
  const gain = luminance(rgb) / Math.max(luminance(lit), 1e-6);
  return [lit[0] * gain, lit[1] * gain, lit[2] * gain];
}

/**
 * The color the shader gives land of albedo `base` (sRGB hex) at `k` K, fully shown, as sRGB hex:
 * the legend's ramp, mixed in linear light as the shader mixes it and seen under the key lamp, as
 * the globe is, so the strip and the globe agree.
 */
export function climateSwatch(base: string, k: number, rangeK: number): string {
  const t = Math.min(1, Math.max(-1, k / rangeK));
  const bronze = linearRgb(base);
  if (t >= 0) {
    return srgbHex(
      underLamp(mix3(bronze, linearRgb(CLIMATE_LOOK.copper), CLIMATE_LOOK.copperMix * t)),
    );
  }
  const rel = Math.min(1.7, Math.max(0.3, luminance(bronze) / CLIMATE_LOOK.frostLuminance));
  const frost = linearRgb(CLIMATE_LOOK.frost).map((c) => c * rel);
  return srgbHex(underLamp(mix3(bronze, frost, CLIMATE_LOOK.frostMix * -t)));
}

const f = (x: number) => x.toFixed(6);
const vec3 = (hex: string) => `vec3(${linearRgb(hex).map(f).join(', ')})`;

/**
 * After the look's pars: the uniforms and lookClimate(), which reads lookDirAt and LookSurface, and
 * with `marks`, the marks' cover, which it leaves unwashed.
 */
export const climateFragmentPars = (marks: boolean) => /* glsl */ `
uniform float lookClimateStrength;
uniform sampler2D lookClimateField;
uniform vec4 lookClimateGrid;
uniform float lookClimateRange;

// The field at a longitude and latitude in degrees: (anomaly K · coverage, coverage), B-spline
// smooth from four bilinear taps (as lookShoreSmooth), wrapping around the dateline.
vec2 lookClimateAt(vec2 ll) {
  vec2 size = vec2(textureSize(lookClimateField, 0));
  vec2 t = vec2((ll.x - lookClimateGrid.x) / lookClimateGrid.y, (lookClimateGrid.z - ll.y) / lookClimateGrid.w);
  vec2 fr = fract(t);
  t -= fr;
  vec4 xc = lookCubic(fr.x);
  vec4 yc = lookCubic(fr.y);
  vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
  vec4 o = (t.xxyy + vec2(-0.5, 1.5).xyxy + vec4(xc.yw, yc.yw) / s) / size.xxyy;
  vec2 s0 = textureLod(lookClimateField, o.xz, 0.0).rg;
  vec2 s1 = textureLod(lookClimateField, o.yz, 0.0).rg;
  vec2 s2 = textureLod(lookClimateField, o.xw, 0.0).rg;
  vec2 s3 = textureLod(lookClimateField, o.yw, 0.0).rg;
  float sx = s.x / (s.x + s.y);
  float sy = s.z / (s.z + s.w);
  return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
}

void lookClimate(inout LookSurface s) {
  if (lookClimateStrength <= 0.0 || lookDebug != 0) return;
  vec2 field = lookClimateAt(lookLonLat(lookDirAt(vLookSt)));
  float cover = clamp(field.y, 0.0, 1.0);
  float k = field.x / max(field.y, 1e-3);
  float t = clamp(k / lookClimateRange, -1.0, 1.0);
  float a = lookClimateStrength * cover * mix(${f(CLIMATE_LOOK.seaShare)}, 1.0, s.land);
  ${marks ? 'a *= 1.0 - s.marks.cover;' : ''}
  if (t < 0.0) {
    // Frost and verdigris: a blue-green patina as bright as the metal under it, which dulls its
    // polish.
    float c = -t * a;
    float rel = clamp(dot(s.albedo, vec3(0.2126, 0.7152, 0.0722)) / ${f(CLIMATE_LOOK.frostLuminance)}, 0.3, 1.7);
    s.albedo = mix(s.albedo, ${vec3(CLIMATE_LOOK.frost)} * rel, c * ${f(CLIMATE_LOOK.frostMix)});
    s.roughness = mix(s.roughness, ${f(CLIMATE_LOOK.coldRoughness)}, c * s.land);
    s.metalness = mix(s.metalness, ${f(CLIMATE_LOOK.coldMetalness)}, c * s.land);
  } else {
    // A rosy copper blush.
    s.albedo = mix(s.albedo, ${vec3(CLIMATE_LOOK.copper)}, t * a * ${f(CLIMATE_LOOK.copperMix)});
  }
}
`;

/** After the look's color chunk has computed lookS, before the ash hook lays its dust over it. */
export const CLIMATE_FRAGMENT_APPLY = /* glsl */ `
  lookClimate(lookS);
`;
