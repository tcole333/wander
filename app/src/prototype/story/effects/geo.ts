// Places on the globe frame (contract.ts: three.js axes, north +Y, 0E +Z, radius 1) and on the
// sphere, for the walk's effects.
import { Vector3 } from 'three';
import type { LonLat } from '../story';

export const EARTH_KM = 6371.0088;
export const EARTH_M = EARTH_KM * 1000;
const DEG = Math.PI / 180;

/** The unit direction of a place in the globe frame. */
export function dirOf([lon, lat]: LonLat, out = new Vector3()): Vector3 {
  const cosLat = Math.cos(lat * DEG);
  return out.set(cosLat * Math.sin(lon * DEG), Math.sin(lat * DEG), cosLat * Math.cos(lon * DEG));
}

/** The east and north unit tangents at a place. */
export function tangents([lon, lat]: LonLat): { east: Vector3; north: Vector3 } {
  const [l, p] = [lon * DEG, lat * DEG];
  return {
    east: new Vector3(Math.cos(l), 0, -Math.sin(l)),
    north: new Vector3(-Math.sin(p) * Math.sin(l), Math.cos(p), -Math.sin(p) * Math.cos(l)),
  };
}

/** The great-circle distance between two places, km. */
export function arcKm(a: LonLat, b: LonLat): number {
  const cos = dirOf(a).dot(dirOf(b));
  return Math.acos(Math.min(1, Math.max(-1, cos))) * EARTH_KM;
}

/**
 * The cosine of the angle between the way from `from` toward `to` and a horizontal direction
 * (east, north) at `from`, 1 when `to` lies straight along it.
 */
export function cosOffAxis(from: LonLat, to: LonLat, [east, north]: [number, number]): number {
  const a = dirOf(from);
  const b = dirOf(to);
  const toward = b.sub(a.clone().multiplyScalar(a.dot(b)));
  if (toward.lengthSq() < 1e-14) return 1;
  const { east: e, north: n } = tangents(from);
  const axis = e.multiplyScalar(east).add(n.multiplyScalar(north)).normalize();
  return toward.normalize().dot(axis);
}
