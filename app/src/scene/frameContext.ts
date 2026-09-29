// The globe frame as this frame draws it: the camera and the key lamp in the globe's own frame
// (museum.globeMount, radius 1), the globe frame as the camera sees it, and the scale a point on
// the globe is drawn at. The boot places it once a frame, after the camera, for what hangs in the
// globe frame (the story's effects, Explore's marks).
import {
  MathUtils,
  Matrix4,
  Vector3,
  type Object3D,
  type PerspectiveCamera,
  type SpotLight,
} from 'three';
import type { ViewportCss } from '../contract';
import { EARTH_RADIUS_KM } from '../globe/viewCamera';

/** Where the museum's key lamp stands, if the scene has no spot light to ask. */
const LAMP_FALLBACK = new Vector3(-4.2, 5.2, 9.5);

export class FrameContext {
  /** The camera as three places it, and the globe's frame, as of the last place(). */
  cam: PerspectiveCamera | null = null;
  globe: Object3D | null = null;
  viewport: ViewportCss = { width: 1, height: 1 };
  /** The camera's position in the globe frame. */
  readonly camera = new Vector3();
  /** The direction to the key lamp in the globe frame. */
  readonly lampLocal = new Vector3();
  /** The globe frame as the camera sees it: view matrix times the globe's world matrix. */
  readonly toView = new Matrix4();
  /** The tangent of half the camera's vertical field of view. */
  tanHalf = 1;
  #lamp: SpotLight | null | undefined;

  /** Reads this frame's camera, lamp and globe frame, once the camera has been placed. */
  place(cam: PerspectiveCamera, globe: Object3D, viewport: ViewportCss): void {
    this.cam = cam;
    this.globe = globe;
    this.viewport = viewport;
    globe.updateWorldMatrix(true, false);
    globe.worldToLocal(cam.getWorldPosition(this.camera));
    if (this.#lamp === undefined) this.#lamp = findSpotLight(globe);
    const lampWorld = this.#lamp
      ? this.#lamp.getWorldPosition(new Vector3())
      : LAMP_FALLBACK.clone();
    this.lampLocal.copy(globe.worldToLocal(lampWorld)).normalize();
    this.toView.multiplyMatrices(cam.matrixWorldInverse, globe.matrixWorld);
    this.tanHalf = Math.tan(MathUtils.degToRad(cam.fov) / 2);
  }

  /** Globe units per CSS pixel at a globe-frame point. */
  pxWorld(p: Vector3): number {
    return (2 * this.camera.distanceTo(p) * this.tanHalf) / this.viewport.height;
  }

  /** The view's width in km at a globe-frame point. */
  viewKmAt(p: Vector3): number {
    return this.pxWorld(p) * this.viewport.width * EARTH_RADIUS_KM;
  }
}

function findSpotLight(from: Object3D): SpotLight | null {
  let root = from;
  while (root.parent) root = root.parent;
  return (root.getObjectByProperty('isSpotLight', true) as SpotLight | undefined) ?? null;
}
