// A camera pose for a view (streaming.md 5.7) on synthetic ceiling fields: it frames the view's
// width, stays clear of the terrain, caps its tilt only when a ridge is in the way, and moves
// continuously as the view moves.
import { describe, expect, test } from 'vitest';
import { tunables } from '../config/tunables';
import { lonLatToDir, toThree, type Vec3 } from '../surface/cube';
import { EARTH_RADIUS_KM, viewPose, type Lens, type View } from './viewCamera';

const lens: Lens = { fovYDeg: 30, aspect: 1440 / 900 };
const relief = { kLand: 16, kSeaEff: 16 };
const clearance = tunables.cameraClearance;

type Field = Parameters<typeof viewPose>[2];

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => Math.sqrt(dot(a, a));
const angle = (a: Vec3, b: Vec3) => Math.acos(Math.min(1, dot(a, b) / (len(a) * len(b))));

const flat: Field = { ceilingM: () => 0, hMin: 0, hMax: 0 };

/** A peak of `m` meters at `peak`, reached within the cap and falling off over 0.01 rad. */
function spike(peak: Vec3, m: number): Field {
  return {
    ceilingM: (dir, cap, kLand) =>
      kLand * m * Math.max(0, 1 - Math.max(0, angle(dir, peak) - cap) / 0.01),
    hMin: 0,
    hMax: m,
  };
}

/** A ridge of `m` meters at every direction whose longitude is below `lon`. */
function ridge(lon: number, m: number): Field {
  return {
    ceilingM: (dir, cap, kLand) => {
      const dirLon = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI;
      const reach = (lon - dirLon) * (Math.PI / 180) + cap;
      return kLand * m * Math.min(1, Math.max(0, reach / 0.002));
    },
    hMin: 0,
    hMax: m,
  };
}

const tambora: View = { lon: 118, lat: -8.25, viewKm: 30, tiltDeg: 0, headingDeg: 0 };
const altitudeKm = (position: Vec3) => (len(position) - 1) * EARTH_RADIUS_KM;
const hfov = 2 * Math.atan(Math.tan((lens.fovYDeg * Math.PI) / 360) * lens.aspect);

describe('on a flat globe at no relief', () => {
  test('frames the view width at the target, with no lift', () => {
    for (const viewKm of [30, 300, 3000]) {
      const pose = viewPose({ ...tambora, viewKm }, lens, flat, { kLand: 0, kSeaEff: 0 });
      const distance = len(sub(pose.position, pose.target)) * EARTH_RADIUS_KM;
      expect(2 * distance * Math.tan(hfov / 2)).toBeCloseTo(viewKm, 6);
      expect(pose.liftKm).toBe(0);
    }
  });

  test('keeps the requested tilt and heading', () => {
    const pose = viewPose({ ...tambora, tiltDeg: 45, headingDeg: 90 }, lens, flat, relief);
    expect(pose.tiltDeg).toBeCloseTo(45, 9);
    // Looking east, the camera sits west of the target.
    const west = toThree(lonLatToDir(117, -8.25));
    expect(dot(sub(pose.position, pose.target), west)).toBeGreaterThan(0);
  });
});

describe('over a 3 km peak at ×16', () => {
  const peak = lonLatToDir(118, -8.25);
  const field = spike(peak, 3000);

  test('puts the target on the ceiling at the view center', () => {
    const pose = viewPose(tambora, lens, field, relief);
    const ground = field.ceilingM(peak, tambora.viewKm / 8 / EARTH_RADIUS_KM, relief.kLand);
    expect(len(pose.target)).toBeCloseTo(1 + ground / 1000 / EARTH_RADIUS_KM, 12);
    expect(angle(pose.target, toThree(peak))).toBeLessThan(1e-12);
  });

  test('keeps the camera clear of the ceiling around it by the margin', () => {
    const pose = viewPose(tambora, lens, field, relief);
    const d0 = tambora.viewKm / 2 / Math.tan(hfov / 2);
    const margin = Math.max(clearance.minKm, clearance.ofView * d0);
    expect(altitudeKm(pose.position)).toBeGreaterThanOrEqual((16 * 3000) / 1000 + margin - 1e-6);
  });

  test('slides a steeply tilted camera back along its ray until it clears', () => {
    const view = { ...tambora, tiltDeg: 80 };
    const pose = viewPose(view, lens, field, relief);
    const d0 = tambora.viewKm / 2 / Math.tan(hfov / 2);
    expect(pose.tiltDeg).toBeCloseTo(80, 9);
    expect(pose.liftKm).toBeGreaterThan(0);
    const margin = Math.max(clearance.minKm, clearance.ofView * d0);
    expect(altitudeKm(pose.position)).toBeGreaterThanOrEqual((16 * 3000) / 1000 + margin - 1e-6);
  });

  test('sets near inside the gap and far past the displaced horizon', () => {
    const pose = viewPose(tambora, lens, field, relief);
    const gap = altitudeKm(pose.position) / EARTH_RADIUS_KM - (16 * 3) / EARTH_RADIUS_KM;
    expect(pose.near).toBeGreaterThan(0);
    expect(pose.near).toBeLessThanOrEqual(gap / 2 + 1e-12);
    const r = len(pose.position);
    expect(pose.far).toBeGreaterThanOrEqual(Math.sqrt(r * r - 1));
  });
});

describe('a ridge between the target and the camera', () => {
  // Looking east from 118°E, the camera leans back west, over the ridge west of 117.9°E.
  const field = ridge(117.9, 4000);
  const view = { ...tambora, viewKm: 100, tiltDeg: 70, headingDeg: 90 };

  test('caps the tilt so the view line clears the ridge by lineDeg', () => {
    const pose = viewPose(view, lens, field, relief);
    expect(pose.tiltDeg).toBeLessThan(70);
    expect(viewPose(view, lens, flat, relief).tiltDeg).toBeCloseTo(70, 9);
    // Along the line from the target back toward the camera, the ridge's elevation seen from the
    // target stays lineDeg below the line's.
    const cap = view.viewKm / 8 / EARTH_RADIUS_KM;
    const ground = field.ceilingM(lonLatToDir(118, -8.25), cap, relief.kLand) / 1000;
    const lineElevation = 90 - pose.tiltDeg;
    for (let km = 1; km <= 40; km += 1) {
      const dir = lonLatToDir(118 - km / (111.32 * Math.cos((8.25 * Math.PI) / 180)), -8.25);
      const rise =
        field.ceilingM(dir, cap, relief.kLand) / 1000 - ground - (km * km) / (2 * EARTH_RADIUS_KM);
      const elevation = (Math.atan2(rise, km) * 180) / Math.PI;
      expect(elevation, `${km} km back`).toBeLessThanOrEqual(
        lineElevation - clearance.lineDeg + 0.5,
      );
    }
  });

  test('does not cap a view that looks the other way', () => {
    const pose = viewPose({ ...view, headingDeg: 270 }, lens, field, relief);
    expect(pose.tiltDeg).toBeCloseTo(70, 9);
  });
});

test('the pose moves continuously as the view moves across the peak', () => {
  const field = spike(lonLatToDir(118, -8.25), 3000);
  let previous = viewPose({ ...tambora, lon: 117.8, tiltDeg: 40 }, lens, field, relief);
  for (let i = 1; i <= 400; i += 1) {
    const view = { ...tambora, lon: 117.8 + i * 0.001, tiltDeg: 40 };
    const pose = viewPose(view, lens, field, relief);
    // 0.001° is 111 m along the ground; the camera may move a few times that, never a jump.
    expect(len(sub(pose.position, previous.position)) * EARTH_RADIUS_KM).toBeLessThan(2);
    previous = pose;
  }
});
