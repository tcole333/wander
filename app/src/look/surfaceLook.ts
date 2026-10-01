// The globe's material (SurfaceLook in ../contract.ts): a MeshStandardMaterial whose vertex stage
// is the merged surface vertex chunk and whose fragment stage computes the spike's baked look from
// the surface pools, per fragment, with the ocean and sea names inlaid in its lacquer
// (seaNames.ts) and its rivers in blued steel. A MeshDepthMaterial with the same vertex stage lets
// the displaced globe cast its own shadows. Given a glyph set, where Explore stands, the look also
// cuts marks into its surface (marks/marks.ts, look.marks); without one, its program and atlas are
// the look's alone.
// Given a tier for the border steps, where the release names them, its border array holds the
// steps' slots and preview ring (bordersHook.ts) in place of milestone 1's 1815 field.
// The faces the sea names are lettered in, declared wherever the look is made.
import '@fontsource/libre-baskerville/400.css';
import '@fontsource/source-serif-4/400-italic.css';
import {
  Color,
  Matrix4,
  MeshDepthMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Vector2,
  Vector3,
  type Object3D,
} from 'three';
import { tunables } from '../config/tunables';
import type { CreateSurfaceLook, Params } from '../contract';
import { MarkLayer } from '../marks/marks';
import {
  createSurfaceVertexUniforms,
  surfaceVertexChunk,
  type SurfaceVertexChunk,
} from '../globe/surfaceVertex.glsl';
import { ASH_FRAGMENT_APPLY, ASH_FRAGMENT_PARS, createAshUniforms, registerAsh } from './ashHook';
import {
  BORDERS_FRAGMENT_APPLY,
  BORDERS_FRAGMENT_PARS,
  createBorderUniforms,
  createStepUniforms,
  ETCHED_LOOK,
  registerBorders,
  registerBorderSteps,
  STEPS_FRAGMENT_APPLY,
  STEPS_FRAGMENT_PARS,
} from './bordersHook';
import {
  CLIMATE_FRAGMENT_APPLY,
  climateFragmentPars,
  createClimateUniforms,
  registerClimate,
} from './climateHook';
import { lookFragment } from './lookFragment.glsl';
import { LOOK_VERTEX_MAIN, LOOK_VERTEX_PARS } from './lookVertex.glsl';
import {
  createRouteUniforms,
  disposeRouteTextures,
  registerRoutes,
  ROUTE_FRAGMENT_APPLY,
  routeFragmentPars,
} from './routeHook';
import { SeaNameLayer } from './seaNames';

/** The spike's art-direction palette (surface.js PAL), as sRGB hex. */
export const PALETTE = {
  bronze: '#87632e',
  patina: '#3a2913',
  brassHi: '#caa45e',
  lacquerShallow: '#2c3d50',
  lacquerDeep: '#111b26',
  lacquerShelf: '#2e3d44',
  inlay: '#9c7a40',
  /** The rivers' inlay: the deep blue of heat-blued steel (owner decision 42). */
  riverSteel: '#2250b8',
} as const;

export type PaletteName = keyof typeof PALETTE;

const PALETTE_UNIFORMS: Record<PaletteName, string> = {
  bronze: 'lookBronze',
  patina: 'lookPatina',
  brassHi: 'lookBrassHi',
  lacquerShallow: 'lookShallow',
  lacquerDeep: 'lookDeep',
  lacquerShelf: 'lookShelf',
  inlay: 'lookInlay',
  riverSteel: 'lookRiverSteel',
};

/** Numeric params and the uniform each one feeds. */
const SCALAR_UNIFORMS = {
  normalStrength: 'lookNormalStrength',
  normalZoom: 'lookNormalZoom',
  maxSlope: 'lookMaxSlope',
  relief: 'lookRelief',
  heightBlur: 'lookHeightBlur',
  bevelWidth: 'lookBevelPx',
  broadBevel: 'lookBroadWeight',
  broadBevelDeg: 'lookBroadDeg',
  coastLine: 'lookCoastPx',
  riverLine: 'lookRiverPx',
  riverSteelRough: 'lookRiverSteelRough',
  riverSteelSink: 'lookRiverSteelSink',
  borderEtchedCap: 'lookCutCap',
  graticule: 'lookGraticule',
  noise: 'lookNoise',
  polish: 'lookPolish',
  coarseRelief: 'lookCoarse',
  debugView: 'lookDebug',
} as const;

export function defaultLookParams(): Params {
  return {
    kLand: tunables.kLand,
    kSea: tunables.kSea,
    bathymetry: true,
    flatRelief: false,
    // The spike's normal-map strength: slope per degree of arc times 0.9.
    normalStrength: 1,
    // Relief normals scale by (degrees per pixel / 0.13)^normalZoom, as the spike's close patch
    // baked its normals at 0.45 of the globe's.
    normalZoom: 0.35,
    // The steepest tilt the relief gives a normal, as a slope: 45 degrees. Steeper, fine relief
    // tilts its normals past the lamp's reflection and glitters.
    maxSlope: 1,
    // The spike's tune.relief: the weight of elevation and depth terraces in the relief.
    relief: 1,
    // Mips of blur on the heights the look reads, as the spike blurred its terrain: a little
    // smoother than the vertex's own heights (more reads as molten gold, not cast bronze).
    heightBlur: 0.5,
    // The narrow coastal bevel's half-width in CSS pixels (from 3/4 to 4 source texels, the most
    // the shore field's reach of 8 allows).
    bevelWidth: 3,
    // The broad bevel from the L1 ancestor's shoreline: its weight, and its width in degrees at
    // the spike's global scale (its bake's bevelDeg), narrowing to 0.36 of that close up.
    broadBevel: 0.4,
    broadBevelDeg: 0.28,
    // Line widths in CSS pixels, and the graticule's and the noise's strength.
    coastLine: 1.2,
    riverLine: 1,
    graticule: 1,
    // The Labels layer's strength: the ocean and sea names.
    seaNames: 1,
    noise: 1,
    // How polished the high ground gets below the world scale (the whole globe keeps the spike's
    // 1): lower dulls the lamp's glare on broad highlands such as Tibet at 3,000-10,000 km, at the
    // cost of a flatter, satin look (the owner's note: the glare was too bright).
    polish: 0.55,
    // The share of the land's relief taken from heights about 24 pixels a texel, from 300 km wide
    // out to the regional scale: magnified ranges keep their main forms, not every small ridge.
    coarseRelief: 0.85,
    // 0 the look, 1 height, 2 shore/water/L1 fields, 3 normals, 4 source level.
    debugView: 0,
    // The climate palette's saturation either side of the average, K.
    climateRangeK: tunables.climateRangeK,
    // The rivers' blued steel: its roughness, and how deep it lies in the channel the relief cuts
    // for it, a share of the channel's full depth.
    riverSteelRough: 0.5,
    riverSteelSink: 0.6,
    // The border steps' etched cut (bordersHook.ts, ETCHED_LOOK): its polished metal's color and
    // roughness, how much its outer line's shadow darkens the metal, and the most light it
    // reflects, in luminance.
    borderEtched: ETCHED_LOOK.color,
    borderEtchedRough: ETCHED_LOOK.roughness,
    borderEtchedShade: ETCHED_LOOK.outer.shade,
    borderEtchedCap: ETCHED_LOOK.cap,
    ...PALETTE,
  };
}

type Uniforms = Record<string, { value: unknown }>;

/** The lamp's position when the scene has no spot light. */
const LAMP_FALLBACK = new Vector3(-4.2, 5.2, 9.5);

export const createSurfaceLook: CreateSurfaceLook = (pools, surface, options = {}) => {
  const params = defaultLookParams();
  const chunk = surfaceVertexChunk({ segments: 32, debugChecks: false });
  const vertex = createSurfaceVertexUniforms(pools, surface, {
    kLand: tunables.kLand,
    kSeaEff: tunables.kSea,
    skirtTexels: tunables.skirtTexels,
  });
  const look: Uniforms = {};
  for (const [name, uniform] of Object.entries(PALETTE_UNIFORMS)) {
    look[uniform] = { value: new Color(params[name as PaletteName] as string) };
  }
  for (const uniform of Object.values(SCALAR_UNIFORMS)) look[uniform] = { value: 0 };
  const camLocal = new Vector3();
  look.lookCamLocal = { value: camLocal };
  // The walk's illustrative ashfall (ashHook.ts), its climate (climateHook.ts) and its borders
  // (bordersHook.ts), off until its effects set a strength.
  const ash = createAshUniforms();
  const climate = createClimateUniforms();
  const steps = options.borderSteps ? createStepUniforms(options.borderSteps) : null;
  const field = steps ? null : createBorderUniforms();
  const borderField = (steps ?? field)?.lookBorderField.value;
  const seaNames = new SeaNameLayer(options.marks ?? null);
  const marks = options.marks ? new MarkLayer(() => seaNames.glyphCells) : null;
  const fragment = lookFragment({ marks: marks !== null });
  // With the marks' table, the routes' cells head their index table, so the look reads as many
  // samplers as it does without marks.
  const routes = createRouteUniforms({ cellsInIndices: marks !== null });
  const uniforms: Uniforms = {
    ...vertex,
    ...look,
    ...ash,
    ...climate,
    ...steps,
    ...field,
    ...routes,
    ...seaNames.uniforms,
    ...marks?.uniforms,
  };

  const material = new MeshStandardMaterial({ roughness: 1, metalness: 1, envMapIntensity: 1 });
  material.name = 'wander-surface-look';
  registerAsh(material, ash);
  registerClimate(material, climate);
  if (steps) registerBorderSteps(material, steps);
  if (field) registerBorders(material, field);
  registerRoutes(material, routes);
  material.defines = { ...material.defines, ...chunk.defines };
  // The graticule and the sea names need the camera in the globe frame: the mesh's local frame.
  // The names also need the CSS px a length spans at the same distance in front of the camera, and
  // the globe frame's projection, to keep to the names in the view.
  const toLocal = new Matrix4();
  const toClip = new Matrix4();
  const viewport = new Vector2();
  // The marks also need the camera's axis, the frame's normals and the lamp in the globe frame.
  const forward = new Vector3();
  const lampLocal = new Vector3();
  let lamp: Object3D | null | undefined;
  material.onBeforeRender = (renderer, scene, camera, _geometry, object) => {
    toLocal.copy(object.matrixWorld).invert();
    camLocal.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(toLocal);
    if (!(camera instanceof PerspectiveCamera)) return;
    renderer.getSize(viewport);
    const pixelRatio = renderer.getPixelRatio();
    routes.lookRoutePixelRatio.value = pixelRatio;
    if (steps) steps.lookBorderPixelRatio.value = pixelRatio;
    const pxPerUnit = (camera.projectionMatrix.elements[5] ?? 1) * 0.5 * viewport.y;
    toClip
      .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .multiply(object.matrixWorld);
    const view = { camera: camLocal, pxPerUnit, width: viewport.x, height: viewport.y, toClip };
    seaNames.place(view, Number(params.seaNames));
    if (!marks) return;
    camera.getWorldDirection(forward).transformDirection(toLocal);
    lamp ??= scene.getObjectByProperty('isSpotLight', true) ?? null;
    if (lamp) lamp.getWorldPosition(lampLocal);
    else lampLocal.copy(LAMP_FALLBACK);
    lampLocal.applyMatrix4(toLocal);
    const flat = params.flatRelief === true;
    marks.place({
      ...view,
      pixelRatio,
      forward,
      toView: object.normalMatrix,
      lamp: lampLocal,
      kLand: flat ? 0 : Number(params.kLand),
      kSea: flat || params.bathymetry !== true ? 0 : Number(params.kSea),
    });
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = injectVertex(shader.vertexShader, chunk, true);
    shader.fragmentShader = replaceAll(shader.fragmentShader, [
      [
        '#include <common>',
        `#include <common>\n${fragment.pars}\n${climateFragmentPars(marks !== null)}\n${steps ? STEPS_FRAGMENT_PARS : BORDERS_FRAGMENT_PARS}\n${ASH_FRAGMENT_PARS}\n${routeFragmentPars(marks !== null)}`,
      ],
      [
        '#include <color_fragment>',
        `${fragment.color}\n${CLIMATE_FRAGMENT_APPLY}\n${steps ? STEPS_FRAGMENT_APPLY : BORDERS_FRAGMENT_APPLY}\n${ASH_FRAGMENT_APPLY}\n${ROUTE_FRAGMENT_APPLY}`,
      ],
      ['#include <roughnessmap_fragment>', fragment.roughness],
      ['#include <metalnessmap_fragment>', fragment.metalness],
      ['#include <normal_fragment_maps>', fragment.normal],
      ['#include <lights_fragment_end>', `#include <lights_fragment_end>\n${fragment.specular}`],
    ]);
  };

  // Shadow maps read the depth buffer, so the depth material needs no packing.
  const depthMaterial = new MeshDepthMaterial();
  depthMaterial.name = 'wander-surface-depth';
  depthMaterial.defines = { ...depthMaterial.defines, ...chunk.defines };
  depthMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, vertex);
    shader.vertexShader = injectVertex(shader.vertexShader, chunk, false);
  };

  const colors = new Map<string, string>();
  const update = () => {
    const flat = params.flatRelief === true;
    vertex.wanderKLand.value = flat ? 0 : Number(params.kLand);
    vertex.wanderKSeaEff.value = flat || params.bathymetry !== true ? 0 : Number(params.kSea);
    for (const [name, uniform] of Object.entries(SCALAR_UNIFORMS)) {
      const target = look[uniform];
      if (target) target.value = Number(params[name]);
    }
    for (const [name, uniform] of Object.entries(PALETTE_UNIFORMS)) {
      const hex = String(params[name]);
      const target = look[uniform];
      if (!target || colors.get(name) === hex) continue;
      colors.set(name, hex);
      (target.value as Color).set(hex);
    }
    climate.lookClimateRange.value = Math.max(0.5, Number(params.climateRangeK));
    if (steps) {
      steps.lookBorderEtched.value.set(String(params.borderEtched));
      steps.lookBorderEtchedLook.value.set(
        Number(params.borderEtchedRough),
        Number(params.borderEtchedShade) / ETCHED_LOOK.outer.shade,
      );
    }
  };
  update();

  return {
    material,
    depthMaterial,
    params,
    update(elapsedS) {
      update();
      marks?.update(elapsedS);
    },
    ready: seaNames.ready,
    marks,
    inspectMemory(account) {
      if (borderField) account.texture(steps ? 'borders.slots' : 'borders.1815', borderField);
      account.texture('climate.uploadField', climate.lookClimateField.value);
      account.texture('labels.seaAtlas', seaNames.uniforms.lookSeaAtlas.value);
      account.texture('routes.segments', routes.lookRouteSegments.value);
      if (routes.lookRouteCells) account.texture('routes.cells', routes.lookRouteCells.value);
      account.texture('routes.indices', routes.lookRouteIndices.value);
      account.texture('routes.state', routes.lookRouteState.value);
      marks?.inspectMemory(account);
    },
    dispose() {
      material.dispose();
      depthMaterial.dispose();
      climate.lookClimateField.value.dispose();
      borderField?.dispose();
      disposeRouteTextures(routes);
      seaNames.dispose();
      marks?.dispose();
    },
  };
};

/** Three's vertex shader with the surface chunk placing the vertex and, for the look, its varyings. */
function injectVertex(source: string, chunk: SurfaceVertexChunk, varyings: boolean): string {
  const pars = varyings ? `${chunk.pars}\n${LOOK_VERTEX_PARS}` : chunk.pars;
  const main = varyings ? `${chunk.mainStart}\n${LOOK_VERTEX_MAIN}` : chunk.mainStart;
  const steps: [string, string][] = [
    ['#include <common>', `#include <common>\n${pars}`],
    ['void main() {', `void main() {\n${main}`],
    ['#include <begin_vertex>', 'vec3 transformed = wv.position;'],
  ];
  if (varyings) steps.push(['#include <beginnormal_vertex>', 'vec3 objectNormal = wv.normal;']);
  return replaceAll(source, steps);
}

function replaceAll(source: string, steps: [string, string][]): string {
  return steps.reduce((text, [from, to]) => {
    if (!text.includes(from)) throw new Error(`three's shader has no ${from}`);
    return text.replace(from, to);
  }, source);
}
