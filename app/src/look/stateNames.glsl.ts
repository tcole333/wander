// The state names' part of the surface look (lookFragment.glsl.ts), compiled where the release
// names the state names and the border steps (owner decision 44). The look finds the fragment's
// screen tile from where its sea-level direction stands on screen, as the names layer bins each
// name (stateNames.ts), reads that tile's names from the table the layer packs each frame, and for
// each finds the letter the fragment falls under, by its pen's place along the baseline, and reads
// the letter's signed distance from its glyph's cell on the sea-name atlas (nameGlyphs.ts). The
// letters are cut as polished V-grooves: a pale cream floor, the etched borders' metal, half of it
// lit as a diffuse surface so it holds where the lamp's reflection is not, lifted a little by its
// own light under the cut's cap and the bloom; walls the lamp lights on one side and leaves dark
// on the other; a fine dark rim just outside every stroke; and a calm band about a third of an em
// around the name, where the relief and the grain lie flatter and the ground darker, the more so
// where the climate's wash pales it, so the letters keep their contrast there.
import { NAME_CAP_EM } from './nameLayout';
import { NAME_CELL_EM, NAME_EM, NAME_SPREAD } from './nameGlyphs';

/**
 * The table's width and its rows: the tiles' ranges, four a texel (the first slot times
 * TILE_COUNT_MAX + 1 plus the count); the slots, four a texel, each a name's index; four texels a
 * name; then a texel a letter.
 */
export const NAME_TABLE_WIDTH = 512;
export const NAME_SLOT_ROW = 4;
export const NAME_ROW = 8;
export const NAME_LETTER_ROW = 9;
export const NAME_TABLE_ROWS = 21;
export const NAME_TEXELS = 4;
export const NAME_TILES_MAX = NAME_SLOT_ROW * NAME_TABLE_WIDTH * 4;
export const NAME_SLOTS_MAX = (NAME_ROW - NAME_SLOT_ROW) * NAME_TABLE_WIDTH * 4;
export const NAMES_MAX = ((NAME_LETTER_ROW - NAME_ROW) * NAME_TABLE_WIDTH) / NAME_TEXELS;
export const NAME_LETTERS_MAX = (NAME_TABLE_ROWS - NAME_LETTER_ROW) * NAME_TABLE_WIDTH;
/** The most names a tile's range can count: tunables.nameTileCap stays within it. */
export const NAME_TILE_COUNT_MAX = 15;

/**
 * The material (owner decision 44, the legibility test's option 2): the calm band's reach beyond
 * the letters, ems, and its least reach about the capitals' box, CSS px, for small names; how much
 * it flattens the relief and darkens the ground, and how much more it darkens ground the climate's
 * wash pales, by the wash's share; the walls' slope, rise over run;
 * the rim's reach outside a stroke, CSS px, and how much it darkens; the floor's roughness and
 * metalness, and its lift, a share of its own color emitted.
 */
export const NAME_LOOK = {
  band: 0.33,
  bandPx: 3,
  flatten: 0.85,
  darken: 0.25,
  pale: 0.6,
  wall: 0.8,
  rimPx: 1.25,
  rimShade: 0.6,
  roughness: 0.45,
  metalness: 0.5,
  lift: 0.16,
} as const;

const f = (x: number) => (Number.isInteger(x) ? `${x}.0` : String(x));

/** After the look's pars and the borders' (lookBorderEtched): the uniforms and lookStateNames(). */
export const NAMES_FRAGMENT_PARS = /* glsl */ `
#define LOOK_NAME_TILE_CAP ${NAME_TILE_COUNT_MAX}
#define LOOK_NAME_EM ${f(NAME_EM)}
#define LOOK_NAME_SPREAD ${f(NAME_SPREAD)}
#define LOOK_NAME_CAP ${f(NAME_CAP_EM)}
#define LOOK_NAME_BAND ${f(NAME_LOOK.band)}
uniform bool lookNamesOn;
uniform highp sampler2D lookNameTable;
// The globe frame to clip space for this draw.
uniform mat4 lookNameClip;
// The viewport's width and height in CSS px, a tile's side in CSS px, and the tiles across.
uniform vec4 lookNameGrid;
// Device px a CSS px; and 1 draws the letters' floor flat magenta, for measuring their contrast.
uniform float lookNamePixelRatio;
uniform float lookNameMask;
// What the names leave for the normal and the light: the walls' tilt of the normal in view space,
// the floor's lift, and the letters' cover.
vec3 lookNameTilt = vec3(0.0);
vec3 lookNameGlow = vec3(0.0);
float lookNameInk = 0.0;

vec4 lookNameTexel(int i) {
  return texelFetch(lookNameTable, ivec2(i & ${NAME_TABLE_WIDTH - 1}, i >> ${Math.log2(NAME_TABLE_WIDTH)}), 0);
}

// A letter's signed distance at glyph point g (ems from its pen, y up), texels, positive inside:
// from its glyph's cell, whose pen origin stands at o (atlas texels), read with the footprint gx,
// gy (atlas uv per pixel). Outside the cell, far outside.
float lookNameField(vec2 o, vec2 g, vec2 atlas, vec2 gx, vec2 gy) {
  vec2 m = vec2(${f(NAME_SPREAD / NAME_EM)});
  if (any(lessThan(g, -vec2(${f(NAME_CELL_EM.left)}, ${f(NAME_CELL_EM.down)}) - m)) ||
      any(greaterThan(g, vec2(${f(NAME_CELL_EM.right)}, ${f(NAME_CELL_EM.up)}) + m))) {
    return -LOOK_NAME_SPREAD;
  }
  vec2 uv = (o + vec2(g.x, -g.y) * LOOK_NAME_EM) / atlas;
  return (textureGrad(lookSeaAtlas, uv, gx, gy).r * 255.0 - 128.0) * (LOOK_NAME_SPREAD / 127.0);
}

// One letter at glyph point g, cut: its cover; its rim outside its strokes, fading out over rimPx;
// its halo, the calm band's share, all of it out to half haloReach from a stroke and none past it;
// and the walls' slope on screen (rise per pixel toward the groove's middle, window
// axes), steepest at the edge and gone a pixel and a half or 0.07 em either side, whichever is
// more, as the cut's walls and its lip take the lamp. ax and ay: ems per pixel along the window's
// x and y.
struct LookNameCut {
  float cover;
  float rim;
  float halo;
  vec2 slope;
};

LookNameCut lookNameLetter(vec4 letter, vec2 g, vec2 atlas, vec2 ax, vec2 ay, float rimPx,
    float haloReach) {
  LookNameCut o;
  vec2 gx = vec2(ax.x, -ax.y) * (LOOK_NAME_EM / atlas);
  vec2 gy = vec2(ay.x, -ay.y) * (LOOK_NAME_EM / atlas);
  float d = lookNameField(letter.yz, g, atlas, gx, gy) / LOOK_NAME_EM;
  o.halo = 1.0 - smoothstep(0.5 * haloReach, haloReach, -d);
  float perPx = max(max(length(ax), length(ay)), 1e-6);
  float wallW = max(0.07, 1.5 * perPx);
  // Away from an edge, the field's sign: a gradient from two more taps only where it is needed.
  if (abs(d) > max((2.0 + rimPx) * perPx, wallW) + 0.02) {
    o.cover = step(0.0, d);
    o.rim = 0.0;
    o.slope = vec2(0.0);
    return o;
  }
  float h = max(1.0 / LOOK_NAME_EM, perPx);
  float du = lookNameField(letter.yz, g + vec2(h, 0.0), atlas, gx, gy) / LOOK_NAME_EM - d;
  float dv = lookNameField(letter.yz, g + vec2(0.0, h), atlas, gx, gy) / LOOK_NAME_EM - d;
  vec2 n = vec2(du, dv);
  float len = length(n);
  n = len > 1e-9 ? n / len : vec2(0.0);
  float across = max(length(vec2(dot(n, ax), dot(n, ay))), 1e-6);
  float dPx = d / across;
  o.cover = smoothstep(-0.5, 0.5, dPx);
  o.rim = (1.0 - smoothstep(0.3, rimPx + 0.3, -dPx)) * (1.0 - o.cover);
  float wall = max(0.0, 1.0 - abs(d) / wallW);
  o.slope = vec2(dot(n, ax), dot(n, ay)) / across * wall;
  return o;
}

// Cuts the names of the fragment's tile into the surface.
void lookStateNames(inout LookSurface s) {
  if (!lookNamesOn || lookDebug != 0) return;
  vec3 p = lookDirAt(vLookSt);
  vec3 px = dFdx(p);
  vec3 py = dFdy(p);
  // The surface's directions on screen, in view space: where the walls tilt the normal.
  vec3 ex = normalize(-dFdx(vViewPosition));
  vec3 ey = normalize(-dFdy(vViewPosition));
  vec4 clip = lookNameClip * vec4(p, 1.0);
  if (clip.w <= 0.0) return;
  vec2 css = (clip.xy / clip.w * vec2(0.5, -0.5) + 0.5) * lookNameGrid.xy;
  if (any(lessThan(css, vec2(0.0))) || any(greaterThanEqual(css, lookNameGrid.xy))) return;
  ivec2 tile = ivec2(css / lookNameGrid.z);
  int t = tile.y * int(lookNameGrid.w) + tile.x;
  int range = int(lookNameTexel(t >> 2)[t & 3]);
  int count = range & ${NAME_TILE_COUNT_MAX};
  if (count == 0) return;
  int start = range / ${NAME_TILE_COUNT_MAX + 1};
  vec2 atlas = vec2(textureSize(lookSeaAtlas, 0));
  float rimPx = ${f(NAME_LOOK.rimPx)} * lookNamePixelRatio;
  float bandPx = ${f(NAME_LOOK.bandPx)} * lookNamePixelRatio;
  float ink = 0.0;
  float rim = 0.0;
  float calm = 0.0;
  vec2 slope = vec2(0.0);
  for (int i = 0; i < LOOK_NAME_TILE_CAP; i++) {
    if (i >= count) break;
    int slot = start + i;
    int n = int(lookNameTexel(${NAME_SLOT_ROW * NAME_TABLE_WIDTH} + (slot >> 2))[slot & 3]);
    int base = ${NAME_ROW * NAME_TABLE_WIDTH} + ${NAME_TEXELS} * n;
    // Its anchor and strength; the least cosine from the anchor its band reaches.
    vec4 t0 = lookNameTexel(base);
    vec4 t3 = lookNameTexel(base + 3);
    float cosA = dot(p, t0.xyz);
    if (cosA < t3.x) continue;
    // Its baseline's direction at the anchor and its em, radians; the fragment in its frame, ems,
    // on the azimuthal equidistant projection about the anchor.
    vec4 t1 = lookNameTexel(base + 1);
    vec3 e = t1.xyz;
    vec3 up = cross(t0.xyz, e);
    vec2 xy = vec2(dot(p, e), dot(p, up));
    float sl = length(xy);
    float ang = acos(clamp(cosA, -1.0, 1.0));
    vec2 at = (sl > 1e-9 ? xy * (ang / sl) : xy) / t1.w;
    vec2 ax = vec2(dot(px, e), dot(px, up)) / t1.w;
    vec2 ay = vec2(dot(py, e), dot(py, up)) / t1.w;
    float perPx = max(max(length(ax), length(ay)), 1e-6);
    // Half its letters' length and the capitals' height: the box between the letters that the calm
    // band fills where the name is small, reaching bandPx about it.
    vec4 t2 = lookNameTexel(base + 2);
    float boxD = length(max(abs(at) - vec2(t2.x, 0.5 * LOOK_NAME_CAP), 0.0));
    float boxReach = bandPx * perPx;
    // Past the letters' reach above and below the capitals (Vietnamese marks, tails), the band
    // and the rim.
    if (boxD > 0.3 + max(LOOK_NAME_BAND, boxReach) + (2.0 + rimPx) * perPx) continue;
    float alpha = t0.w;
    // The letters' halos reach a fifth of an em, or bandPx where that is more, as far as their
    // fields reach; past that, where the name is small, the box fills in.
    float haloReach = min(max(0.2, boxReach), LOOK_NAME_BAND);
    float band = (1.0 - smoothstep(0.5 * boxReach, boxReach + 1e-6, boxD)) *
      smoothstep(0.8 * LOOK_NAME_BAND, LOOK_NAME_BAND, boxReach);
    // The letter whose span holds the fragment: its pen less half the tracking, by halving.
    float u = at.x + t2.x;
    int first = ${NAME_LETTER_ROW * NAME_TABLE_WIDTH} + int(t2.z);
    int lo = 0;
    int hi = int(t2.w) - 1;
    for (int b = 0; b < 6; b++) {
      if (lo >= hi) break;
      int mid = (lo + hi + 1) >> 1;
      if (u >= lookNameTexel(first + mid).x - 0.5 * t2.y) lo = mid;
      else hi = mid - 1;
    }
    vec4 letter = lookNameTexel(first + lo);
    vec2 g = vec2(u - letter.x, at.y + 0.5 * LOOK_NAME_CAP);
    LookNameCut one = lookNameLetter(letter, g, atlas, ax, ay, rimPx, haloReach);
    // Near the span's edges, the neighbor on that side too: its halo, rim and antialiasing reach
    // over.
    float edgeU = u - (letter.x - 0.5 * t2.y);
    float side = edgeU < 0.5 * (letter.w + t2.y) ? -1.0 : 1.0;
    int other = lo + int(side);
    float toEdge = side < 0.0 ? edgeU : letter.w + t2.y - edgeU;
    if (other >= 0 && other < int(t2.w) && toEdge < LOOK_NAME_BAND + (2.0 + rimPx) * perPx) {
      vec4 near = lookNameTexel(first + other);
      LookNameCut two = lookNameLetter(near, vec2(u - near.x, g.y), atlas, ax, ay, rimPx, haloReach);
      float cover = max(one.cover, two.cover);
      one.rim = max(one.rim, two.rim) * (1.0 - cover);
      one.halo = max(one.halo, two.halo);
      if (dot(two.slope, two.slope) > dot(one.slope, one.slope)) one.slope = two.slope;
      one.cover = cover;
    }
    ink = max(ink, one.cover * alpha);
    rim = max(rim, one.rim * alpha);
    calm = max(calm, max(one.halo, band) * alpha);
    if (dot(one.slope, one.slope) * alpha > dot(slope, slope)) slope = one.slope * alpha;
  }
  float limb = smoothstep(0.05, 0.3, dot(p, normalize(lookCamLocal - p)));
  ink *= limb;
  rim *= limb * (1.0 - ink);
  calm *= limb * (1.0 - ink);
  lookNameInk = ink;
  // The calm band: the relief and the grain lie flatter, and the ground darker, the more where the
  // climate's wash pales it.
  s.dh *= (1.0 - ${f(NAME_LOOK.flatten)} * calm) * (1.0 - 0.65 * ink);
  s.albedo *= 1.0 - (${f(NAME_LOOK.darken)} + ${f(NAME_LOOK.pale)} * s.wash) * calm;
  s.roughness = mix(s.roughness, max(s.roughness, 0.8), calm);
  // The rim, a fine dark edge outside every stroke.
  s.albedo *= 1.0 - ${f(NAME_LOOK.rimShade)} * rim;
  s.roughness = min(1.0, s.roughness + 0.2 * rim);
  // The floor: the etched borders' pale metal, half diffuse, its light capped with theirs.
  s.cut = max(s.cut, ink);
  s.albedo = mix(s.albedo, lookBorderEtched, ink);
  s.roughness = mix(s.roughness, ${f(NAME_LOOK.roughness)}, ink);
  s.metalness = mix(s.metalness, ${f(NAME_LOOK.metalness)}, ink);
  lookNameGlow = lookBorderEtched * ${f(NAME_LOOK.lift)} * ink;
  lookNameTilt = (slope.x * ex + slope.y * ey) * ${f(NAME_LOOK.wall)} * limb;
}
`;

/** After the borders, before the ash: the names cut into the surface. */
export const NAMES_FRAGMENT_APPLY = /* glsl */ `
  lookStateNames(lookS);
`;

/** After the look's own normal: the walls' tilt. */
export const NAMES_FRAGMENT_NORMAL = /* glsl */ `
  normal = normalize(normal + lookNameTilt);
`;

/**
 * After the look's own light and the cut's cap: the floor's lift; and, measuring, the letters as
 * flat magenta in place of their light.
 */
export const NAMES_FRAGMENT_LIGHT = /* glsl */ `
  totalEmissiveRadiance += lookNameGlow;
  if (lookNameMask > 0.5) {
    float lookNameOff = 1.0 - lookNameInk;
    reflectedLight.directDiffuse *= lookNameOff;
    reflectedLight.indirectDiffuse *= lookNameOff;
    reflectedLight.directSpecular *= lookNameOff;
    reflectedLight.indirectSpecular *= lookNameOff;
    totalEmissiveRadiance = totalEmissiveRadiance * lookNameOff + vec3(0.9, 0.0, 0.9) * lookNameInk;
  }
`;
