import { Object3D, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { RouteData } from '../../data/route';
import { dirOf } from './geo';
import { routeFrame } from './route';
import { fleetCourse, shipPlacement, type ShipView } from './ship';

function projection(): ShipView {
  const camera = new PerspectiveCamera(40, 1.6, 0.01, 100);
  camera.position.set(0, 0, 3);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const globe = new Object3D();
  globe.updateMatrixWorld();
  return {
    camera,
    cameraLocal: camera.position.clone(),
    globe,
    viewport: { width: 1440, height: 900 },
    elapsedS: 0,
  };
}

const route: RouteData = {
  v: 1,
  epochDay: 0,
  labels: [],
  pts: [
    [10, 0, 0, 0],
    [0, 0, 10, 0],
    [0, 0, 150, 0],
    [-10, 0, 160, 0],
  ],
};

describe('the fleet ship on the globe', () => {
  it('hides behind the horizon and fades as it nears the limb', () => {
    const view = projection();
    expect(shipPlacement(dirOf([0, 0]), null, view).opacity).toBe(1);
    expect(shipPlacement(dirOf([180, 0]), null, view).opacity).toBe(0);
    expect(shipPlacement(dirOf([90, 0]), null, view).opacity).toBe(0);
    const grazing = shipPlacement(dirOf([70, 0]), null, view).opacity;
    expect(grazing).toBeGreaterThan(0);
    expect(grazing).toBeLessThan(1);
  });

  it('mirrors westward sailing and faces east when retracing the route', () => {
    const frame = routeFrame(route, 5, 7);
    const course = fleetCourse(route, frame)!;
    expect(shipPlacement(frame.fleet!, course, projection()).mirror).toBe(-1);
    expect(shipPlacement(frame.fleet!, course.negate(), projection()).mirror).toBe(1);
  });

  it('keeps the arriving course in port and follows the same fleet on a scrub back', () => {
    const sailing = routeFrame(route, 5, 7);
    const stay = routeFrame(route, 75, 7);
    expect(shipPlacement(stay.fleet!, fleetCourse(route, stay), projection()).mirror).toBe(-1);
    const later = routeFrame(route, 155, 7);
    const x = (frame: typeof sailing) => shipPlacement(frame.fleet!, null, projection()).x;
    expect(x(later)).toBeLessThan(x(stay));
    expect(x(stay)).toBeLessThan(x(sailing));
    expect(x(routeFrame(route, 5, 7))).toBe(x(sailing));
  });

  it('keeps a westward course through the dateline', () => {
    const crossing: RouteData = {
      ...route,
      pts: [
        [-170, 0, 0, 0],
        [170, 0, 10, 0],
      ],
    };
    const frame = routeFrame(crossing, 5, 7);
    const view = projection();
    view.globe.rotation.y = Math.PI;
    view.globe.updateMatrixWorld();
    view.cameraLocal = new Vector3(0, 0, -3);
    const placed = shipPlacement(frame.fleet!, fleetCourse(crossing, frame), view);
    expect(placed.opacity).toBe(1);
    expect(placed.mirror).toBe(-1);
    expect(placed.x).toBeCloseTo(720, 6);
  });

  it('projects through the shifted lens, just like the globe and callouts', () => {
    const view = projection();
    view.camera.setViewOffset(1440, 900, -140, 0, 1440, 900);
    const placed = shipPlacement(dirOf([0, 0]), null, view);
    expect(placed.x).toBeCloseTo(860, 6);
    expect(placed.y).toBeCloseTo(450, 6);
  });
});
