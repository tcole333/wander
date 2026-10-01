// The marks' part of the surface look (lookFragment.glsl.ts), compiled only where Explore is
// enabled. The look finds the fragment's screen tile from its inlay direction, the sea-level
// direction the graticule and sea names use, so relief never moves a fragment out of its mark's
// tile; reads that tile's marks from the table MarkLayer packs each frame (marks.ts); and for each
// cuts the mark into the bronze: its family's seal and polished bezel, standing on the relief with a
// contact shadow, and its glyph on the seal, coverage and a bevel from the glyph's distance field;
// a hollow outline, a hover ring and the focal ember as its flags ask. Where marks overlap, the one
// first in priority is drawn on top. The marks take the look's lamp, shadow, polish and the
// ridges' occlusion, since they are the globe's own surface.
import { tunables } from '../config/tunables';
import { FAMILY_VEC4S, PACES } from './families';
import { GLYPH_SPREAD } from './glyphAtlas';
import { GLYPH_UNITS } from './glyphs';

/**
 * The table's width and height in texels, and its rows: the tiles' ranges, four a texel (the
 * first slot times TILE_COUNT_MAX + 1 plus the count); the slots, one a texel (a mark's screen disc and index,
 * so a fragment outside it stops after one fetch); then three texels a mark.
 */
export const TABLE_WIDTH = 512;
export const TABLE_ROWS = 16;
export const SLOT_ROW = 4;
export const MARK_ROW = 12;
export const MARK_TEXELS = 3;
export const TILES_MAX = SLOT_ROW * TABLE_WIDTH * 4;
/**
 * The tiles the grid runs past each edge of the viewport: a fragment drawn on relief seen tilted
 * stands above its sea-level foot, which the look finds its tile from, so near the screen's edge
 * the foot can lie beyond it.
 */
export const PAD_TILES = 3;
export const SLOTS_MAX = (MARK_ROW - SLOT_ROW) * TABLE_WIDTH;
export const MARKS_MAX = Math.floor(((TABLE_ROWS - MARK_ROW) * TABLE_WIDTH) / MARK_TEXELS);
/** The most marks a tile's range can count: tunables.markTileCap stays within it. */
export const TILE_COUNT_MAX = 15;

/** Flags a mark's texel carries, below its family (FAMILY_STEP times the family's index). */
export const FLAG = { focal: 1, hover: 2, hollow: 4, soft: 8, mirror: 16 } as const;
export const FAMILY_STEP = 32;

/** The focal mark's ember ring, in r: its radius and half its width. */
export const EMBER_RING = { radius: 1.35, half: 0.07 } as const;

/**
 * Antialiasing, in device px across an edge: a hard one's and a soft one's (an inherited place or
 * a date known to the year). Across a seal's edge or its shadow's it is taken along the radius, so
 * a tilted mark's edge is as sharp on screen as a facing one's.
 */
export const MARK_AA_PX = { hard: 0.75, soft: 2.5 } as const;
/**
 * The widest a soft edge spreads, in r, however small the mark: at 12 px, 2.5 px either side of
 * its edge would blur a seal into a smudge, and a war, whose place is nearly always borrowed, would
 * vanish from the views where it stands for its battles.
 */
export const SOFT_EDGE_MAX = 0.2;
/** The contact shadow's blur beyond its edge's antialiasing, in r, and how much light it takes. */
export const SHADOW_BLUR = 0.12;
export const SHADOW_DEPTH = 0.75;
/**
 * The rings' widths in the most of r a pixel spans (which a tilt widens): the ember's half width
 * when wider than its own, and a hovered ring's outer edge.
 */
export const RING_PX = { ember: 0.9, hover: 2 } as const;
/**
 * A hovered parent's ring, engraved: the half width of its inlay in the same pixels, the walls
 * sloping down into it out to RING_PX.hover, and the walls' slope (rise over run), which takes the
 * lamp on the side that faces it.
 */
export const RING_ENGRAVE = { ink: 0.9, wall: 1.2 } as const;

/**
 * A glyph's field as the look reads it, in its half grid: within `box` of its center (the cell's
 * margin, less mips' reach), and out to `reach` beyond its edge, short of where its bytes run out
 * (GLYPH_SPREAD); every edge, outline and cap a glyph draws ends within that reach.
 */
export const GLYPH_FIELD = { reach: 0.45, box: 1.45 } as const;

const float = (value: number) => (Number.isInteger(value) ? `${value}.0` : String(value));

/** Declarations, before the look's LookSurface. */
export const MARKS_DECLARATIONS = /* glsl */ `
#define LOOK_MARK_TILE_CAP ${tunables.markTileCap}
#define LOOK_MARK_PAD_TILES ${float(PAD_TILES)}
#define LOOK_MARK_FAMILY_VEC4 ${FAMILY_VEC4S}
#define LOOK_MARK_FAMILIES ${PACES.length}
#define LOOK_MARK_ROUGH_MIN ${float(tunables.markRoughMin)}
#define LOOK_MARK_SPEC_MAX ${float(tunables.markSpecMax)}
// A glyph field's step of one byte in units of half the glyph's grid: its spread in texels over
// 127 steps, over the texels in half the grid.
#define LOOK_MARK_BYTE_TO_GLYPH ${float(GLYPH_SPREAD / 127 / (GLYPH_UNITS / 2))}
#define LOOK_MARK_HALF_GRID ${float(GLYPH_UNITS / 2)}
#define LOOK_MARK_GLYPH_REACH ${float(GLYPH_FIELD.reach)}
#define LOOK_MARK_GLYPH_BOX ${float(GLYPH_FIELD.box)}
#define LOOK_MARK_SOFT_EDGE_MAX ${float(SOFT_EDGE_MAX)}

uniform bool lookMarksOn;
uniform highp sampler2D lookMarkTable;
// The globe frame to clip space for this draw, and to view space for normals.
uniform mat4 lookMarkClip;
uniform mat3 lookMarkView;
// The viewport's width and height in CSS px, a tile's side in CSS px, and the tiles across, the
// grid running LOOK_MARK_PAD_TILES tiles past each edge.
uniform vec4 lookMarkGrid;
uniform vec4 lookMarkFamily[LOOK_MARK_FAMILIES * LOOK_MARK_FAMILY_VEC4];
// A disc's bevel as a share of r, the relief's and the fill's strength, and the sub-threshold glow.
uniform vec4 lookMarkStyle;
// The ember's linear color and its strength, and its breath now.
uniform vec4 lookMarkEmber;
uniform float lookMarkBreath;
// How polished the marks are: their roughness is divided by it, down to LOOK_MARK_ROUGH_MIN.
uniform float lookMarkPolish;
// The engraved line of a hovered parent's extent: its niello over land (over the sea it is the
// graticule's brass, lookInlay).
uniform vec3 lookMarkEngrave;

struct LookMarks {
  // How much of the fragment the marks cover, 0 to 1, and how much of its light they cap: their
  // shapes out to the edge's last antialiased pixel, where a bevel can still face the lamp.
  float cover;
  float cap;
  // The marks' relief as a surface gradient in the globe frame: rise per run.
  vec3 grad;
  // What they emit: the sub-threshold glow, and the focal ember apart, which blooms.
  vec3 glow;
  vec3 ember;
};

vec4 lookMarkTexel(int i) {
  return texelFetch(lookMarkTable, ivec2(i & 511, i >> 9), 0);
}

// A bevel from 0 outside the edge to 1 at w inside it, and its slope per unit of d.
vec2 lookMarkBevel(float d, float w) {
  float t = clamp(d / w, 0.0, 1.0);
  return vec2(t * t * (3.0 - 2.0 * t), 6.0 * t * (1.0 - t) / w);
}

// The antialiasing across an edge, in r, where a pixel spans px of r along it: a soft edge's
// spreads further, but never past LOOK_MARK_SOFT_EDGE_MAX of r, nor below a hard one's.
float lookMarkEdge(float px, bool soft) {
  float hard = px * ${float(MARK_AA_PX.hard)};
  return soft ? min(px * ${float(MARK_AA_PX.soft)}, max(hard, LOOK_MARK_SOFT_EDGE_MAX)) : hard;
}

// The glyph's distance at glyph-grid point gq (1 at the grid's edge), from the atlas cell centered
// at cell (texels), read with the footprint gx, gy (atlas uv per pixel).
float lookMarkGlyph(vec2 cell, vec2 gq, vec2 atlas, vec2 gx, vec2 gy) {
  vec2 uv = (cell + vec2(gq.x, -gq.y) * LOOK_MARK_HALF_GRID) / atlas;
  return textureGrad(lookSeaAtlas, uv, gx, gy).r * 255.0 - 128.0;
}
`;

/** The marks' pass over the look's surface, after LookSurface is declared. */
export const MARKS_FUNCTIONS = /* glsl */ `
// Cuts the marks of the fragment's tile into the surface o: g is the inlay direction and gx, gy
// its derivatives per pixel, taken where every fragment still runs.
void lookMarksApply(inout LookSurface o, vec3 g, vec3 gx, vec3 gy) {
  o.marks.cover = 0.0;
  o.marks.cap = 0.0;
  o.marks.grad = vec3(0.0);
  o.marks.glow = vec3(0.0);
  o.marks.ember = vec3(0.0);
  if (!lookMarksOn) return;
  vec4 clip = lookMarkClip * vec4(g, 1.0);
  if (clip.w <= 0.0) return;
  vec2 px = (clip.xy / clip.w * vec2(0.5, -0.5) + 0.5) * lookMarkGrid.xy;
  vec2 pad = vec2(LOOK_MARK_PAD_TILES * lookMarkGrid.z);
  vec2 inGrid = px + pad;
  if (any(lessThan(inGrid, vec2(0.0))) || any(greaterThanEqual(inGrid, lookMarkGrid.xy + 2.0 * pad))) {
    return;
  }
  ivec2 tile = ivec2(inGrid / lookMarkGrid.z);
  int t = tile.y * int(lookMarkGrid.w) + tile.x;
  int range = int(lookMarkTexel(t >> 2)[t & 3]);
  int count = range & ${TILE_COUNT_MAX};
  if (count == 0) return;
  int start = ${SLOT_ROW * 512} + range / ${TILE_COUNT_MAX + 1};
  vec2 atlas = vec2(textureSize(lookSeaAtlas, 0));
  vec3 ground = o.albedo;
  float groundRough = o.roughness;
  float groundMetal = o.metalness;
  float flatten = 0.0;
  // The tile lists its marks in priority order; the first is drawn last, on top of the others.
  for (int i = 0; i < LOOK_MARK_TILE_CAP; i++) {
    if (i >= count) break;
    // The mark's screen disc, CSS px, and its index: most of a tile lies outside it, and stops.
    vec4 slot = lookMarkTexel(start + count - 1 - i);
    vec2 fromCenter = px - slot.xy;
    if (dot(fromCenter, fromCenter) > slot.z * slot.z) continue;
    int m = ${MARK_ROW * 512} + ${MARK_TEXELS} * int(slot.w);
    // The anchor and r, the mark's radius at sea level, and its frame there, north up; the lamp's
    // shadow offset and a hovered parent's ring, in r, and the least cosine from the anchor at
    // which the mark still draws.
    vec4 t1 = lookMarkTexel(m);
    vec4 t3 = lookMarkTexel(m + 2);
    vec3 anchor = t1.xyz;
    if (dot(g, anchor) < t3.w) continue;
    float r = t1.w;
    vec3 east = vec3(anchor.z, 0.0, -anchor.x);
    float eastLength = length(east);
    east = eastLength > 1e-6 ? east / eastLength : vec3(1.0, 0.0, 0.0);
    vec3 north = cross(anchor, east);
    vec3 v = g - anchor;
    // The fragment in the mark's frame, in r, and its change per pixel.
    vec2 q = vec2(dot(v, east), dot(v, north)) / r;
    vec2 qx = vec2(dot(gx, east), dot(gx, north)) / r;
    vec2 qy = vec2(dot(gy, east), dot(gy, north)) / r;
    float pxR = max(max(length(qx), length(qy)), 1e-4);
    // The glyph's cell, the family and flags, and the mark's strength.
    vec4 t2 = lookMarkTexel(m + 1);
    int familyFlags = int(t2.z);
    int flags = familyFlags & ${FAMILY_STEP - 1};
    bool soft = (flags & ${FLAG.soft}) != 0;
    bool hollow = (flags & ${FLAG.hollow}) != 0;
    // A mirrored glyph is read east to west: a storm's south of the equator.
    float mirror = (flags & ${FLAG.mirror}) != 0 ? -1.0 : 1.0;
    float alpha = t2.w;
    // Relief rises first, and the fill comes after; estimates are softer and half as deep.
    float rise = smoothstep(0.0, 0.5, alpha) * lookMarkStyle.y * (soft ? 0.5 : 1.0);
    float fill = smoothstep(0.4, 1.0, alpha) * lookMarkStyle.z;
    float aa = lookMarkEdge(pxR, soft);
    // The seal's bevel rounds a good share of it, so its slope turns through the lamp's reflection
    // and lights the bezel on the lamp's side; a glyph's is a pixel or a tenth of r, within its
    // strokes.
    float sealBevel = max(lookMarkStyle.x, 2.0 * pxR) * (soft ? 1.6 : 1.0);
    float bevel = max(0.25 * lookMarkStyle.x, pxR) * (soft ? 1.6 : 1.0);

    int f = (familyFlags / ${FAMILY_STEP}) * LOOK_MARK_FAMILY_VEC4;
    vec4 f0 = lookMarkFamily[f];
    vec4 f1 = lookMarkFamily[f + 1];
    vec4 f2 = lookMarkFamily[f + 2];
    vec4 f3 = lookMarkFamily[f + 3];
    vec4 f4 = lookMarkFamily[f + 4];

    // The seal, antialiased along its radius: pxRad is a pixel's share of r that way.
    float rq = length(q);
    vec2 nq = rq > 1e-5 ? q / rq : vec2(1.0, 0.0);
    float pxRad = max(length(vec2(dot(nq, qx), dot(nq, qy))), 1e-4);
    float aaRound = lookMarkEdge(pxRad, soft);
    float dSeal = f0.w - rq;
    vec2 nSeal = rq > 1e-5 ? -nq : vec2(0.0);

    // The glyph's field, in r; near its edge, where the bevel slopes and the glyph has relief,
    // its gradient from two more taps a texel or a pixel away. Its outline and its antialiasing,
    // the cap's twice over, all end within the field's reach beyond its edge, so nothing is drawn
    // where the field has run out or the cell's box would cut it square.
    float scale = f1.w;
    float fieldReach = LOOK_MARK_GLYPH_REACH * scale;
    float line = min(max(0.08, 1.1 * pxR), 0.35 * fieldReach);
    float aaGlyph = min(aa, 0.5 * (fieldReach - (hollow ? line : 0.0)));
    vec2 gq = q / scale * vec2(mirror, 1.0);
    float dGlyph = -1.0;
    vec2 nGlyph = vec2(0.0);
    if (max(abs(gq.x), abs(gq.y)) < LOOK_MARK_GLYPH_BOX) {
      vec2 gx2 = vec2(mirror * qx.x, -qx.y) * (LOOK_MARK_HALF_GRID / scale) / atlas;
      vec2 gy2 = vec2(mirror * qy.x, -qy.y) * (LOOK_MARK_HALF_GRID / scale) / atlas;
      float s0 = lookMarkGlyph(t2.xy, gq, atlas, gx2, gy2);
      dGlyph = s0 > -126.0 ? s0 * LOOK_MARK_BYTE_TO_GLYPH * scale : -1.0;
      if (f2.y != 0.0 && abs(dGlyph) < bevel + aaGlyph + (hollow ? line : 0.0)) {
        float step = max(pxR / scale, 1.5 / LOOK_MARK_HALF_GRID);
        float su = lookMarkGlyph(t2.xy, gq + vec2(step, 0.0), atlas, gx2, gy2);
        float sv = lookMarkGlyph(t2.xy, gq + vec2(0.0, step), atlas, gx2, gy2);
        vec2 n = vec2(su - s0, sv - s0);
        nGlyph = dot(n, n) > 1e-6 ? normalize(n) * vec2(mirror, 1.0) : vec2(0.0);
      }
    }
    if (hollow) {
      // An expanded parent keeps its glyph as an outline.
      nGlyph *= -sign(dGlyph);
      dGlyph = line - abs(dGlyph);
    }

    // A hovered parent's extent: a dashed line engraved at t3.z, the circle its arc from the
    // anchor makes, seen straight down on the anchor's tangent plane. Its inlay is full weight
    // however faint the glyph, as the lamp and the limb allow: over the sea the graticule's brass,
    // over land niello, cut between walls that slope down into it and take the lamp as the relief
    // does, lit on the side that faces it.
    float ring = 0.0;
    vec2 ringSlope = vec2(0.0);
    if (t3.z > 0.0) {
      float fromRing = rq - t3.z;
      float across = abs(fromRing) / pxR;
      float around = atan(q.y, q.x) / 6.283185307179586;
      float dashes = max(12.0, floor(6.283185307179586 * t3.z / (10.0 * pxR)));
      float weight = smoothstep(0.0, 0.5, alpha) * step(0.45, fract(around * dashes));
      float ink = ${float(RING_ENGRAVE.ink)};
      float edge = ${float(RING_PX.hover)};
      ring = (1.0 - smoothstep(ink - 0.5, ink + 0.5, across)) * weight;
      float wall = smoothstep(ink - 0.5, ink, across) * (1.0 - smoothstep(edge - 0.5, edge, across));
      ringSlope = sign(fromRing) * nq * ${float(RING_ENGRAVE.wall)} * wall * weight;
    }

    // Coverage, and the heights' slopes in the mark's frame.
    float cSeal = smoothstep(-aaRound, aaRound, dSeal);
    float cGlyph = smoothstep(-aaGlyph, aaGlyph, dGlyph);
    vec2 bSeal = lookMarkBevel(dSeal, sealBevel);
    vec2 bGlyph = lookMarkBevel(dGlyph, bevel);
    vec2 slope = f2.x * bSeal.y * nSeal + f2.y * bGlyph.y * nGlyph;
    o.marks.grad += (slope.x * east + slope.y * north) * rise;
    o.marks.grad += (ringSlope.x * east + ringSlope.y * north) * lookMarkStyle.y;
    // The polished bezel, a band just inside the seal's edge, on its bevel.
    float cBezel = cSeal * (1.0 - smoothstep(-aaRound, aaRound, dSeal - f4.w));

    // Coverage of the whole mark, and the light's cap, over its shapes out to two edges'
    // antialiasing, where a bevel can still face the lamp.
    float cover = max(cSeal, cGlyph);
    float capped = max(
      smoothstep(-2.0 * aaGlyph, 0.0, dGlyph),
      smoothstep(-2.0 * aaRound, 0.0, dSeal)
    );
    flatten = max(flatten, f3.z * cover * smoothstep(0.0, 0.5, alpha));

    // The contact shadow, away from the lamp, on the ground outside the mark.
    vec2 fromShadow = q + t3.xy;
    float rs = length(fromShadow);
    vec2 ns = rs > 1e-5 ? fromShadow / rs : vec2(1.0, 0.0);
    float pxShadow = max(length(vec2(dot(ns, qx), dot(ns, qy))), 1e-4);
    float blur = 2.0 * lookMarkEdge(pxShadow, soft) + ${float(SHADOW_BLUR)};
    float shade = smoothstep(-blur, blur, f0.w - rs) * (1.0 - cover) * smoothstep(0.0, 0.5, alpha);

    // Colors: the seal, its bezel, the glyph on them.
    vec3 color = mix(ground, f0.rgb, cSeal);
    float rough = mix(groundRough, f2.z, cSeal);
    float metal = mix(groundMetal, f3.x, cSeal);
    color = mix(color, f4.rgb, cBezel);
    rough = mix(rough, f3.w, cBezel);
    metal = mix(metal, 1.0, cBezel);
    color = mix(color, f1.rgb, cGlyph);
    rough = mix(rough, f2.w, cGlyph);
    metal = mix(metal, f3.y, cGlyph);

    float a = cover * fill;
    o.albedo = mix(o.albedo, color, fill) * (1.0 - ${float(SHADOW_DEPTH)} * shade);
    rough = max(rough / lookMarkPolish, LOOK_MARK_ROUGH_MIN);
    o.roughness = mix(o.roughness, rough, a);
    o.metalness = mix(o.metalness, metal, fill);
    o.albedo = mix(o.albedo, mix(lookInlay, lookMarkEngrave, o.land), ring);
    o.roughness = mix(o.roughness, mix(0.45, 0.8, o.land), ring);
    o.metalness = mix(o.metalness, mix(0.93, 0.3, o.land), ring);
    o.marks.cover = max(o.marks.cover, max(cover * max(fill, rise), ring));
    o.marks.cap = max(o.marks.cap, max(capped * max(fill, rise), ring));
    // A glow under the bloom's threshold, of the glyph's own color.
    float lum = max(dot(f1.rgb, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
    o.marks.glow += f1.rgb / lum * min(lookMarkStyle.w, 0.4) * cGlyph * alpha;

    // The focal mark alone: an ember ring that breathes, bright enough to bloom.
    if ((flags & ${FLAG.focal}) != 0) {
      float ringW = max(${float(EMBER_RING.half)}, ${float(RING_PX.ember)} * pxR);
      float ring =
        1.0 - smoothstep(ringW - pxR, ringW + pxR, abs(rq - ${float(EMBER_RING.radius)}));
      o.marks.ember += lookMarkEmber.rgb * lookMarkEmber.w * lookMarkBreath * ring * alpha;
    }
    ground = o.albedo;
    groundRough = o.roughness;
    groundMetal = o.metalness;
  }
  o.dh *= 1.0 - flatten;
  o.names = max(o.names, o.marks.cover * (1.0 - o.land));
}
`;

/** In lookSurface, once the surface is complete: the inlay direction's derivatives, then marks. */
export const MARKS_APPLY = /* glsl */ `
  lookMarksApply(o, gratDir, lookMarkDx, lookMarkDy);`;

/** In lookSurface, beside gratDir, where every fragment still runs. */
export const MARKS_DERIVATIVES = /* glsl */ `
  vec3 lookMarkDx = dFdx(gratDir);
  vec3 lookMarkDy = dFdy(gratDir);`;

/** In lookPerturb: the marks' bevels tilt the normal with the relief's. */
export const MARKS_PERTURB = /* glsl */ `
  g += lookMarkView * s.marks.grad;`;

/**
 * After the look's own specular: over a mark, what the lamp lights stays under markSpecMax less
 * its glow, so no mark but the focal one reaches the bloom's threshold; then the glows.
 */
export const MARKS_LIGHT = /* glsl */ `
  vec3 lookMarkLit = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse +
    reflectedLight.directSpecular + reflectedLight.indirectSpecular;
  float lookMarkLum = dot(lookMarkLit, vec3(0.2126, 0.7152, 0.0722));
  float lookMarkGlowLum = dot(lookS.marks.glow, vec3(0.2126, 0.7152, 0.0722));
  float lookMarkRoom = max(LOOK_MARK_SPEC_MAX - lookMarkGlowLum, 0.5 * LOOK_MARK_SPEC_MAX);
  float lookMarkK = mix(1.0, min(1.0, lookMarkRoom / max(lookMarkLum, 1e-4)), lookS.marks.cap);
  reflectedLight.directDiffuse *= lookMarkK;
  reflectedLight.indirectDiffuse *= lookMarkK;
  reflectedLight.directSpecular *= lookMarkK;
  reflectedLight.indirectSpecular *= lookMarkK;
  totalEmissiveRadiance += lookS.marks.glow + lookS.marks.ember;`;
