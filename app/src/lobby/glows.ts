// The lobby's ambient glows (PRD, "First visit: the lobby": faint ambient events glowing on the
// globe): the best-scored events of every era in the event index, spread over the globe, which the
// prebuild's meanwhile stage puts in the story's lock (streaming.md 3.9). Each is a pinprick of
// lamp-lit brass with a slow, shallow breath of its own: small, so neighbors stay apart, and never ember-hot, since ember orange is the chosen
// story's. One Points object in three's built-in points material, additive and lit by nothing, so
// it compiles with the rest of the scene before the lobby opens. The points are sized in pixels
// and fade out toward the horizon rather than being depth-tested, since the exaggerated relief
// would bury the ones in the mountains.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Points,
  PointsMaterial,
  Vector3,
  type Object3D,
  type PerspectiveCamera,
} from 'three';
import { glowTexture } from '../story/effects/ember';
import { dirOf } from '../story/effects/geo';
import type { LonLat } from '../story/story';

/** A point's size in CSS pixels, and how far out from the globe's center it floats, in radii. */
const SIZE_PX = 12;
const LIFT = 1.006;
/** A point's brightness swings between these over its own period, in seconds. */
const DIM = 0.4;
const BRIGHT = 0.7;
const PERIOD_S: [number, number] = [3.5, 8];
/** How far a place must turn toward the camera past the horizon to glow fully (as a cosine). */
const HORIZON_FADE = 0.15;
const GOLDEN = (Math.sqrt(5) - 1) / 2;

export class Glows {
  readonly points: Points<BufferGeometry, PointsMaterial>;
  readonly #places: Vector3[];
  readonly #phases: number[];
  readonly #periods: number[];
  readonly #colors: BufferAttribute;
  readonly #camera = new Vector3();

  constructor(places: LonLat[]) {
    this.#places = places.map((at) => dirOf(at).multiplyScalar(LIFT));
    // Spread evenly, and the same on every visit, so no two points twinkle together.
    this.#phases = places.map((_, i) => (i * GOLDEN * 2 * Math.PI) % (2 * Math.PI));
    this.#periods = places.map(
      (_, i) => PERIOD_S[0] + (PERIOD_S[1] - PERIOD_S[0]) * ((i * GOLDEN * 3.7) % 1),
    );
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(this.#places.flatMap((p) => p.toArray())), 3),
    );
    this.#colors = new BufferAttribute(new Float32Array(places.length * 3), 3);
    geometry.setAttribute('color', this.#colors);
    const material = new PointsMaterial({
      size: SIZE_PX,
      sizeAttenuation: false,
      map: glowTexture([
        [0, 'rgba(255,214,150,1)'],
        [0.2, 'rgba(224,160,82,0.8)'],
        [0.5, 'rgba(192,150,82,0.25)'],
        [1, 'rgba(192,150,82,0)'],
      ]),
      vertexColors: true,
      blending: AdditiveBlending,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.points = new Points(geometry, material);
    this.points.name = 'lobby-glows';
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  /**
   * One frame, with `globe` the frame the points hang in: each point twinkles, dimmed toward the
   * horizon, all scaled by `strength` (0 to 1); at 0 nothing is drawn.
   */
  update(camera: PerspectiveCamera, globe: Object3D, elapsedS: number, strength: number): void {
    this.points.visible = strength > 0.001;
    if (!this.points.visible) return;
    const eye = globe.worldToLocal(camera.getWorldPosition(this.#camera));
    this.#places.forEach((place, i) => {
      const facing = (eye.dot(place) / place.length() - place.length()) / eye.distanceTo(place);
      const horizon = smoothstep(0, HORIZON_FADE, facing);
      const period = this.#periods[i] ?? PERIOD_S[0];
      const wave = 0.5 + 0.5 * Math.sin((2 * Math.PI * elapsedS) / period + (this.#phases[i] ?? 0));
      const glow = strength * horizon * (DIM + (BRIGHT - DIM) * wave * wave);
      this.#colors.setXYZ(i, glow, glow, glow);
    });
    this.#colors.needsUpdate = true;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    this.points.material.map?.dispose();
    this.points.material.dispose();
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
