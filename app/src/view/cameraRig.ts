// Where the prototype's camera sits for a view. Near the globe it is viewPose's camera (streaming.md
// 5.7) in the globe frame, carried into the world through globeMount; far out it blends into the
// spike's world framing, which shows the whole instrument off-center (spike main.js composition).
import { MathUtils, Vector3, type Object3D, type PerspectiveCamera } from 'three';
import type { ClearanceField } from '../globe/clearance';
import { EARTH_RADIUS_KM, viewPose, type CameraPose } from '../globe/viewCamera';
import type { ViewState } from './viewState';

/** The spike's world camera: its distance from the globe's center at 1440x900, and composition. */
const WORLD = { distance: 6.9, lookY: -0.12, az: -0.2, el: 0.1 };
/** The camera's distance to the view center over which the world framing blends in, in km. */
const BLEND_KM: [number, number] = [3000, 12000];
/** How far out the instrument reaches from the globe's center, in globe radii. */
const INSTRUMENT_REACH = 3;

export interface Relief {
  kLand: number;
  kSeaEff: number;
}

/** The widest view: the one whose camera sits at the spike's world distance. */
export function maxViewKm(camera: PerspectiveCamera): number {
  return 2 * (WORLD.distance - 1) * EARTH_RADIUS_KM * halfWidth(camera);
}

/** tan of half the horizontal field of view. */
function halfWidth(camera: PerspectiveCamera): number {
  return Math.tan((camera.fov * Math.PI) / 360) * camera.aspect;
}

export class CameraRig {
  readonly #field: ClearanceField;
  #key = '';
  #pose: CameraPose | undefined;
  readonly #position = new Vector3();
  readonly #target = new Vector3();
  readonly #up = new Vector3();
  readonly #center = new Vector3();
  readonly #framed = new Vector3();
  readonly #look = new Vector3();
  /** The camera's height above the globe's surface after the last place(), in globe radii. */
  altitude = 0;

  constructor(field: ClearanceField) {
    this.#field = field;
  }

  /**
   * The gimbal's [lon, lat] in degrees that puts the camera square in front of the instrument,
   * the lamp behind it and the globe tilted toward it: the globe point the camera looks from, the
   * view's (capped) tilt back from the view center against the heading. The latitude runs past the
   * poles rather than wrapping, so the gimbal turns on continuously with north kept up; exact for
   * heading 0, near enough otherwise.
   */
  gimbalFacing(camera: PerspectiveCamera, view: ViewState, relief: Relief): [number, number] {
    const tilt = this.#poseFor(camera, view, relief).tiltDeg;
    const heading = (view.heading * Math.PI) / 180;
    const cosLat = Math.max(0.1, Math.cos((view.lat * Math.PI) / 180));
    return [view.lon - (tilt * Math.sin(heading)) / cosLat, view.lat - tilt * Math.cos(heading)];
  }

  /**
   * Puts `camera` where `view` puts it, with `globe` (globeMount, its matrixWorld current) as the
   * globe frame. `instrumentAbove` is the altitude in radii above which the instrument shows, and
   * the depth range then reaches past it.
   */
  place(
    camera: PerspectiveCamera,
    view: ViewState,
    relief: Relief,
    globe: Object3D,
    instrumentAbove: number,
  ): void {
    const pose = this.#poseFor(camera, view, relief);
    const frame = globe.matrixWorld;
    this.#position.set(...pose.position).applyMatrix4(frame);
    this.#target.set(...pose.target).applyMatrix4(frame);
    this.#up.set(...pose.up).transformDirection(frame);

    const distanceKm = view.viewKm / (2 * halfWidth(camera));
    const w = MathUtils.smoothstep(distanceKm, BLEND_KM[0], BLEND_KM[1]);
    globe.getWorldPosition(this.#center);
    if (w > 0) {
      const distance = 1 + distanceKm / EARTH_RADIUS_KM;
      this.#look.set(0, WORLD.lookY, 0).add(this.#center);
      this.#framed
        .set(
          Math.sin(WORLD.az) * Math.cos(WORLD.el),
          Math.sin(WORLD.el),
          Math.cos(WORLD.az) * Math.cos(WORLD.el),
        )
        .multiplyScalar(distance)
        .add(this.#look);
      this.#position.lerp(this.#framed, w);
      this.#target.lerp(this.#look, w);
      this.#up.lerp(new Vector3(0, 1, 0), w).normalize();
    }

    camera.position.copy(this.#position);
    camera.up.copy(this.#up);
    camera.lookAt(this.#target);
    const fromCenter = this.#position.distanceTo(this.#center);
    this.altitude = fromCenter - 1;
    if (this.altitude > instrumentAbove) {
      camera.near = Math.min(pose.near, 0.05);
      camera.far = fromCenter + INSTRUMENT_REACH;
    } else {
      camera.near = pose.near;
      camera.far = pose.far;
    }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  /** viewPose for the view, kept while nothing it reads changes. */
  #poseFor(camera: PerspectiveCamera, view: ViewState, relief: Relief): CameraPose {
    const key = [
      view.lon,
      view.lat,
      view.viewKm,
      view.tilt,
      view.heading,
      camera.aspect,
      relief.kLand,
      relief.kSeaEff,
    ].join();
    if (this.#pose && key === this.#key) return this.#pose;
    this.#key = key;
    this.#pose = viewPose(
      {
        lon: view.lon,
        lat: view.lat,
        viewKm: view.viewKm,
        tiltDeg: view.tilt,
        headingDeg: view.heading,
      },
      { fovYDeg: camera.fov, aspect: camera.aspect },
      this.#field,
      relief,
    );
    return this.#pose;
  }
}
