// A camera pose for a view (streaming.md 5.7) on synthetic ceiling fields: it frames the view's
// width, faces its heading with the heading up the screen, stays clear of the terrain over its own
// footprint, keeps the target in sight, caps its tilt only as far as a ridge needs, and moves
// continuously as the view moves, through the tilt cap's and the slide's onsets and the poles.
import { describe, expect, test } from 'vitest';
import { tunables } from '../config/tunables';
import { lonLatToDir, toThree, type Vec3 } from '../surface/cube';
import { EARTH_RADIUS_KM, viewPose, type CameraPose, type Lens, type View } from './viewCamera';

const lens: Lens = { fovYDeg: 30, aspect: 1440 / 900 };
const relief = { kLand: 16, kSeaEff: 16 };
const clearance = tunables.cameraClearance;
const R = EARTH_RADIUS_KM;

type Field = Parameters<typeof viewPose>[2];

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => Math.sqrt(dot(a, a));
const unit = (a: Vec3): Vec3 => [a[0] / len(a), a[1] / len(a), a[2] / len(a)];
const angle = (a: Vec3, b: Vec3) => Math.acos(Math.min(1, dot(a, b) / (len(a) * len(b))));
/** The globe frame G of a three.js-space vector. */
const toG = (p: Vec3): Vec3 => [p[2], p[0], p[1]];

const flat: Field = { ceilingM: () => 0, hMin: 0, hMax: 0 };

/** Discs of `m` meters and radius `rKm`, fading over the cap as ClearanceField's nodes do. */
function discs(list: { at: Vec3; m: number; rKm: number }[]): Field {
  return {
    ceilingM: (dir, cap, kLand) => {
      let high = 0;
      for (const { at, m, rKm } of list) {
        const u = Math.max(0, angle(dir, at) - rKm / R) / cap;
        const w = u <= 1 ? 1 : u >= 2 ? 0 : 1 - (u - 1) ** 2 * (3 - 2 * (u - 1));
        high = Math.max(high, w * kLand * m);
      }
      return high;
    },
    hMin: 0,
    hMax: Math.max(...list.map((d) => d.m)),
  };
}

const tambora: View = { lon: 118, lat: -8.25, viewKm: 30, tiltDeg: 0, headingDeg: 0 };
const altitudeKm = (position: Vec3) => (len(position) - 1) * R;
const hfov = 2 * Math.atan(Math.tan((lens.fovYDeg * Math.PI) / 360) * lens.aspect);
/** A point `km` west of Tambora along its parallel. */
const west = (km: number) =>
  lonLatToDir(118 - km / (111.32 * Math.cos((8.25 * Math.PI) / 180)), -8.25);

/** Whether every point of the segment from the target to the camera stands above the ceiling. */
function lineClears(pose: CameraPose, field: Field): boolean {
  for (let i = 1; i < 200; i += 1) {
    const p = pose.target.map((v, j) => v + ((pose.position[j] ?? 0) - v) * (i / 200)) as Vec3;
    const ground = field.ceilingM(unit(toG(p)), 0.5 / R, relief.kLand) / 1000;
    if (altitudeKm(p) < ground) return false;
  }
  return true;
}

describe('on a flat globe', () => {
  test('frames the view width at the target, with no slide', () => {
    for (const viewKm of [30, 300, 3000]) {
      const pose = viewPose({ ...tambora, viewKm }, lens, flat, { kLand: 0, kSeaEff: 0 });
      const distance = len(sub(pose.position, pose.target)) * R;
      expect(2 * distance * Math.tan(hfov / 2)).toBeCloseTo(viewKm, 6);
      expect(pose.liftKm).toBe(0);
    }
  });

  test('sits opposite the heading, with the heading up the screen', () => {
    const target = toThree(lonLatToDir(118, -8.25));
    const westward = unit(sub(toThree(west(1)), target));
    for (const [heading, sign] of [
      [90, 1],
      [270, -1],
    ] as const) {
      const pose = viewPose({ ...tambora, tiltDeg: 45, headingDeg: heading }, lens, flat, relief);
      expect(pose.tiltDeg).toBeCloseTo(45, 9);
      // Looking east, the camera sits west of the target; looking west, east of it.
      expect(sign * dot(sub(pose.position, pose.target), westward)).toBeGreaterThan(0);
      // Up is a unit vector across the line of sight, leaning toward the heading.
      expect(len(pose.up)).toBeCloseTo(1, 12);
      expect(dot(pose.up, unit(sub(pose.target, pose.position)))).toBeCloseTo(0, 12);
      expect(-sign * dot(pose.up, westward)).toBeGreaterThan(0);
    }
  });

  test('looks straight down with north up at tilt 0, heading 0', () => {
    const pose = viewPose(tambora, lens, flat, relief);
    const north = unit(sub(toThree(lonLatToDir(118, -8.24)), toThree(lonLatToDir(118, -8.25))));
    expect(dot(pose.up, north)).toBeCloseTo(1, 6);
  });
});

describe('over a 3 km peak at ×16', () => {
  const peak = lonLatToDir(118, -8.25);
  const field = discs([{ at: peak, m: 3000, rKm: 2 }]);

  test('puts the target on the ceiling at the view center', () => {
    const pose = viewPose(tambora, lens, field, relief);
    const ground = field.ceilingM(peak, tambora.viewKm / 8 / R, relief.kLand);
    expect(len(pose.target)).toBeCloseTo(1 + ground / 1000 / R, 12);
    expect(angle(pose.target, toThree(peak))).toBeLessThan(1e-12);
  });

  test('slides a steeply tilted camera back until it clears the ceiling over its footprint', () => {
    const pose = viewPose({ ...tambora, tiltDeg: 80 }, lens, field, relief);
    const d0 = tambora.viewKm / 2 / Math.tan(hfov / 2);
    const margin = Math.max(clearance.minKm, clearance.ofView * d0);
    expect(pose.liftKm).toBeGreaterThan(0);
    const below = field.ceilingM(toG(unit(pose.position)), 1 / R, relief.kLand) / 1000;
    expect(altitudeKm(pose.position)).toBeGreaterThanOrEqual(below + margin - 1e-6);
  });

  test('sets near inside the gap and far past the displaced horizon', () => {
    const pose = viewPose(tambora, lens, field, relief);
    const gap = (altitudeKm(pose.position) - (16 * 3000) / 1000) / R;
    expect(pose.near).toBeGreaterThan(0);
    expect(pose.near).toBeLessThanOrEqual(gap / 2 + 1e-12);
    const r = len(pose.position);
    const high = 1 + (16 * 3) / R;
    expect(pose.far).toBeGreaterThanOrEqual(
      Math.sqrt(r * r - 1) + Math.sqrt(high * high - 1) - 1e-12,
    );
  });
});

describe('ridges behind the target', () => {
  test('over ground rising away from the target, clears the ceiling beneath it at every tilt', () => {
    // Peaks every 10 km, 12.5 m higher per km out to 5 km at 400 km: each slide's larger cap sees
    // higher ground, so the camera needs several before the cap it read covers where it sits.
    const ramp = [];
    for (let km = 40; km <= 400; km += 10) ramp.push({ at: west(km), m: 12.5 * km, rKm: 3 });
    const field = discs(ramp);
    const x8 = { kLand: 8, kSeaEff: 8 };
    const d0 = tambora.viewKm / 2 / Math.tan(hfov / 2);
    const margin = Math.max(clearance.minKm, clearance.ofView * d0);
    for (let tiltDeg = 60; tiltDeg <= 88; tiltDeg += 0.5) {
      const pose = viewPose({ ...tambora, tiltDeg, headingDeg: 90 }, lens, field, x8);
      const below = field.ceilingM(toG(unit(pose.position)), 1 / R, x8.kLand) / 1000;
      expect(altitudeKm(pose.position), `tilt ${tiltDeg}`).toBeGreaterThanOrEqual(
        below + margin - 1e-6,
      );
    }
  });

  test('caps the tilt only as far as the view line needs to clear a ridge', () => {
    // 40 km back: past the target's own cap (12.5 km, fading out by 25), so the target stays low.
    const field = discs([{ at: west(40), m: 4000, rKm: 3 }]);
    const view = { ...tambora, viewKm: 100, tiltDeg: 70, headingDeg: 90 };
    const pose = viewPose(view, lens, field, relief);
    expect(pose.tiltDeg).toBeLessThan(70);
    expect(viewPose(view, lens, flat, relief).tiltDeg).toBeCloseTo(70, 9);
    expect(lineClears(pose, field)).toBe(true);
    // The ridge's elevation seen from the target comes within a degree of the line less lineDeg,
    // so the cap is no deeper than the ridge asks.
    const cap = view.viewKm / 8 / R;
    const ground = field.ceilingM(lonLatToDir(118, -8.25), cap, relief.kLand) / 1000;
    let steepest = 0;
    for (let km = 0.25; km <= 200; km += 0.25) {
      const rise = field.ceilingM(west(km), cap, relief.kLand) / 1000 - ground;
      steepest = Math.max(steepest, (Math.atan2(rise - (km * km) / (2 * R), km) * 180) / Math.PI);
    }
    expect(90 - pose.tiltDeg).toBeLessThanOrEqual(steepest + clearance.lineDeg + 1);
  });

  test('does not cap a view that looks the other way', () => {
    const field = discs([{ at: west(40), m: 4000, rKm: 3 }]);
    const view = { ...tambora, viewKm: 100, tiltDeg: 70, headingDeg: 270 };
    expect(viewPose(view, lens, field, relief).tiltDeg).toBeCloseTo(70, 9);
  });
});

describe('continuity', () => {
  const step = (a: CameraPose, b: CameraPose) => len(sub(a.position, b.position)) * R;

  test('as the view moves across a peak', () => {
    const field = discs([{ at: lonLatToDir(118, -8.25), m: 3000, rKm: 2 }]);
    // The target rides a ceiling that climbs 48 km over its 3.75 km cap, with smoothstep's slope
    // of 1.5 at most: about 2 km per 0.001° step, and the camera moves with it.
    const slope = (1.5 * 16 * 3) / (tambora.viewKm / 8);
    const bound = 1.5 * slope * 0.111;
    let previous = viewPose({ ...tambora, lon: 117.8, tiltDeg: 40 }, lens, field, relief);
    for (let i = 1; i <= 400; i += 1) {
      const view = { ...tambora, lon: 117.8 + i * 0.001, tiltDeg: 40 };
      const pose = viewPose(view, lens, field, relief);
      expect(step(pose, previous)).toBeLessThan(bound);
      previous = pose;
    }
  });

  test('as the tilt grows through the tilt cap’s onset', () => {
    const field = discs([{ at: west(40), m: 4000, rKm: 3 }]);
    const view = { ...tambora, viewKm: 100, headingDeg: 90 };
    let previous = viewPose({ ...view, tiltDeg: 2 }, lens, field, relief);
    let capped = false;
    let free = false;
    for (let tilt = 2.05; tilt <= 60; tilt += 0.05) {
      const pose = viewPose({ ...view, tiltDeg: tilt }, lens, field, relief);
      if (pose.tiltDeg < tilt - 1e-9) capped = true;
      else free = true;
      // The capped tilt follows the ridge's elevation over a reach that grows with the request.
      expect(Math.abs(pose.tiltDeg - previous.tiltDeg)).toBeLessThan(0.2);
      expect(step(pose, previous)).toBeLessThan(1);
      previous = pose;
    }
    expect({ capped, free }).toEqual({ capped: true, free: true });
  });

  test('as the tilt grows through the slide’s onset', () => {
    const field = discs([{ at: lonLatToDir(118, -8.25), m: 3000, rKm: 2 }]);
    let previous = viewPose({ ...tambora, tiltDeg: 50 }, lens, field, relief);
    let slid = false;
    for (let tilt = 50.05; tilt <= 85; tilt += 0.05) {
      const pose = viewPose({ ...tambora, tiltDeg: tilt }, lens, field, relief);
      if (pose.liftKm > 0) slid = true;
      expect(Math.abs(pose.liftKm - previous.liftKm)).toBeLessThan(1);
      expect(step(pose, previous)).toBeLessThan(1);
      previous = pose;
    }
    expect(slid).toBe(true);
  });

  test('through a pole, whatever the longitude', () => {
    for (const lon of [0, 90, -135]) {
      const view = { ...tambora, lon, viewKm: 300, tiltDeg: 45 };
      const at = viewPose({ ...view, lat: 90 }, lens, flat, relief);
      const near = viewPose({ ...view, lat: 90 - 1e-7 }, lens, flat, relief);
      expect(step(at, near)).toBeLessThan(0.01);
      expect(angle(at.up, near.up)).toBeLessThan(1e-6);
    }
  });
});
