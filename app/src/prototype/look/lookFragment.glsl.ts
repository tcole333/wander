// The spike's surface bake (docs/reference/spike/src/surface.js, bakeSurface), per fragment: the
// albedo, roughness, metalness and stylized relief it baked per texel, computed here from the
// surface pools. The relief is evaluated at the fragment and four taps around it, and its
// gradient perturbs the normal, as the spike's normal map did.
import { glslFaceTable, SURFACE_LEVELS } from '../../globe/surfaceVertex.glsl';

/** Global declarations and functions, after three's `#include <common>` in the fragment. */
export const LOOK_FRAGMENT_PARS = /* glsl */ `
uniform highp sampler2DArray wanderHeight;
uniform highp sampler2DArray wanderShore;
uniform float wanderQLand[${SURFACE_LEVELS}];
uniform float wanderC200[${SURFACE_LEVELS}];

uniform vec3 lookBronze;
uniform vec3 lookPatina;
uniform vec3 lookBrassHi;
uniform vec3 lookShallow;
uniform vec3 lookDeep;
uniform vec3 lookShelf;
uniform vec3 lookInlay;
uniform vec3 lookRiver;
uniform float lookNormalStrength;
uniform float lookNormalZoom;
uniform float lookMaxSlope;
uniform float lookRelief;
uniform float lookHeightBlur;
uniform float lookBevelPx;
uniform float lookBroadWeight;
uniform float lookBroadDeg;
uniform float lookCoastPx;
uniform float lookRiverPx;
uniform float lookGraticule;
uniform float lookNoise;
uniform float lookPolish;
// The camera in the globe frame, set before each draw.
uniform vec3 lookCamLocal;
uniform int lookDebug;

flat in int vLookSlot;
flat in int vLookSrc;
flat in int vLookFace;
flat in float vLookMid;
in vec2 vLookUv;
in vec2 vLookSt;
in vec3 vLookDir;
in float vLookH;
in vec3 vLookTs;
in vec3 vLookTt;
in vec3 vLookPos;

${glslFaceTable()}

#define LOOK_QUARTER_PI 0.7853981633974483
// An L1 texel in degrees of arc at a face center: 90 degrees over 512 texels.
#define LOOK_L1_TEXEL_DEG 0.17578125
#define LOOK_TEXELS 264.0
// The degrees of arc per pixel at which the spike's global bake was tuned (its region view).
#define LOOK_REF_DEG_PX 0.13

// Codes to meters, as the vertex chunk converts them.
float lookMeters(float code, int lv) {
  float q = wanderQLand[lv];
  float c2 = wanderC200[lv];
  return (code >= c2 ? code : c2 + 4.0 * (code - c2)) * q;
}

vec3 lookDirAt(vec2 st) {
  vec3 q = WANDER_FACE[vLookFace] * vec3(tan(LOOK_QUARTER_PI * st.x), tan(LOOK_QUARTER_PI * st.y), 1.0);
  return normalize(q);
}

// Longitude and latitude in degrees of a globe-frame direction in three.js axes (north +Y, 0E +Z).
vec2 lookLonLat(vec3 d) {
  return degrees(vec2(atan(d.x, d.z), asin(clamp(d.y, -1.0, 1.0))));
}

// The cubic B-spline's four weights at fraction v.
vec4 lookCubic(float v) {
  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
  vec4 s = n * n * n;
  float x = s.x;
  float y = s.y - 4.0 * s.x;
  float z = s.z - 4.0 * s.y + 6.0 * s.x;
  return vec4(x, y, z, 6.0 - x - y - z) * (1.0 / 6.0);
}

// The shore byte at mip 0, B-spline filtered from four bilinear taps: smooth in value and slope,
// so relief made from a magnified field shades without bilinear interpolation's facets.
float lookShoreSmooth(vec2 uv, float slot) {
  vec2 t = uv * LOOK_TEXELS - 0.5;
  vec2 f = fract(t);
  t -= f;
  vec4 xc = lookCubic(f.x);
  vec4 yc = lookCubic(f.y);
  vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
  vec4 o = (t.xxyy + vec2(-0.5, 1.5).xyxy + vec4(xc.yw, yc.yw) / s) / LOOK_TEXELS;
  float s0 = textureLod(wanderShore, vec3(o.xz, slot), 0.0).r;
  float s1 = textureLod(wanderShore, vec3(o.yz, slot), 0.0).r;
  float s2 = textureLod(wanderShore, vec3(o.xw, slot), 0.0).r;
  float s3 = textureLod(wanderShore, vec3(o.yw, slot), 0.0).r;
  float sx = s.x / (s.x + s.y);
  float sy = s.z / (s.z + s.w);
  return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy) * 255.0;
}

// The same B-spline from the 4x4 texels themselves, weighted in float: exact at any magnification,
// where the hardware's bilinear taps above step in 1/256 of a texel, which close up shades the
// broad bevel in a grid of small squares.
float lookShoreExact(vec2 uv, int slot) {
  vec2 t = uv * LOOK_TEXELS - 0.5;
  vec2 f = fract(t);
  ivec2 b = ivec2(t - f) - 1;
  vec4 xc = lookCubic(f.x);
  vec4 yc = lookCubic(f.y);
  float sum = 0.0;
  for (int j = 0; j < 4; j++) {
    vec4 row = vec4(
      texelFetch(wanderShore, ivec3(b + ivec2(0, j), slot), 0).r,
      texelFetch(wanderShore, ivec3(b + ivec2(1, j), slot), 0).r,
      texelFetch(wanderShore, ivec3(b + ivec2(2, j), slot), 0).r,
      texelFetch(wanderShore, ivec3(b + ivec2(3, j), slot), 0).r
    );
    sum += yc[j] * dot(xc, row);
  }
  return sum * 255.0;
}

// The spike's integer hash.
float lookHash(int x, int y) {
  uint h = (uint(x) * 374761393u) ^ (uint(y) * 668265263u);
  h = (h ^ (h >> 13u)) * 1274126177u;
  return float(h ^ (h >> 16u)) * (1.0 / 4294967295.0);
}

// Gradient noise and its gradient in lattice units, (n, dn/dx, dn/dy), with the lattice wrapped in
// x every period cells. n spreads as the spike's value noise less 0.5 did, but its slope is not
// zero along the lattice lines, where value noise's is: that showed the lattice as a grid of
// squares in the shading.
vec3 lookGradientNoise(vec2 p, int period) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  int x0 = int(i.x) % period;
  int x1 = (x0 + 1) % period;
  int y0 = int(i.y);
  float a0 = 6.283185307179586 * lookHash(x0, y0);
  float a1 = 6.283185307179586 * lookHash(x1, y0);
  float a2 = 6.283185307179586 * lookHash(x0, y0 + 1);
  float a3 = 6.283185307179586 * lookHash(x1, y0 + 1);
  vec2 ga = vec2(cos(a0), sin(a0));
  vec2 gb = vec2(cos(a1), sin(a1));
  vec2 gc = vec2(cos(a2), sin(a2));
  vec2 gd = vec2(cos(a3), sin(a3));
  float va = dot(ga, f);
  float vb = dot(gb, f - vec2(1.0, 0.0));
  float vc = dot(gc, f - vec2(0.0, 1.0));
  float vd = dot(gd, f - vec2(1.0, 1.0));
  float k = va - vb - vc + vd;
  float n = va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * k;
  vec2 g = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd) +
    du * (u.yx * k + vec2(vb - va, vc - va));
  return vec3(n, g);
}

// The spike's octaves, in cycles per degree; 360 f cells wrap around the globe.
const float LOOK_OCTAVES[5] = float[5](0.35, 1.3, 4.5, 14.0, 42.0);
const int LOOK_PERIODS[5] = int[5](126, 468, 1620, 5040, 15120);

struct LookNoise {
  float mottle;
  float fine;
  // d fine / d(lon, lat), per degree.
  vec2 fineGrad;
};

// The spike's noise at lon/lat, each octave fading out as its cells near 4 pixels (gradient
// noise's bumps are half a cell), so it never shimmers. As in the spike, mottle sums the two lowest
// octaves and fine is the highest one shown; fine's gradient comes with it, for the relief's
// normal.
LookNoise lookNoiseAt(vec2 lonlat, float degPx) {
  LookNoise o;
  o.mottle = 0.0;
  vec3 fine = vec3(0.5, 0.0, 0.0);
  float lonPx = degPx / max(cos(radians(lonlat.y)), 0.05);
  float footprint = max(lonPx, 1.1 * degPx);
  for (int k = 0; k < 5; k++) {
    float f = LOOK_OCTAVES[k];
    float shown = 1.0 - smoothstep(0.1, 0.25, f * footprint);
    if (shown <= 0.0) break;
    vec2 p = vec2((lonlat.x + 180.0) * f + float(k) * 17.3, lonlat.y * f * 1.1 - float(k) * 9.1);
    vec3 n = lookGradientNoise(p, LOOK_PERIODS[k]);
    if (k < 2) {
      o.mottle += n.x * (k == 0 ? 0.7 : 0.45) * shown;
    } else {
      float a = min(1.0, 4.5 / f);
      fine = mix(fine, vec3(0.5 + n.x * a, n.yz * a * f * vec2(1.0, 1.1)), shown);
    }
  }
  o.fine = fine.x;
  o.fineGrad = fine.yz;
  return o;
}

// A line widthPx wide at distPx from its center, at least a pixel wide and dimmed when thinner.
float lookLine(float distPx, float widthPx) {
  float halfPx = 0.5 * max(widthPx, 1.0);
  return (1.0 - smoothstep(halfPx - 0.5, halfPx + 0.5, distPx)) * min(widthPx, 1.0);
}

// Where the view ray first crosses sea level (radius 1), as a direction: the sea's inlaid lines
// lie there, as if in a glassy lacquer over the displaced sea floor, so relief never bends them.
// Above sea level, or where the ray only grazes it, the fragment's own direction.
vec3 lookSeaLevelDir() {
  vec3 o = lookCamLocal;
  vec3 d = vLookPos - o;
  float len = length(d);
  d /= len;
  float b = dot(o, d);
  float c = dot(o, o) - 1.0;
  float disc = b * b - c;
  if (c <= 0.0 || disc <= 0.0) return normalize(vLookPos);
  // The near root in its stable form, as the camera may be only kilometers above the sea.
  float t = c / (-b + sqrt(disc));
  if (t <= 0.0 || t > len) return normalize(vLookPos);
  return normalize(o + d * t);
}

// The spike's graticule: every 15 degrees, 0.07 degrees wide, the equator 0.13; parallels to 75.
// Close up the lines stop widening at 2 px (the equator 3.5), as engraved lines do on screen.
float lookGraticuleAt(vec2 lonlat, float degPx) {
  float cosLat = cos(radians(lonlat.y));
  float dLon = abs(fract(lonlat.x / 15.0 + 0.5) - 0.5) * 15.0 * cosLat;
  float meridian = lookLine(dLon / degPx, min(0.07 / degPx, 2.0));
  float k = floor(lonlat.y / 15.0 + 0.5);
  float dLat = abs(lonlat.y - 15.0 * k);
  float widthPx = k == 0.0 ? min(0.13 / degPx, 3.5) : min(0.07 / degPx, 2.0);
  float parallel = abs(k) <= 5.0 ? lookLine(dLat / degPx, widthPx) : 0.0;
  return max(meridian, parallel);
}

// floor(depth / 1000) up to 10: the spike's depth terraces, a step at each 1000 m with edges
// widthM wide (under 500 m).
float lookTerraces(float depth, float widthM) {
  float k = clamp(floor(depth / 1000.0 + 0.5), 1.0, 10.0);
  return k - 1.0 + smoothstep(k * 1000.0 - widthM, k * 1000.0 + widthM, depth);
}

// What the look reads at one point, and the footprint it reads it at.
struct LookFields {
  // Height in meters, smoothed by heightBlur mips.
  float h;
  // The shore and water distances in source texels, land and water inside positive and negative.
  float d;
  float w;
  // The L1 ancestor's shore distance in L1 texels, B-spline smooth.
  float d1;
  vec2 lonlat;
};

struct LookFootprint {
  // Source texels, degrees of arc and face units (s, t) per pixel.
  float texPx;
  float degPx;
  float stPx;
  // Terrace and band edges' half-width in meters: a pixel, and at least a meter.
  float bandW;
};

// exactL1: the L1 field is magnified past 32 pixels a texel, so it is filtered exactly.
LookFields lookFields(vec2 uv, vec2 st, bool exactL1) {
  LookFields f;
  vec3 at = vec3(uv, float(vLookSlot));
  f.h = lookMeters(texture(wanderHeight, at, lookHeightBlur).r + vLookMid, vLookSrc);
  vec2 sw = texture(wanderShore, at).rg * 255.0;
  f.d = (sw.r - 128.0) / 16.0;
  f.w = (sw.g - 128.0) / 16.0;
  // L1 tiles sit in the fixed slots 6 + 4 face + 2 y + x.
  ivec2 t1 = clamp(ivec2(floor(st + 1.0)), 0, 1);
  vec2 uv1 = (4.0 + (st + 1.0 - vec2(t1)) * 256.0) / LOOK_TEXELS;
  int slot1 = 6 + 4 * vLookFace + 2 * t1.y + t1.x;
  float shore1 = exactL1 ? lookShoreExact(uv1, slot1) : lookShoreSmooth(uv1, float(slot1));
  f.d1 = (shore1 - 128.0) / 16.0;
  f.lonlat = lookLonLat(lookDirAt(st));
  return f;
}

// Water coverage, with rivers drawn at least riverPx wide.
float lookWater(float w, float texPx) {
  return 1.0 - smoothstep(0.5 * lookRiverPx - 0.5, 0.5 * lookRiverPx + 0.5, w / texPx);
}

// The spike's blurred land mask. A narrow bevel from the source's shore field, bevelPx wide on
// screen whatever the source level, so it runs on unbroken where the source level changes; and a
// broad one from the L1 ancestor's, broadDeg wide at the spike's global scale and narrowing as
// the view closes, as the spike's close patch did (0.1 degrees against 0.28).
float lookBevel(LookFields f, LookFootprint fp) {
  float s = clamp(lookBevelPx * fp.texPx, 0.75, 4.0);
  float narrow = smoothstep(-s, s, f.d);
  float b = lookBroadDeg * clamp(sqrt(fp.degPx / LOOK_REF_DEG_PX), 0.36, 1.0);
  float broad = smoothstep(-2.0 * b, 2.0 * b, f.d1 * LOOK_L1_TEXEL_DEG);
  return mix(narrow, broad, lookBroadWeight);
}

// The spike's stylized relief, from which its normal map was made, less its fine noise: on land
// that term joins the gradient analytically, at 0.035 where the spike had 0.06, as gradient
// noise's slopes are 1.6 times value noise's. At sea the spike's 0.025 is left out, and the
// mottle stays in the albedo.
float lookReliefAt(LookFields f, LookFootprint fp) {
  float bevel = lookBevel(f, fp);
  float land = clamp(0.5 + f.d / fp.texPx, 0.0, 1.0);
  float r = pow(max(f.h, 0.0) / 6500.0, 0.55);
  float water = lookWater(f.w, fp.texPx);
  float lake = smoothstep(0.5, 2.5, -f.w);
  float onLand = bevel + r * 1.35 * lookRelief - water * 0.12;
  onLand -= lake * 0.8 * bevel;
  float depth = max(-f.h, 0.0);
  // Magnified, each step would spread over the taps as a soft ridge: it fades out instead.
  float terraces = lookTerraces(depth, fp.bandW) * smoothstep(0.2, 1.0, fp.texPx);
  float atSea = bevel - terraces * 0.022 * lookRelief;
  return mix(atSea, onLand, land);
}

// A longitude difference in (-180, 180], across the antimeridian too.
float lookLonDelta(float a, float b) {
  return mod(a - b + 180.0, 360.0) - 180.0;
}

struct LookSurface {
  vec3 albedo;
  float roughness;
  float metalness;
  // The relief's gradient per unit s and t, and the normal's zoom factor.
  vec2 dh;
  float zoom;
  // 1 on land, 0 at sea and on lakes.
  float land;
};

LookSurface lookSurface() {
  LookSurface o;
  LookFootprint fp;
  fp.stPx = max(length(dFdx(vLookSt)), length(dFdy(vLookSt)));
  float perSt = 128.0 * exp2(float(vLookSrc));
  fp.texPx = max(fp.stPx * perSt, 1e-4);
  fp.degPx = max(degrees(max(length(dFdx(vLookDir)), length(dFdy(vLookDir)))), 1e-7);

  // An L1 tile spans one unit of s and t in 256 texels.
  bool exactL1 = fp.stPx * 256.0 < 1.0 / 32.0;
  LookFields c = lookFields(vLookUv, vLookSt, exactL1);
  fp.bandW = clamp(fwidth(c.h), 1.0, 400.0);
  LookNoise nz = lookNoiseAt(c.lonlat, fp.degPx);
  float mottle = nz.mottle * lookNoise;
  float fine = 0.5 + (nz.fine - 0.5) * lookNoise;
  float land = clamp(0.5 + c.d / fp.texPx, 0.0, 1.0);

  // Four taps a pixel or at least 2 texels away (within the tile's 4-texel border): the relief's
  // central differences, plus the fine noise's own gradient carried from lon/lat to s and t by the
  // taps' lon/lat. Nearer taps turn each texel's small ridges into glints.
  float delta = max(2.0, fp.texPx);
  vec2 du = vec2(delta / LOOK_TEXELS, 0.0);
  vec2 ds = vec2(delta / perSt, 0.0);
  LookFields e = lookFields(vLookUv + du.xy, vLookSt + ds.xy, exactL1);
  LookFields w = lookFields(vLookUv - du.xy, vLookSt - ds.xy, exactL1);
  LookFields n = lookFields(vLookUv + du.yx, vLookSt + ds.yx, exactL1);
  LookFields s = lookFields(vLookUv - du.yx, vLookSt - ds.yx, exactL1);
  vec2 dh = vec2(lookReliefAt(e, fp) - lookReliefAt(w, fp), lookReliefAt(n, fp) - lookReliefAt(s, fp));
  vec2 dLonLatS = vec2(lookLonDelta(e.lonlat.x, w.lonlat.x), e.lonlat.y - w.lonlat.y);
  vec2 dLonLatT = vec2(lookLonDelta(n.lonlat.x, s.lonlat.x), n.lonlat.y - s.lonlat.y);
  float noiseRelief = 0.035 * land * lookNoise;
  dh += noiseRelief * vec2(dot(nz.fineGrad, dLonLatS), dot(nz.fineGrad, dLonLatT));
  o.dh = dh / (2.0 * ds.x);
  // The spike baked its close patch with normals at 0.45 of the globe's: relief softens as the
  // view closes.
  o.zoom = clamp(pow(fp.degPx / LOOK_REF_DEG_PX, lookNormalZoom), 0.15, 1.0);

  float coast = lookLine(abs(c.d) / fp.texPx, lookCoastPx);
  float water = lookWater(c.w, fp.texPx);
  float lake = smoothstep(0.5, 2.5, -c.w);

  // Land: patina, bronze and worn brass highs.
  float r = pow(max(c.h, 0.0) / 6500.0, 0.55);
  float worn = clamp(0.25 + r * 0.9 + mottle * 0.35 + (fine - 0.5) * 0.25, 0.0, 1.0);
  float t1 = smoothstep(0.0, 0.55, worn);
  float t2 = smoothstep(0.55, 1.0, worn);
  // The high ground's polish is the world view's, and wears off as the view closes: there fine
  // relief on polished brass glitters, and a cone's flanks turn from the lamp so it reads as a pit.
  // lookPolish tames broad highs such as Tibet, which otherwise mirror the lamp as one hotspot.
  float polish = o.zoom * o.zoom * lookPolish;
  vec3 landColor = mix(mix(lookPatina, lookBronze, t1), lookBrassHi, t2 * mix(0.45, 0.75, polish));
  landColor = mix(landColor, lookRiver, 0.55 * water) * (1.0 - 0.35 * coast);
  float landRough = 0.7 - (0.24 * t1 + 0.1 * t2) * polish + (fine - 0.5) * 0.14 + water * 0.2;
  float landMetal = 0.75 + 0.25 * t1;

  // Sea: lacquer by depth, the shelf, mottle, and brass inlay. The depth is continuous, not the
  // spike's bands, and the shelf and mottle are gentler than its: close up, bands and blotches
  // read as flat khaki patches, where the lacquer should read as one surface.
  float depth = max(-c.h, 0.0);
  float coastal = clamp(0.5 + c.d1 * LOOK_L1_TEXEL_DEG / 3.2, 0.0, 1.0);
  float shelf = (1.0 - smoothstep(200.0 - fp.bandW, 200.0 + fp.bandW, depth)) * (1.0 - coastal * 0.2);
  float mottleScale = clamp(1.0 + mottle * 1.4 + (fine - 0.5) * 0.35, 0.7, 1.3);
  vec3 seaColor = mix(lookShallow, lookDeep, sqrt(min(1.0, depth / 6000.0)));
  seaColor = mix(seaColor, lookShelf, shelf * 0.22) * mottleScale;
  vec3 gratDir = lookSeaLevelDir();
  float gratDegPx = max(degrees(max(length(dFdx(gratDir)), length(dFdy(gratDir)))), 1e-7);
  float grat = lookGraticule * lookGraticuleAt(lookLonLat(gratDir), gratDegPx);
  float inlay = max(grat * 0.5, coast * 0.55);
  seaColor = mix(seaColor, lookInlay, inlay);
  // Rougher than the spike's 0.62: at low tilts the lamp's reflection lies mid-screen, and a
  // narrower lobe spreads over the sea as a pale sheen.
  float seaRough = 0.75 + mottle * 0.3 + (fine - 0.5) * 0.18 - inlay * 0.2;
  float seaMetal = 0.08 + inlay * 0.85;

  // Lakes take the shelf's lacquer.
  vec3 lakeColor = mix(lookShallow, lookShelf, 0.55) * mottleScale;
  landColor = mix(landColor, lakeColor, lake);
  landRough = mix(landRough, 0.75 + mottle * 0.3, lake);
  landMetal = mix(landMetal, 0.08, lake);

  o.land = land * (1.0 - lake);
  o.albedo = max(mix(seaColor, landColor, land), 0.0);
  o.roughness = clamp(mix(seaRough, landRough, land), 0.05, 1.0);
  o.metalness = clamp(mix(seaMetal, landMetal, land), 0.0, 1.0);

  if (lookDebug == 1) {
    // Height: the fragment's in gray, red where it and the vertex's differ by more than 100 m.
    float g = clamp(0.5 + c.h / 12000.0, 0.0, 1.0);
    o.albedo = abs(c.h - vLookH) > 100.0 ? vec3(1.0, 0.0, 0.0) : vec3(g);
  } else if (lookDebug == 2) {
    // The shore, water and L1 shore fields in red, green and blue.
    o.albedo = vec3(clamp(0.5 + c.d / 16.0, 0.0, 1.0), clamp(0.5 - c.w / 16.0, 0.0, 1.0),
      clamp(0.5 + c.d1 / 16.0, 0.0, 1.0));
  } else if (lookDebug == 4) {
    // The source level: L7 red, L6 green, L5 blue, L4 yellow, coarser gray.
    int s = vLookSrc;
    o.albedo = s == 7 ? vec3(0.8, 0.1, 0.1) : s == 6 ? vec3(0.1, 0.7, 0.1) : s == 5 ?
      vec3(0.1, 0.2, 0.9) : s == 4 ? vec3(0.8, 0.7, 0.1) : vec3(0.4);
  }
  return o;
}

// The relief's gradient turned into a normal: the surface gradient from the view-space tangents,
// per degree as the spike's normal map measured it, softly capped at maxSlope.
vec3 lookPerturb(vec3 n, LookSurface s) {
  vec3 c1 = cross(vLookTt, n);
  vec3 c2 = cross(n, vLookTs);
  float det = dot(vLookTs, c1);
  if (abs(det) < 1e-12) return n;
  vec3 grad = (s.dh.x * c1 + s.dh.y * c2) / det;
  vec3 g = grad * (0.9 * lookNormalStrength * s.zoom * 0.017453292519943295);
  float m = length(g) / lookMaxSlope;
  vec3 p = normalize(n - g / sqrt(1.0 + m * m));
  // Steeply tilted, relief can turn the normal from the camera, which three lights black: keep it
  // facing the viewer (vViewPosition is three's, from the fragment toward the camera).
  vec3 v = normalize(vViewPosition);
  float nv = dot(p, v);
  return nv < 0.1 ? normalize(p + v * (0.1 - nv)) : p;
}
`;

/** Replaces three's `#include <color_fragment>`: the look, computed once. */
export const LOOK_FRAGMENT_COLOR = /* glsl */ `
  LookSurface lookS = lookSurface();
  diffuseColor.rgb = lookS.albedo;
`;

export const LOOK_FRAGMENT_ROUGHNESS = /* glsl */ `
  float roughnessFactor = lookS.roughness;
`;

export const LOOK_FRAGMENT_METALNESS = /* glsl */ `
  float metalnessFactor = lookS.metalness;
`;

/**
 * After three's `#include <lights_fragment_end>`: the sea's lacquer reflects the lamp less in
 * regional and close views, where its broad lobe lies mid-screen and veils the sea in warm grey;
 * the world view keeps the spike's.
 */
export const LOOK_FRAGMENT_SPECULAR = /* glsl */ `
  float lookSeaSpec = mix(mix(0.3, 1.0, smoothstep(0.45, 1.0, lookS.zoom)), 1.0, lookS.land);
  reflectedLight.directSpecular *= lookSeaSpec;
  reflectedLight.indirectSpecular *= lookSeaSpec;
`;

/** Replaces three's `#include <normal_fragment_maps>`, after `normal` is set. */
export const LOOK_FRAGMENT_NORMAL = /* glsl */ `
  normal = lookPerturb(normal, lookS);
  if (lookDebug == 3) diffuseColor.rgb = normal * 0.5 + 0.5;
`;
