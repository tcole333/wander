// The grid every drawn tile shares (streaming.md 5.6): G segments a side, 32 on full and 16 on lite,
// with a skirt below the boundary (rule 8). Vertices carry integers only, (k, l, role), and the
// vertex shader places them. Every quad splits along corner (k, l)-(k+1, l+1) (rule 5), and every
// triangle winds counter-clockwise seen from outside the globe, since U × V = C on every face.

export const GRID_SEGMENTS = { lite: 16, full: 32 } as const;
export type Segments = (typeof GRID_SEGMENTS)[keyof typeof GRID_SEGMENTS];

/** A vertex's role: on the surface, or a skirt bottom hanging below a boundary vertex. */
export const SURFACE = 0;
export const SKIRT = 1;

export interface TileGrid {
  segments: Segments;
  vertexCount: number;
  /** (k, l, role) per vertex. A skirt bottom carries its top's (k, l). */
  position: Uint8Array;
  /**
   * A constant (0, 0, 127) per vertex. The shader writes the real, radial normal; the attribute
   * only keeps three from shading flat and dropping the shadow normal bias (5.8).
   */
  normal: Int8Array;
  index: Uint16Array;
}

/**
 * Surface vertices row-major, v = l·(G + 1) + k, then 4G skirt bottoms in counter-clockwise ring
 * order from (0, 0): along S (l = 0) east, E (k = G) north, N (l = G) west, W (k = 0) south.
 */
export function buildTileGrid(segments: Segments): TileGrid {
  const G = segments;
  const side = G + 1;
  const ring = boundaryRing(G);
  const vertexCount = side * side + ring.length;
  const position = new Uint8Array(3 * vertexCount);
  for (let l = 0; l <= G; l += 1) {
    for (let k = 0; k <= G; k += 1) position.set([k, l, SURFACE], 3 * (l * side + k));
  }
  ring.forEach(([k, l], i) => position.set([k, l, SKIRT], 3 * (side * side + i)));

  const index = new Uint16Array(6 * G * G + 6 * ring.length);
  let at = 0;
  const triangle = (a: number, b: number, c: number) => {
    index.set([a, b, c], at);
    at += 3;
  };
  for (let l = 0; l < G; l += 1) {
    for (let k = 0; k < G; k += 1) {
      const v00 = l * side + k;
      const v10 = v00 + 1;
      const v01 = v00 + side;
      const v11 = v01 + 1;
      triangle(v00, v10, v11);
      triangle(v00, v11, v01);
    }
  }
  // Each ring step a → b hangs a wall from the tops to their bottoms, facing outward.
  ring.forEach(([k, l], i) => {
    const [nk, nl] = ring[(i + 1) % ring.length] ?? [0, 0];
    const a = l * side + k;
    const b = nl * side + nk;
    const aBottom = side * side + i;
    const bBottom = side * side + ((i + 1) % ring.length);
    triangle(a, aBottom, bBottom);
    triangle(a, bBottom, b);
  });

  const normal = new Int8Array(3 * vertexCount);
  for (let v = 0; v < vertexCount; v += 1) normal[3 * v + 2] = 127;
  return { segments, vertexCount, position, normal, index };
}

/** The boundary's (k, l), counter-clockwise from (0, 0). */
function boundaryRing(G: number): [number, number][] {
  const ring: [number, number][] = [];
  for (let k = 0; k < G; k += 1) ring.push([k, 0]);
  for (let l = 0; l < G; l += 1) ring.push([G, l]);
  for (let k = G; k > 0; k -= 1) ring.push([k, G]);
  for (let l = G; l > 0; l -= 1) ring.push([0, l]);
  return ring;
}
