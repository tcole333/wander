// Callouts: engraved plaques (the spike's .plaque: uppercase serif on a dark brass plate) under a
// brass pin at each place the beat names. They follow the globe every frame, hide behind its
// horizon, and fade in once a flight has landed.
import '@fontsource/libre-baskerville/700.css';
import { Vector3, type Object3D, type PerspectiveCamera } from 'three';
import type { ViewportCss } from '../../contract';
import type { LonLat } from '../story';
import { dirOf } from './geo';
import { smoothstep } from './timeline';

const STYLE_ID = 'walk-callout-style';
const STYLE = `
.walk-callout { position: absolute; left: 0; top: 0; pointer-events: none; will-change: transform, opacity; }
.walk-callout-inner { opacity: 0; transition: opacity 0.3s ease; }
.walk-callout-inner.shown { opacity: 1; transition: opacity 0.9s ease 0.35s; }
.walk-callout-pin {
  position: absolute; left: -3px; top: -3px; width: 6px; height: 6px; border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #f6e2b0, #a27f45 70%);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.65), 0 0 6px rgba(226, 190, 120, 0.45);
}
.walk-callout-plaque {
  position: absolute; left: 0; top: 10px; transform: translateX(-50%);
  padding: 4px 10px 3px; white-space: nowrap;
  font: 700 10px/1.2 'Libre Baskerville', Georgia, serif; letter-spacing: 0.16em;
  text-transform: uppercase; color: #ead3a0;
  background: linear-gradient(#20180f, #120d08);
  border: 1px solid #a27f45; outline: 1px solid rgba(0, 0, 0, 0.6);
  box-shadow: inset 0 0 0 2px #1a130b, inset 0 0 0 3px rgba(226, 190, 120, 0.35), 0 3px 8px rgba(0, 0, 0, 0.6);
}
`;

interface Callout {
  dir: Vector3;
  outer: HTMLElement;
  inner: HTMLElement;
  plaque: HTMLElement;
  /** The plaque's size, measured once it is in the page; where its pin stands, and whether shown. */
  size: { width: number; height: number } | null;
  x: number;
  y: number;
  shown: boolean;
}

/** A callout's box on screen, CSS px. */
export interface CalloutBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The plaque's top below its pin, as the style sets it, and the pin's half size, CSS px. */
const PLAQUE_TOP = 10;
const PIN = 3;

export class Callouts {
  readonly #root: HTMLElement;
  #items: Callout[] = [];
  readonly #p = new Vector3();

  constructor(root: HTMLElement) {
    this.#root = root;
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = STYLE;
      document.head.append(style);
    }
  }

  set(callouts: { at: LonLat; text: string }[]): void {
    this.clear();
    this.#items = callouts.map(({ at, text }) => {
      const outer = document.createElement('div');
      outer.className = 'walk-callout';
      outer.style.opacity = '0';
      const inner = document.createElement('div');
      inner.className = 'walk-callout-inner';
      const pin = document.createElement('i');
      pin.className = 'walk-callout-pin';
      const plaque = document.createElement('span');
      plaque.className = 'walk-callout-plaque';
      plaque.textContent = text;
      inner.append(pin, plaque);
      outer.append(inner);
      this.#root.append(outer);
      return { dir: dirOf(at), outer, inner, plaque, size: null, x: 0, y: 0, shown: false };
    });
  }

  /**
   * The boxes on screen of the callouts shown, their pins and plaques, CSS px: the state names
   * stand clear of them. A plaque is measured the first time it is asked for.
   */
  boxes(): CalloutBox[] {
    const boxes: CalloutBox[] = [];
    for (const item of this.#items) {
      if (!item.shown) continue;
      item.size ??= { width: item.plaque.offsetWidth, height: item.plaque.offsetHeight };
      const { width, height } = item.size;
      boxes.push({
        x0: Math.min(item.x - PIN, item.x - width / 2),
        y0: item.y - PIN,
        x1: Math.max(item.x + PIN, item.x + width / 2),
        y1: item.y + PLAQUE_TOP + height,
      });
    }
    return boxes;
  }

  /** `camera` is in the globe frame's parent world; `cameraLocal` is it in the globe frame. */
  update(
    landed: boolean,
    camera: PerspectiveCamera,
    cameraLocal: Vector3,
    globe: Object3D,
    viewport: ViewportCss,
    strength: number,
  ): void {
    for (const item of this.#items) {
      // Turned toward the camera: the camera stands above the place's horizon.
      const toCamera = cameraLocal.distanceTo(item.dir);
      const facing = smoothstep(
        0,
        0.06,
        (cameraLocal.dot(item.dir) - 1) / Math.max(toCamera, 1e-9),
      );
      const p = this.#p.copy(item.dir).applyMatrix4(globe.matrixWorld).project(camera);
      const x = (p.x * 0.5 + 0.5) * viewport.width;
      const y = (-p.y * 0.5 + 0.5) * viewport.height;
      const onScreen =
        p.z < 1 && x > -40 && x < viewport.width + 40 && y > -40 && y < viewport.height + 40;
      const shown = landed && onScreen && facing > 0 && strength > 0;
      Object.assign(item, { x, y, shown });
      item.inner.classList.toggle('shown', shown);
      item.outer.style.opacity = String(Math.min(1, strength) * facing);
      item.outer.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  }

  clear(): void {
    for (const item of this.#items) item.outer.remove();
    this.#items = [];
  }
}
