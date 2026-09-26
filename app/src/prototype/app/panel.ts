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
  debugView: [0, 4, 1],
  // Streamer.
  refinePx: [0.3, 4, 0.01],
  maxLevel: [0, 7, 1],
  // Camera.
  zoomFloorKm: [5, 300, 1],
  reliefNear: [0, 16, 0.5],
  reliefFar: [0, 30, 0.5],
  pixelRatio: [0.5, 2, 0.25],
  tilt: [0, 80, 1],
  heading: [-180, 180, 1],
};

const COLOR = /^#[0-9a-f]{6}$/i;

/** Adds `params` to `folder`, all but `skip`; those in `listen` follow changes made elsewhere. */
export function addParams(
  folder: GUI,
  params: Params,
  { skip = [], listen = [] }: { skip?: readonly string[]; listen?: readonly string[] } = {},
): void {
  for (const [name, value] of Object.entries(params)) {
    if (skip.includes(name)) continue;
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
  }
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

export { GUI };
