// Cube-sphere conventions (streaming.md 3.0), the same as pipeline/src/prebuild/cube.py.
// Texel, sub-sample, corner and subpixel indices are face-global integers (G = 256x + i), so a
// position is exact and depends only on where it is, never on which tile asks.
import constants from '@shared/constants.json' with { type: 'json' };

export type Vec3 = [number, number, number];
export type Edge = 'N' | 'E' | 'S' | 'W';

export interface Tile {
  face: number;
  level: number;
  x: number;
  y: number;
}

export interface Neighbor {
  tile: Tile;
  /** The neighbor's edge that meets the asking tile's edge. */
  edge: Edge;
  /** Entry k is the neighbor's entry 256 − k. */
  reversed: boolean;
}

export interface FaceFrame {
  c: Vec3;
  u: Vec3;
  v: Vec3;
}

type FaceEdge = readonly [face: number, edge: Edge, reversed: boolean];

export const TILE: number = constants.cube.tile;
export const BORDER: number = constants.cube.border;
export const EDGES: readonly Edge[] = ['N', 'E', 'S', 'W'];

/** Center C, U and V of each face in the globe frame G. */
export const FACES: readonly FaceFrame[] = constants.cube.faces.map(({ c, u, v }) => ({
  c: vec3(c),
  u: vec3(u),
  v: vec3(v),
}));

/**
 * Per face and edge: the neighbor face, the neighbor's edge that meets it, and whether entries
 * run reversed (streaming.md 3.0 item 7). Neighbors read this table, never a float comparison.
 */
export const FACE_EDGES: readonly Readonly<Record<Edge, FaceEdge>>[] = [
  { N: [4, 'S', false], E: [1, 'W', false], S: [5, 'N', false], W: [3, 'E', false] },
  { N: [4, 'E', false], E: [2, 'W', false], S: [5, 'E', true], W: [0, 'E', false] },
  { N: [4, 'N', true], E: [3, 'W', false], S: [5, 'S', true], W: [1, 'E', false] },
  { N: [4, 'W', true], E: [0, 'W', false], S: [5, 'W', false], W: [2, 'E', false] },
  { N: [2, 'N', true], E: [1, 'N', false], S: [0, 'N', false], W: [3, 'N', true] },
  { N: [0, 'S', false], E: [1, 'S', true], S: [2, 'S', true], W: [3, 'S', false] },
];

const STEP: Readonly<Record<Edge, readonly [number, number]>> = {
  N: [0, 1],
  E: [1, 0],
  S: [0, -1],
  W: [-1, 0],
};
const OPPOSITE: Readonly<Record<Edge, Edge>> = { N: 'S', E: 'W', S: 'N', W: 'E' };
const KEY = /^(0|[1-9]\d*)\/(0|[1-9]\d*)\/(0|[1-9]\d*)\/(0|[1-9]\d*)$/;

/** Unit direction in G for longitude and latitude in degrees. */
export function lonLatToDir(lon: number, lat: number): Vec3 {
  const lambda = lon * (Math.PI / 180);
  const phi = lat * (Math.PI / 180);
  const cosPhi = Math.cos(phi);
  return [cosPhi * Math.cos(lambda), cosPhi * Math.sin(lambda), Math.sin(phi)];
}

/** Longitude in (−180, 180] and latitude, in degrees. */
export function dirToLonLat(p: Vec3): [number, number] {
  const [x, y, z] = p;
  return [Math.atan2(y, x) * (180 / Math.PI), Math.atan2(z, Math.hypot(x, y)) * (180 / Math.PI)];
}

/** The face of the largest |component| with its sign; ties go to the lowest face. */
export function faceOf(p: Vec3): number {
  let best = 0;
  let bestToward = -Infinity;
  FACES.forEach(({ c }, face) => {
    const toward = dot(p, c);
    if (toward > bestToward) {
      best = face;
      bestToward = toward;
    }
  });
  return best;
}

/** (s, t) of p in the frame of `face`: s = (4/π)·atan((p·U)/(p·C)). */
export function faceSt(face: number, p: Vec3): [number, number] {
  const { c, u, v } = faceFrame(face);
  const alongC = dot(p, c);
  return [
    (4 / Math.PI) * Math.atan(dot(p, u) / alongC),
    (4 / Math.PI) * Math.atan(dot(p, v) / alongC),
  ];
}

/** normalize(C + tan(πs/4)·U + tan(πt/4)·V). */
export function stToDir(face: number, s: number, t: number): Vec3 {
  const { c, u, v } = faceFrame(face);
  const a = Math.tan((Math.PI * s) / 4);
  const b = Math.tan((Math.PI * t) / 4);
  const x = c[0] + a * u[0] + b * v[0];
  const y = c[1] + a * u[1] + b * v[1];
  const z = c[2] + a * u[2] + b * v[2];
  const length = Math.sqrt(x * x + y * y + z * z);
  return [x / length, y / length, z / length];
}

/** three.js space (G.y, G.z, G.x): north is +Y and longitude 0 faces +Z. */
export function toThree(p: Vec3): Vec3 {
  return [p[1], p[2], p[0]];
}

/** s of the center of face-global texel G = 256x + i (t likewise): −1 + (2G + 1)/(256n). */
export function texelCenter(level: number, g: number): number {
  return -1 + (2 * g + 1) / (TILE * 2 ** level);
}

/** s of height sub-sample a in 0..3 of texel G: −1 + (8G + 2a + 1)/(1024n). */
export function subsample(level: number, g: number, a: number): number {
  return -1 + (8 * g + 2 * a + 1) / (4 * TILE * 2 ** level);
}

/** s of face-global texel corner C = 256x + c: −1 + C/(128n). */
export function corner(level: number, c: number): number {
  return -1 + (2 * c) / (TILE * 2 ** level);
}

/** s of face-global shore and water subpixel A = 4G + a: −1 + (2A + 1)/(1024n). */
export function subpixelCenter(level: number, a: number): number {
  return -1 + (2 * a + 1) / (4 * TILE * 2 ** level);
}

/** Tile index x along s (y along t), clamped to the face. */
export function tileOf(s: number, level: number): number {
  const side = 2 ** level;
  return Math.min(side - 1, Math.max(0, Math.floor((s + 1) * (side / 2))));
}

/** Texel index i in 0..255 within tile x along s (j within y along t), clamped to the tile. */
export function texelOf(s: number, level: number, tile: number): number {
  const g = Math.floor((s + 1) * ((TILE * 2 ** level) / 2));
  return Math.min(TILE - 1, Math.max(0, g - TILE * tile));
}

/** 2(4^L − 1) + f·4^L + y·2^L + x: the tile's bit in the availability bitmap. */
export function nodeIndex(t: Tile): number {
  const side = 2 ** t.level;
  return 2 * (side * side - 1) + (t.face * side + t.y) * side + t.x;
}

export function nodeFromIndex(k: number): Tile {
  if (!Number.isSafeInteger(k) || k < 0) throw new RangeError(`no node ${k}`);
  let level = 0;
  while (k >= nodeCount(level)) level += 1;
  const side = 2 ** level;
  const inLevel = k - 2 * (side * side - 1);
  const face = Math.floor(inLevel / (side * side));
  const inFace = inLevel - face * side * side;
  return { face, level, x: inFace % side, y: Math.floor(inFace / side) };
}

/** Nodes at levels 0..maxLevel: 2(4^(maxLevel + 1) − 1). */
export function nodeCount(maxLevel: number): number {
  const side = 2 ** (maxLevel + 1);
  return 2 * (side * side - 1);
}

/** `L/f/x/y`, the tile's path under `surf/<ver8>/`. */
export function tileKey(t: Tile): string {
  return `${t.level}/${t.face}/${t.x}/${t.y}`;
}

export function parseTileKey(key: string): Tile {
  const match = KEY.exec(key);
  if (!match) throw new Error(`not a tile key: ${JSON.stringify(key)}`);
  const [level, face, x, y] = match.slice(1).map(Number) as [number, number, number, number];
  const side = 2 ** level;
  if (face >= 6 || x >= side || y >= side) throw new RangeError(`no tile ${key}`);
  return { face, level, x, y };
}

/** The tile across `edge`, the edge of it that meets `edge`, and whether entries reverse. */
export function neighbor(t: Tile, edge: Edge): Neighbor {
  const [dx, dy] = STEP[edge];
  const last = 2 ** t.level - 1;
  const x = t.x + dx;
  const y = t.y + dy;
  if (x >= 0 && x <= last && y >= 0 && y <= last) {
    return { tile: { face: t.face, level: t.level, x, y }, edge: OPPOSITE[edge], reversed: false };
  }
  const [face, facing, reversed] = faceEdges(t.face)[edge];
  const along = edge === 'N' || edge === 'S' ? t.x : t.y;
  const mapped = reversed ? last - along : along;
  const across = facing === 'N' || facing === 'E' ? last : 0;
  const tile =
    facing === 'N' || facing === 'S'
      ? { face, level: t.level, x: mapped, y: across }
      : { face, level: t.level, x: across, y: mapped };
  return { tile, edge: facing, reversed };
}

/**
 * Indices into EDGES of the tile's sides that lie on a face edge, in N, E, S, W order: the sides
 * that store an edge profile (streaming.md 3.1). An L0 tile has all four, a tile at a face corner
 * two, and a tile inside a face none.
 */
export function faceEdgeSides(t: Tile): number[] {
  const last = 2 ** t.level - 1;
  const onFaceEdge = [t.y === last, t.x === last, t.y === 0, t.x === 0];
  return onFaceEdge.flatMap((on, e) => (on ? [e] : []));
}

/** Bit k of an availability bitmap: byte k >> 3, bit k & 7, least significant first. */
export function availGet(bitmap: Uint8Array, k: number): boolean {
  const byte = bitmap[k >> 3];
  if (byte === undefined) throw new RangeError(`node ${k} is past the bitmap`);
  return ((byte >> (k & 7)) & 1) === 1;
}

function dot(p: Vec3, axis: Vec3): number {
  return p[0] * axis[0] + p[1] * axis[1] + p[2] * axis[2];
}

function faceFrame(face: number): FaceFrame {
  const frame = FACES[face];
  if (!frame) throw new RangeError(`no face ${face}`);
  return frame;
}

function faceEdges(face: number): Readonly<Record<Edge, FaceEdge>> {
  const edges = FACE_EDGES[face];
  if (!edges) throw new RangeError(`no face ${face}`);
  return edges;
}

function vec3(values: readonly number[]): Vec3 {
  const [x, y, z, ...rest] = values;
  if (x === undefined || y === undefined || z === undefined || rest.length > 0) {
    throw new Error(`not a 3-vector: ${JSON.stringify(values)}`);
  }
  return [x, y, z];
}
