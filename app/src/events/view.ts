import type { Extent } from './page';

/**
 * Plain camera data in globe-local three.js coordinates with unit radius: north is +Y,
 * Greenwich +Z and 90° east +X (surface/cube.ts). No three.js objects cross the worker boundary.
 * Width, height and projected anchors are CSS pixels, independent of device pixel ratio.
 * Projection and horizon culling use the unit sphere; the renderer supplies terrain height.
 */
export interface EventView {
  /** Column-major projection * view * globe-world matrix, mapping the unit globe to clip space. */
  matrix: number[];
  /** Camera world position transformed by inverse globe-world, for the spherical horizon. */
  camera: [number, number, number];
  width: number;
  height: number;
}
export interface ScreenPoint {
  x: number;
  y: number;
  visible: boolean;
}

export function project(view: EventView, lon: number, lat: number): ScreenPoint | undefined {
  return projectSphere(view, lon, lat, true);
}

function projectSphere(
  view: EventView,
  lon: number,
  lat: number,
  cull: boolean,
): ScreenPoint | undefined {
  const phi = (lat * Math.PI) / 180,
    lambda = (lon * Math.PI) / 180;
  // toThree(lonLatToDir()): Z at Greenwich, Y north, X at 90° east.
  const x = Math.cos(phi) * Math.sin(lambda),
    y = Math.sin(phi),
    z = Math.cos(phi) * Math.cos(lambda);
  const m = view.matrix;
  const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
  if (w <= 0 || (cull && x * view.camera[0] + y * view.camera[1] + z * view.camera[2] < 1))
    return undefined;
  const nx = (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w;
  const ny = (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w;
  const nz = (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) / w;
  if (cull && (nz < -1 || nz > 1)) return undefined;
  return {
    x: ((nx + 1) * view.width) / 2,
    y: ((1 - ny) * view.height) / 2,
    visible: Math.abs(nx) <= 1 && Math.abs(ny) <= 1,
  };
}

/** Sample the bbox on a 5×5 lattice without dateline wrapping. Measure through the horizon:
 * a close view inside a large war must still split even if all samples are outside that view. */
export function extentPixels(view: EventView, extent: Extent): number {
  const [w, s, e, n] = extent;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let a = 0; a <= 4; a++)
    for (let b = 0; b <= 4; b++) {
      const point = projectSphere(view, w + ((e - w) * a) / 4, s + ((n - s) * b) / 4, false);
      if (!point) continue;
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
  return minX === Infinity ? 0 : Math.max(maxX - minX, maxY - minY);
}

export function validateView(view: EventView): void {
  if (
    view.matrix.length !== 16 ||
    view.camera.length !== 3 ||
    ![...view.matrix, ...view.camera, view.width, view.height].every(Number.isFinite) ||
    view.width <= 0 ||
    view.height <= 0
  )
    throw new Error('invalid event view');
}
