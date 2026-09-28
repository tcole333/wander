// A chart's nao, upright in the page while its waterline follows the fleet on the globe.
import './ship.css';
import shipUrl from './ship.svg';
import { Vector3, type Object3D, type PerspectiveCamera } from 'three';
import type { ViewportCss } from '../../contract';
import type { RouteData } from '../../data/route';
import { dirOf } from './geo';
import type { RouteFrame } from './route';
import { smoothstep } from './timeline';

export interface ShipView {
  camera: PerspectiveCamera;
  cameraLocal: Vector3;
  globe: Object3D;
  viewport: ViewportCss;
  elapsedS: number;
}

/** The sailing tangent, keeping the arriving course during a stay in port. */
export function fleetCourse(route: RouteData, frame: RouteFrame): Vector3 | null {
  if (!frame.fleet) return null;
  const segment = (i: number) => {
    const a = route.pts[i];
    const b = route.pts[i + 1];
    if (!a || !b) return null;
    const normal = dirOf([a[0], a[1]]).cross(dirOf([b[0], b[1]]));
    if (normal.lengthSq() < 1e-18) return null;
    return normal.cross(frame.fleet!).normalize();
  };
  const sailing = segment(frame.head.index);
  if (sailing) return sailing;
  for (let i = frame.head.index - 1; i >= 0; i--) {
    const arriving = segment(i);
    if (arriving) return arriving;
  }
  for (let i = frame.head.index + 1; i < route.pts.length - 1; i++) {
    const departing = segment(i);
    if (departing) return departing;
  }
  return null;
}

/** The same horizon fade as the callout pins; the course is projected to keep the ship upright. */
export function shipPlacement(fleet: Vector3, course: Vector3 | null, view: ShipView) {
  const { camera, cameraLocal, globe, viewport } = view;
  const facing = smoothstep(
    0,
    0.06,
    (cameraLocal.dot(fleet) - 1) / Math.max(cameraLocal.distanceTo(fleet), 1e-9),
  );
  const p = fleet.clone().applyMatrix4(globe.matrixWorld).project(camera);
  const x = (p.x * 0.5 + 0.5) * viewport.width;
  const y = (-p.y * 0.5 + 0.5) * viewport.height;
  const onScreen =
    p.z >= -1 &&
    p.z < 1 &&
    x > -30 &&
    x < viewport.width + 30 &&
    y > -30 &&
    y < viewport.height + 30;
  const ahead = fleet
    .clone()
    .addScaledVector(course ?? new Vector3(), 0.001)
    .applyMatrix4(globe.matrixWorld)
    .project(camera);
  return { x, y, opacity: onScreen ? facing : 0, mirror: ahead.x < p.x ? -1 : 1 };
}

export class FleetShip {
  readonly #element: HTMLDivElement;
  #previous: Vector3 | null = null;
  #day: number | null = null;
  #direction = 1;
  #motion = 0;
  #lastS: number | null = null;

  constructor(root: HTMLElement) {
    this.#element = document.createElement('div');
    this.#element.className = 'walk-ship';
    this.#element.setAttribute('aria-hidden', 'true');
    this.#element.style.opacity = '0';
    const img = document.createElement('img');
    img.src = shipUrl;
    img.alt = '';
    this.#element.append(img);
    root.append(this.#element);
  }

  update(route: RouteData, frame: RouteFrame, day: number, alpha: number, view: ShipView): void {
    if (!frame.fleet) {
      this.hide();
      return;
    }
    if (this.#day !== null && day !== this.#day) this.#direction = Math.sign(day - this.#day);
    const moving = this.#previous !== null && this.#previous.distanceToSquared(frame.fleet) > 1e-18;
    const dt = this.#lastS === null ? 0 : Math.max(0, Math.min(0.1, view.elapsedS - this.#lastS));
    this.#motion += (Number(moving) - this.#motion) * (1 - Math.exp(-dt / 0.15));
    this.#previous = frame.fleet.clone();
    this.#day = day;
    this.#lastS = view.elapsedS;
    const course = fleetCourse(route, frame)?.multiplyScalar(this.#direction) ?? null;
    const { x, y, opacity, mirror } = shipPlacement(frame.fleet, course, view);
    const bob = 0.8 * this.#motion * Math.sin(view.elapsedS * 4);
    this.#element.style.opacity = String(Math.min(1, alpha) * opacity);
    // Keep the hull just above the shader's ember dot, which remains its stern light.
    this.#element.style.transform = `translate(${x.toFixed(1)}px, ${(y + bob).toFixed(1)}px) translate(-50%, -92%) scaleX(${mirror})`;
  }

  hide(): void {
    this.#element.style.opacity = '0';
    this.#previous = null;
    this.#day = null;
    this.#direction = 1;
    this.#motion = 0;
    this.#lastS = null;
  }

  dispose(): void {
    this.#element.remove();
  }
}
