// A camera pose for a view (streaming.md 5.7, Camera clearance): the view's center, width, tilt and
// heading become a position, target, up and near/far in globe-local three.js space (R = 1). The
// target sits on the terrain ceiling, the tilt is capped so the line from the target to the
// camera clears the terrain between them, and the camera slides back along its ray until it is
// high enough above the ceiling around it. Every step is continuous in the view, so a flight or a
// gesture never sees the camera jump.
import { tunables } from '../config/tunables';
import { lonLatToDir, toThree, type Vec3 } from '../surface/cube';
import type { ClearanceField } from './clearance';

export const EARTH_RADIUS_KM = 6371.0088;

export interface View {
  lon: number;
  lat: number;
  /** The visible width at the target, across the viewport, in km. */
  viewKm: number;
  /** 0 looks straight down; the camera leans back from the heading as it grows. */
  tiltDeg: number;
  /** The compass direction the camera looks, degrees clockwise from north. */
  headingDeg: number;
}

export interface Lens {
  fovYDeg: number;
  aspect: number;
}

export interface CameraPose {
  position: Vec3;
  target: Vec3;
  up: Vec3;
  near: number;
  far: number;
  /** The tilt after the cap. */
  tiltDeg: number;
  /** How far the camera slid back past the view's own distance, in km. */
  liftKm: number;
}

type Field = Pick<ClearanceField, 'ceilingM' | 'hMin' | 'hMax'>;
type Clearance = typeof tunables.cameraClearance;

/**
 * The samples along the view line checked for terrain in the way, spaced quadratically so the
 * first lies 1/256 of the way back: a rise just behind the target, outside its own cap, is the
 * likeliest to block the view.
 */
const LINE_SAMPLES = 16;

export function viewPose(
  view: View,
  lens: Lens,
  field: Field,
  relief: { kLand: number; kSeaEff: number },
  clearance: Clearance = tunables.cameraClearance,
): CameraPose {
  const R = EARTH_RADIUS_KM;
  const toRad = Math.PI / 180;
  const hfov = 2 * Math.atan(Math.tan((lens.fovYDeg * toRad) / 2) * lens.aspect);
  const d0 = view.viewKm / 2 / Math.tan(hfov / 2);
  const g = lonLatToDir(view.lon, view.lat);
  const ceiling = (dir: Vec3, capKm: number) =>
    field.ceilingM(dir, Math.max(capKm, 1e-3) / R, relief.kLand) / 1000;

  // The target, on the ceiling at the view's center.
  const groundKm = ceiling(g, view.viewKm / 8);
  const { north, east } = tangentFrame(g);
  const heading = view.headingDeg * toRad;
  const forward = add(scale(north, Math.cos(heading)), scale(east, Math.sin(heading)));

  // The tilt cap: the view line from the target back toward the camera must clear every sample
  // of the ceiling under it by lineDeg, counting the globe's curvature.
  const requested = view.tiltDeg * toRad;
  let steepest = 0;
  for (let i = 1; i <= LINE_SAMPLES; i += 1) {
    const x = d0 * Math.sin(requested) * (i / LINE_SAMPLES) ** 2;
    const dir = along(g, scale(forward, -1), x / R);
    const rise = ceiling(dir, view.viewKm / 8) - groundKm - (x * x) / (2 * R);
    steepest = Math.max(steepest, Math.atan2(rise, x));
  }
  const tilt = Math.max(0, Math.min(requested, Math.PI / 2 - steepest - clearance.lineDeg * toRad));

  // The camera, on its ray from the target, slid back until it clears the ceiling around it.
  const target = scale(g, 1 + groundKm / R);
  const ray = normalize(add(scale(g, Math.cos(tilt)), scale(forward, -Math.sin(tilt))));
  const margin = Math.max(clearance.minKm, clearance.ofView * d0);
  let distance = d0;
  let highKm = groundKm;
  for (let pass = 0; pass < 2; pass += 1) {
    highKm = ceiling(g, distance * (Math.sin(tilt) + Math.cos(tilt)));
    const need = 1 + (highKm + margin) / R;
    distance = Math.max(d0, reachRadius(target, ray, need) * R);
  }
  const position = add(target, scale(ray, distance / R));

  const radius = length(position);
  const low = 1 + Math.min(0, relief.kSeaEff * field.hMin) / 1000 / R;
  const high = 1 + Math.max(0, relief.kLand * field.hMax) / 1000 / R;
  const up = normalize(add(scale(g, Math.sin(tilt)), scale(forward, Math.cos(tilt))));
  return {
    position: toThree(position),
    target: toThree(target),
    up: toThree(up),
    near: 0.5 * (radius - 1 - highKm / R),
    far: Math.sqrt(radius * radius - low * low) + Math.sqrt(high * high - low * low),
    tiltDeg: tilt / toRad,
    liftKm: distance - d0,
  };
}

/** The distance along `ray` from `from` at which the radius first reaches `need` (0 if it has). */
function reachRadius(from: Vec3, ray: Vec3, need: number): number {
  const b = dot(from, ray);
  const c = dot(from, from) - need * need;
  if (c >= 0) return 0;
  return -b + Math.sqrt(b * b - c);
}

/** North and east at `g` (globe frame G, +Z north); at a pole, north is +X's meridian. */
function tangentFrame(g: Vec3): { north: Vec3; east: Vec3 } {
  const pole: Vec3 = [0, 0, 1];
  let east = cross(pole, g);
  if (length(east) < 1e-12) east = [0, 1, 0];
  east = normalize(east);
  return { north: normalize(cross(g, east)), east };
}

/** The point `angle` radians from `g` toward the tangent direction `toward`. */
function along(g: Vec3, toward: Vec3, angle: number): Vec3 {
  return normalize(add(scale(g, Math.cos(angle)), scale(toward, Math.sin(angle))));
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function scale(a: Vec3, k: number): Vec3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function length(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}
function normalize(a: Vec3): Vec3 {
  return scale(a, 1 / length(a));
}
