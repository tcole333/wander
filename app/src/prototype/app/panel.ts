// The prototype's lil-gui panel: a folder per module built from its params (numbers as sliders,
// booleans as checkboxes, '#rrggbb' strings as colors), and query overrides for any param.
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import type { Params } from '../contract';

/** [min, max, step] per param name; others get a range from their default. */
const RANGES: Record<string, [number, number, number?]> = {
  // Museum scene.
  exposure: [0.2, 2.5, 0.01],
  keyIntensity: [0, 12, 0.1],
  rimIntensity: [0, 3, 0.05],
  hemiIntensity: [0, 2, 0.05],
  envIntensity: [0, 2, 0.05],
  bloomStrength: [0, 2, 0.01],
  bloomRadius: [0, 1, 0.01],
  bloomThreshold: [0, 2, 0.01],
  vignette: [0, 1, 0.01],
  grain: [0, 0.1, 0.005],
  fadeNear: [0, 1, 0.01],
  fadeFar: [0, 2, 0.01],
  hideAltitude: [0, 1, 0.01],
  // Surface look.
  kLand: [0, 30, 0.5],
  kSea: [0, 30, 0.5],
  normalStrength: [0, 3, 0.05],
  normalZoom: [0, 1, 0.01],
  maxSlope: [0, 5, 0.05],
  relief: [0, 3, 0.05],
  heightBlur: [0, 3, 0.05],
  bevelWidth: [0, 8, 0.1],
  broadBevel: [0, 1, 0.01],
  broadBevelDeg: [0, 1, 0.01],
  coastLine: [0, 4, 0.05],
  riverLine: [0, 4, 0.05],
  graticule: [0, 2, 0.05],
  noise: [0, 2, 0.05],
  polish: [0, 1.5, 0.01],
  coarseRelief: [0, 1, 0.01],
  debugView: [0, 4, 1],
  // Streamer.
  refinePx: [0.3, 4, 0.01],
  maxLevel: [0, 7, 1],
  // Story effects: strengths, 1 as designed.
  ember: [0, 2, 0.01],
  plume: [0, 2, 0.01],
  pulses: [0, 2, 0.01],
  labels: [0, 1, 0.01],
  ash: [0, 2, 0.01],
  veil: [0, 2, 0.01],
  // Camera.
  zoomFloorKm: [5, 300, 1],
  reliefNear: [0, 16, 0.5],
  reliefFar: [0, 30, 0.5],
  pixelRatio: [0.5, 2, 0.25],
  tilt: [0, 80, 1],
  heading: [-180, 180, 1],
};

const COLOR = /^#[0-9a-f]{6}$/i;

/** What the page does with a param's controller. */
export interface ParamControl {
  disable(disabled?: boolean): unknown;
  onChange(callback: () => void): unknown;
}

interface AddOptions {
  /** Only these params, when given. */
  only?: readonly string[];
  skip?: readonly string[];
  /** Params that follow changes made elsewhere. */
  listen?: readonly string[];
}

/** Adds `params` to `folder`, and returns each param's controller by name. */
export function addParams(
  folder: GUI,
  params: Params,
  { only, skip = [], listen = [] }: AddOptions = {},
): Map<string, ParamControl> {
  const controllers = new Map<string, ParamControl>();
  for (const [name, value] of Object.entries(params)) {
    if (skip.includes(name) || (only && !only.includes(name))) continue;
    let controller;
    if (typeof value === 'number') {
      const [min, max, step] = RANGES[name] ?? defaultRange(value);
      controller = folder.add(params as Record<string, number>, name, min, max, step);
    } else if (typeof value === 'string' && COLOR.test(value)) {
      controller = folder.addColor(params as Record<string, string>, name);
    } else if (typeof value === 'boolean') {
      controller = folder.add(params as Record<string, boolean>, name);
    } else {
      controller = folder.add(params as Record<string, string>, name);
    }
    if (listen.includes(name)) controller.listen();
    controllers.set(name, controller);
  }
  return controllers;
}

function defaultRange(value: number): [number, number, number] {
  const span = Math.max(1, Math.abs(value) * 4);
  return [Math.min(0, -span), span, span / 200];
}

/** Sets each param named in the query, parsed as its default's type. */
export function applyQuery(params: Params, query: URLSearchParams): void {
  for (const [name, value] of Object.entries(params)) {
    const given = query.get(name);
    if (given === null) continue;
    if (typeof value === 'boolean') params[name] = given !== 'false' && given !== '0';
    else if (typeof value === 'number' && Number.isFinite(Number(given))) {
      params[name] = Number(given);
    } else if (typeof value === 'string') params[name] = given;
  }
}

/**
 * Hides `gui` behind a small engraved gear at the page's top right, for a page whose own UI fills
 * the screen (a story): the gear shows the panel, open, and hides it again. Styled as .wu-gear by
 * the walk's stylesheet.
 */
export function tuckAway(gui: GUI): HTMLButtonElement {
  gui.hide();
  const gear = document.createElement('button');
  gear.type = 'button';
  gear.className = 'wu-gear';
  gear.title = 'Look settings';
  gear.setAttribute('aria-label', 'Look settings');
  gear.setAttribute('aria-expanded', 'false');
  gear.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="${gearPath()}"/></svg>`;
  gear.addEventListener('click', () => {
    const open = gear.getAttribute('aria-expanded') !== 'true';
    gui.show(open);
    if (open) gui.open();
    gear.setAttribute('aria-expanded', String(open));
    gear.blur();
  });
  document.body.append(gear);
  return gear;
}

/** A gear of eight teeth, 24 units across, with a hole at its hub. */
function gearPath(): string {
  const teeth = 8;
  const at = (r: number, a: number) =>
    `${(12 + r * Math.sin(a)).toFixed(2)} ${(12 - r * Math.cos(a)).toFixed(2)}`;
  const rim: string[] = [];
  for (let k = 0; k < teeth; k += 1) {
    const a = (k * 2 * Math.PI) / teeth;
    const [root, flank] = [0.3, 0.17];
    rim.push(at(8, a - root), at(11.2, a - flank), at(11.2, a + flank), at(8, a + root));
  }
  const hole = 'M12 8.6a3.4 3.4 0 1 0 0.01 0Z';
  return `M${rim.join('L')}Z${hole}`;
}

export { GUI };
