// Routes are analytic inlays in the same sea-level lacquer as sea names. A small geographic
// index limits each fragment to nearby segments; it stores references, not a rasterized line,
// so the cut stays crisp at island zoom. Static geometry uploads once; only the tiny time/opacity
// table changes each frame. No segment count cap drops parts of a route.
//
// Where Explore is enabled, the look's marks add a table of their own (marks/marks.ts), so there
// the cells head the index table instead of taking a texture, and the look reads no more samplers
// than it does without them (docs/design/streaming.md 5.8, Fragment samplers).
import {
  Color,
  DataTexture,
  FloatType,
  NearestFilter,
  RedFormat,
  RGFormat,
  RGBAFormat,
  Vector3,
  type Material,
  type PixelFormat,
} from 'three';
import { ROUTE_SEA, ROUTE_UNCERTAIN, type RouteData } from '../data/route';
import { dirOf } from '../story/effects/geo';

const CELL_DEG = 5;
export const ROUTE_COLUMNS = 360 / CELL_DEG;
export const ROUTE_ROWS = 180 / CELL_DEG;
const TABLE_WIDTH = 1024;
// The line is under 2 CSS pixels. This exceeds its footprint even at the world view's limb;
// the shader fades at the limb and caps its footprint at half a degree per device pixel.
const PAD_DEG = 2;
const DEG = Math.PI / 180;

export interface RouteUniforms {
  lookRouteCount: { value: number };
  lookRouteSegments: { value: DataTexture };
  /**
   * Each cell's first reference and count. Absent where the cells head the index table instead,
   * two texels a cell, their references counted from the table's start.
   */
  lookRouteCells?: { value: DataTexture };
  lookRouteIndices: { value: DataTexture };
  /** Two RGBA texels per route: head index/fraction/window/alpha, then fleet xyz/day offset. */
  lookRouteState: { value: DataTexture };
  lookRouteBrass: { value: Color };
  lookRouteEmber: { value: Color };
  lookRoutePixelRatio: { value: number };
}

function texture(
  data: Float32Array,
  width: number,
  height: number,
  format: PixelFormat,
): DataTexture {
  const t = new DataTexture(data, width, height, format, FloatType);
  t.minFilter = t.magFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

function table(values: number[], channels: number, format: PixelFormat): DataTexture {
  const height = Math.max(1, Math.ceil(values.length / channels / TABLE_WIDTH));
  const data = new Float32Array(TABLE_WIDTH * height * channels);
  data.set(values);
  return texture(data, TABLE_WIDTH, height, format);
}

const blank = () => texture(new Float32Array(4), 1, 1, RGBAFormat);

/** The routes' uniforms; with `cellsInIndices`, the cells head the index table (routeFragmentPars). */
export function createRouteUniforms({ cellsInIndices = false } = {}): RouteUniforms {
  return {
    lookRouteCount: { value: 0 },
    lookRouteSegments: { value: blank() },
    ...(cellsInIndices ? {} : { lookRouteCells: { value: blank() } }),
    lookRouteIndices: { value: blank() },
    lookRouteState: { value: blank() },
    lookRouteBrass: { value: new Color('#c09652') },
    lookRouteEmber: { value: new Color('#e8662c') },
    lookRoutePixelRatio: { value: 1 },
  };
}

/** Cells touched by a spherical cap enclosing a short segment and its antialiasing footprint. */
export function routeCells(a: Vector3, b: Vector3): number[] {
  const mid = a.clone().add(b).normalize();
  const lon = Math.atan2(mid.x, mid.z) / DEG;
  const lat = Math.asin(Math.max(-1, Math.min(1, mid.y))) / DEG;
  const arc = Math.atan2(new Vector3().crossVectors(a, b).length(), a.dot(b));
  const radius = arc / DEG / 2 + PAD_DEG;
  const longitude =
    Math.abs(lat) + radius >= 90
      ? 180
      : Math.asin(Math.min(1, Math.sin(radius * DEG) / Math.cos(lat * DEG))) / DEG;
  const y0 = Math.max(0, Math.floor((lat - radius + 90) / CELL_DEG));
  const y1 = Math.min(ROUTE_ROWS - 1, Math.floor((lat + radius + 90) / CELL_DEG));
  const x0 = Math.floor((lon - longitude + 180) / CELL_DEG);
  const x1 = Math.floor((lon + longitude + 180) / CELL_DEG);
  const cells = new Set<number>();
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const wrapped = ((x % ROUTE_COLUMNS) + ROUTE_COLUMNS) % ROUTE_COLUMNS;
      cells.add(y * ROUTE_COLUMNS + wrapped);
    }
  }
  return [...cells];
}

/** Replace all the static route data. Geometry rows retain the source point index, including stays. */
export function setRouteData(u: RouteUniforms, routes: RouteData[]): void {
  disposeRouteTextures(u);
  u.lookRouteCount.value = 0;
  if (routes.length === 0) {
    u.lookRouteSegments.value = blank();
    if (u.lookRouteCells) u.lookRouteCells.value = blank();
    u.lookRouteIndices.value = blank();
    u.lookRouteState.value = blank();
    return;
  }
  const segments: number[] = [];
  const cells = Array.from({ length: ROUTE_COLUMNS * ROUTE_ROWS }, (): number[] => []);
  routes.forEach((route, r) => {
    for (let i = 0; i < route.pts.length - 1; i++) {
      const a = route.pts[i]!;
      const b = route.pts[i + 1]!;
      const start = dirOf([a[0], a[1]]);
      const end = dirOf([b[0], b[1]]);
      const tangent = end.clone().addScaledVector(start, -start.dot(end));
      const angle = Math.atan2(tangent.length(), start.dot(end));
      if (angle < 1e-10) continue; // a stay: the fleet remains, but no zero-length stroke
      tangent.normalize();
      const row = segments.length / 16;
      segments.push(
        ...start.toArray(),
        a[2],
        ...end.toArray(),
        b[2],
        ...tangent.toArray(),
        angle,
        a[3],
        i,
        r,
        2 * Math.sin(angle / 2),
      );
      for (const cell of routeCells(start, end)) cells[cell]!.push(row);
    }
  });
  const offsets: number[] = [];
  const indices: number[] = [];
  for (const cell of cells) {
    offsets.push(indices.length, cell.length);
    indices.push(...cell);
  }
  u.lookRouteSegments.value = table(segments, 4, RGBAFormat);
  if (u.lookRouteCells) {
    u.lookRouteCells.value = texture(
      new Float32Array(offsets),
      ROUTE_COLUMNS,
      ROUTE_ROWS,
      RGFormat,
    );
    u.lookRouteIndices.value = table(indices, 1, RedFormat);
  } else {
    const head = offsets.length;
    const headed = offsets.map((value, i) => (i % 2 === 0 ? value + head : value));
    u.lookRouteIndices.value = table([...headed, ...indices], 1, RedFormat);
  }
  u.lookRouteState.value = texture(
    new Float32Array(routes.length * 8),
    2,
    routes.length,
    RGBAFormat,
  );
}

export function disposeRouteTextures(u: RouteUniforms): void {
  u.lookRouteSegments.value.dispose();
  u.lookRouteCells?.value.dispose();
  u.lookRouteIndices.value.dispose();
  u.lookRouteState.value.dispose();
}

const registry = new WeakMap<Material, RouteUniforms>();
export function registerRoutes(material: Material, uniforms: RouteUniforms): void {
  registry.set(material, uniforms);
}
export function routeUniformsOf(material: Material): RouteUniforms | undefined {
  return registry.get(material);
}

/** Where the cells head the index table: an entry of it. */
const ROUTE_INDEX = /* glsl */ `
float routeIndex(int i) {
  return texelFetch(lookRouteIndices, ivec2(i % ${TABLE_WIDTH}, i / ${TABLE_WIDTH}), 0).r;
}
`;

/** Where the cells head the index table: the cell's first reference and count. */
const ROUTE_CELL_FROM_INDICES = /* glsl */ `int head = 2 * (cell.y * ${ROUTE_COLUMNS} + cell.x);
  ivec2 list = ivec2(routeIndex(head), routeIndex(head + 1));`;

/**
 * The routes' declarations and functions; with `cellsInIndices`, the cells are read from the head
 * of the index table (setRouteData), and the look declares no cell table.
 */
export const routeFragmentPars = (cellsInIndices: boolean) => /* glsl */ `
uniform int lookRouteCount;
uniform highp sampler2D lookRouteSegments;${cellsInIndices ? '' : '\nuniform highp sampler2D lookRouteCells;'}
uniform highp sampler2D lookRouteIndices;
uniform highp sampler2D lookRouteState;
uniform vec3 lookRouteBrass;
uniform vec3 lookRouteEmber;
uniform float lookRoutePixelRatio;

vec4 routeSegment(int index) {
  return texelFetch(lookRouteSegments, ivec2(index % ${TABLE_WIDTH}, index / ${TABLE_WIDTH}), 0);
}
${cellsInIndices ? ROUTE_INDEX : ''}
// Returns only the glow; the brass and its polish belong to the lit surface.
vec3 lookRoutes(inout LookSurface s) {
  if (lookRouteCount == 0 || lookDebug != 0) return vec3(0.0);
  vec3 dir = lookSeaLevelDir();
  float radPx = clamp(max(length(dFdx(dir)), length(dFdy(dir))), 1e-8, 0.008726646);
  float limb = smoothstep(0.05, 0.25, dot(dir, normalize(lookCamLocal - dir)));
  vec2 ll = lookLonLat(dir);
  ivec2 cell = ivec2(floor((ll + vec2(180.0, 90.0)) / ${CELL_DEG.toFixed(1)}));
  cell.x = (cell.x + ${ROUTE_COLUMNS}) % ${ROUTE_COLUMNS};
  cell.y = clamp(cell.y, 0, ${ROUTE_ROWS - 1});
  ${cellsInIndices ? ROUTE_CELL_FROM_INDICES : 'ivec2 list = ivec2(texelFetch(lookRouteCells, cell, 0).rg);'}
  float ink = 0.0;
  float hot = 0.0;
  for (int j = 0; j < list.y; j++) {
    int ref = list.x + j;
    int row = int(texelFetch(lookRouteIndices, ivec2(ref % ${TABLE_WIDTH}, ref / ${TABLE_WIDTH}), 0).r);
    vec4 info = routeSegment(row * 4 + 3);
    vec4 a = routeSegment(row * 4);
    // Most references in a cell lie well outside this pixel. Reject them before the arc math.
    vec3 fromStart = dir - a.xyz;
    float reach = info.w + 3.0 * radPx * lookRoutePixelRatio;
    if (dot(fromStart, fromStart) > reach * reach) continue;
    vec4 state = texelFetch(lookRouteState, ivec2(0, int(info.z)), 0);
    if (state.w <= 0.0 || info.y > state.x) continue;
    float endFraction = info.y == state.x ? state.y : 1.0;
    if (endFraction <= 0.0) continue;
    vec4 b = routeSegment(row * 4 + 1);
    vec4 tangent = routeSegment(row * 4 + 2);
    float along = clamp(atan(dot(dir, tangent.xyz), dot(dir, a.xyz)), 0.0, tangent.w * endFraction);
    vec3 nearest = a.xyz * cos(along) + tangent.xyz * sin(along);
    float distPx = length(dir - nearest) / radPx;
    float uncertain = (int(info.x) & ${ROUTE_UNCERTAIN}) != 0 ? 0.62 : 1.0;
    float surface = (int(info.x) & ${ROUTE_SEA}) != 0 ? 1.0 - s.ground : 1.0;
    float cut = lookLine(distPx, 1.35 * lookRoutePixelRatio) * uncertain * surface * state.w * limb;
    float sailed = mix(a.w, b.w, along / tangent.w);
    float day = texelFetch(lookRouteState, ivec2(1, int(info.z)), 0).w;
    // One-pixel transition at the seven-day boundary, including through a long port stay.
    float dayPx = max(abs(b.w - a.w) * radPx / tangent.w, 0.00001);
    float recent = state.z > 0.0 ? smoothstep(day - state.z - dayPx, day - state.z + dayPx, sailed) : 0.0;
    ink = max(ink, cut);
    hot = max(hot, cut * recent);
  }
  float point = 0.0;
  float halo = 0.0;
  for (int r = 0; r < lookRouteCount; r++) {
    float alpha = texelFetch(lookRouteState, ivec2(0, r), 0).w * limb * (1.0 - s.ground);
    if (alpha <= 0.0) continue;
    vec3 fleet = texelFetch(lookRouteState, ivec2(1, r), 0).xyz;
    float d = length(dir - fleet) / (radPx * lookRoutePixelRatio);
    point = max(point, (1.0 - smoothstep(1.6, 2.5, d)) * alpha);
    halo = max(halo, exp(-d * d / 9.0) * alpha);
  }
  s.albedo = mix(s.albedo, lookRouteBrass, ink);
  s.albedo = mix(s.albedo, lookRouteEmber, max(hot, point));
  s.roughness = mix(s.roughness, 0.52, ink);
  s.metalness = mix(s.metalness, 0.85, ink);
  s.names = max(s.names, ink);
  return lookRouteBrass * ink * 0.08 + lookRouteEmber * (hot * 0.7 + point * 1.8 + halo * 0.25);
}
`;

export const ROUTE_FRAGMENT_APPLY = /* glsl */ `
  totalEmissiveRadiance += lookRoutes(lookS);
  diffuseColor.rgb = lookS.albedo;
`;
