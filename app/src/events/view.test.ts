// The event query's view against three's own projection: a lamp-lit globe mount turned and moved
// as the museum's gimbal turns it, a camera with the lobby's lens offset, and the frame the boot
// places each frame. Every event must land where three puts its point, lens offset included, and
// the far side must fall behind the horizon.
import { describe, expect, it } from 'vitest';
import { Group, PerspectiveCamera, Scene, Vector3 } from 'three';
import { FrameContext } from '../scene/frameContext';
import { lonLatToDir, toThree } from '../surface/cube';
import { eventViewOf, project } from './view';

const WIDTH = 1440;
const HEIGHT = 900;

/** The globe hung off center and turned, the camera 4 radii from it, the lens shifted `shift` px. */
function framed(shift: number): { frame: FrameContext; cam: PerspectiveCamera; globe: Group } {
  const scene = new Scene();
  const mount = new Group();
  mount.position.set(0.3, -0.2, 0.1);
  mount.rotation.set(0.4, -1.1, 0.2);
  scene.add(mount);
  const globe = new Group();
  mount.add(globe);
  const cam = new PerspectiveCamera(30, WIDTH / HEIGHT, 0.01, 100);
  cam.position.set(1.5, 1, 4);
  cam.lookAt(mount.position);
  cam.setViewOffset(WIDTH, HEIGHT, -shift, 0, WIDTH, HEIGHT);
  scene.updateMatrixWorld(true);
  const frame = new FrameContext();
  frame.place(cam, globe, { width: WIDTH, height: HEIGHT });
  return { frame, cam, globe };
}

/** Where three draws the globe's point at (lon, lat), in CSS px, and whether it faces the camera. */
function threeProjects(cam: PerspectiveCamera, globe: Group, lon: number, lat: number) {
  const local = new Vector3(...toThree(lonLatToDir(lon, lat)));
  const world = globe.localToWorld(local.clone());
  const ndc = world.clone().project(cam);
  const toCamera = globe.worldToLocal(cam.getWorldPosition(new Vector3())).sub(local);
  return {
    x: ((ndc.x + 1) * WIDTH) / 2,
    y: ((1 - ndc.y) * HEIGHT) / 2,
    faces: toCamera.dot(local) > 0,
  };
}

/** A lattice over the whole globe. */
const PLACES = Array.from({ length: 12 * 7 }, (_, i) => {
  const lon = -165 + 30 * (i % 12);
  const lat = -75 + 25 * Math.floor(i / 12);
  return [lon, lat] as const;
});

describe('eventViewOf', () => {
  it.each([0, 180])('projects every event as three does, with the lens %s px right', (shift) => {
    const { frame, cam, globe } = framed(shift);
    const view = eventViewOf(frame);
    expect(view.width).toBe(WIDTH);
    expect(view.height).toBe(HEIGHT);
    let near = 0;
    for (const [lon, lat] of PLACES) {
      const expected = threeProjects(cam, globe, lon, lat);
      const point = project(view, lon, lat);
      if (!expected.faces) {
        expect(point, `${lon}, ${lat} lies past the horizon`).toBeUndefined();
        continue;
      }
      near++;
      expect(point, `${lon}, ${lat} faces the camera`).toBeDefined();
      expect(point!.x).toBeCloseTo(expected.x, 6);
      expect(point!.y).toBeCloseTo(expected.y, 6);
    }
    // The camera sees about a third of the globe: the lattice tests both sides.
    expect(near).toBeGreaterThan(15);
    expect(near).toBeLessThan(PLACES.length - 15);
  });

  it('carries the lens offset: every event moves right by the shift, and no further', () => {
    const { frame } = framed(0);
    const plain = eventViewOf(frame);
    const shifted = eventViewOf(framed(180).frame);
    // The point under the camera, and one off to its side.
    const under = frame.camera.clone().normalize();
    const lon = (Math.atan2(under.x, under.z) * 180) / Math.PI + 20;
    const lat = (Math.asin(under.y) * 180) / Math.PI - 10;
    const a = project(plain, lon, lat);
    const b = project(shifted, lon, lat);
    expect(a && b).toBeTruthy();
    expect(b!.x - a!.x).toBeCloseTo(180, 6);
    expect(b!.y).toBeCloseTo(a!.y, 6);
  });

  it('refuses a frame not yet placed', () => {
    expect(() => eventViewOf(new FrameContext())).toThrow('not been placed');
  });
});
