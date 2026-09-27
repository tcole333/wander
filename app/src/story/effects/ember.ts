// The ember (PRD: the active event glows ember orange): a white-hot core on the summit, a soft
// halo the bloom spreads, and a small warm light on the ground around it. Sized in pixels, so it
// reads the same from the whole instrument down to the caldera, which it never shrinks below.
import {
  AdditiveBlending,
  CanvasTexture,
  Group,
  PointLight,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { EARTH_KM } from './geo';

export const EMBER = '#e8662c';
/** The core's diameter in CSS pixels, and at least a caldera's width. */
const CORE_PX = 18;
const CORE_MIN_KM = 7;
const HALO_SCALE = 7;

function glowTexture(stops: [number, string][]): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g2d = canvas.getContext('2d');
  if (!g2d) throw new Error('no 2D canvas context');
  const gradient = g2d.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [at, color] of stops) gradient.addColorStop(at, color);
  g2d.fillStyle = gradient;
  g2d.fillRect(0, 0, 128, 128);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export class Ember {
  readonly group = new Group();
  readonly #core: Sprite;
  readonly #halo: Sprite;
  readonly #light = new PointLight(EMBER, 0, 1, 2);
  readonly #up = new Vector3();

  constructor() {
    this.#core = new Sprite(
      new SpriteMaterial({
        map: glowTexture([
          [0, 'rgba(255,248,225,1)'],
          [0.22, 'rgba(255,190,110,1)'],
          [0.5, 'rgba(232,102,44,0.55)'],
          [1, 'rgba(232,102,44,0)'],
        ]),
        blending: AdditiveBlending,
        depthWrite: false,
        transparent: true,
      }),
    );
    // The halo glows over the terrain around it: no depth test, and hidden behind the horizon.
    this.#halo = new Sprite(
      new SpriteMaterial({
        map: glowTexture([
          [0, 'rgba(232,102,44,0.85)'],
          [0.25, 'rgba(200,72,22,0.32)'],
          [0.6, 'rgba(120,32,8,0.08)'],
          [1, 'rgba(0,0,0,0)'],
        ]),
        blending: AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      }),
    );
    this.#core.renderOrder = 6;
    this.#halo.renderOrder = 5;
    this.group.add(this.#halo, this.#core, this.#light);
  }

  /**
   * `at` is the summit in the globe frame, `heat` 0 to 1, `pxWorld` the globe units a pixel spans
   * there, and `facing` how far the place is turned toward the camera (0 at the horizon).
   */
  update(at: Vector3, heat: number, pxWorld: number, facing: number, elapsedS: number): void {
    const on = heat > 0.001 && facing > 0;
    this.#core.visible = this.#halo.visible = on;
    if (!on) {
      this.#light.intensity = 0;
      return;
    }
    const flicker =
      1 +
      0.07 * Math.sin(elapsedS * 7.3) +
      0.05 * Math.sin(elapsedS * 12.9 + 1.7) +
      0.04 * Math.sin(elapsedS * 3.1 + 0.4);
    const core = Math.max(CORE_PX * pxWorld, CORE_MIN_KM / EARTH_KM);
    this.#up.copy(at).normalize();
    this.#core.position.copy(at).addScaledVector(this.#up, core * 0.25);
    this.#halo.position.copy(this.#core.position);
    this.#core.scale.setScalar(core * (0.8 + 0.4 * heat));
    this.#halo.scale.setScalar(core * HALO_SCALE * (0.6 + 0.5 * heat));
    const k = 4.5 * heat * flicker * Math.min(1, facing * 8);
    this.#core.material.color.setScalar(k);
    this.#halo.material.color.setScalar(0.5 + 1.1 * heat * flicker);
    this.#halo.material.opacity = Math.min(1, facing * 8);

    // A warm pool on the slopes, as wide on screen as the halo.
    const lift = core * 1.6;
    this.#light.position.copy(at).addScaledVector(this.#up, lift);
    this.#light.distance = lift * 14;
    this.#light.intensity = 3 * heat * flicker * lift * lift;
  }

  dispose(): void {
    for (const sprite of [this.#core, this.#halo]) {
      sprite.material.map?.dispose();
      sprite.material.dispose();
    }
    this.#light.dispose();
  }
}
