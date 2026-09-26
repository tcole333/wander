// The globe's material for the look prototype (contract.ts, SurfaceLook): a MeshStandardMaterial
// whose vertex stage is the merged surface vertex chunk and whose fragment stage computes the
// spike's baked look from the surface pools, per fragment. A MeshDepthMaterial with the same vertex
// stage lets the displaced globe cast its own shadows.
import { Color, MeshDepthMaterial, MeshStandardMaterial } from 'three';
import { tunables } from '../../config/tunables';
import {
  createSurfaceVertexUniforms,
  surfaceVertexChunk,
  type SurfaceVertexChunk,
} from '../../globe/surfaceVertex.glsl';
import type { CreateSurfaceLook, Params } from '../contract';
import {
  LOOK_FRAGMENT_COLOR,
  LOOK_FRAGMENT_METALNESS,
  LOOK_FRAGMENT_NORMAL,
  LOOK_FRAGMENT_PARS,
  LOOK_FRAGMENT_ROUGHNESS,
} from './lookFragment.glsl';
import { LOOK_VERTEX_MAIN, LOOK_VERTEX_PARS } from './lookVertex.glsl';

/** The spike's art-direction palette (surface.js PAL), as sRGB hex. */
export const PALETTE = {
  bronze: '#87632e',
  patina: '#3a2913',
  brassHi: '#caa45e',
  lacquerShallow: '#2c3d50',
  lacquerDeep: '#111b26',
  lacquerShelf: '#2e3d44',
  inlay: '#9c7a40',
  river: '#2a1d0e',
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
  river: 'lookRiver',
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
  graticule: 'lookGraticule',
  noise: 'lookNoise',
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
    // The steepest tilt the relief gives a normal, as a slope.
    maxSlope: 2,
    // The spike's tune.relief: the weight of elevation and depth terraces in the relief.
    relief: 1,
    // Mips of blur on the heights the look reads, as the spike blurred its terrain: smoother
    // relief and depth bands than the vertex's own heights.
    heightBlur: 1.5,
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
    noise: 1,
    // 0 the look, 1 height, 2 shore/water/L1 fields, 3 normals, 4 source level.
    debugView: 0,
    ...PALETTE,
  };
}

type Uniforms = Record<string, { value: unknown }>;

export const createSurfaceLook: CreateSurfaceLook = (pools, surface) => {
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
  const uniforms: Uniforms = { ...vertex, ...look };

  const material = new MeshStandardMaterial({ roughness: 1, metalness: 1, envMapIntensity: 1 });
  material.name = 'wander-surface-look';
  material.defines = { ...material.defines, ...chunk.defines };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = injectVertex(shader.vertexShader, chunk, true);
    shader.fragmentShader = replaceAll(shader.fragmentShader, [
      ['#include <common>', `#include <common>\n${LOOK_FRAGMENT_PARS}`],
      ['#include <color_fragment>', LOOK_FRAGMENT_COLOR],
      ['#include <roughnessmap_fragment>', LOOK_FRAGMENT_ROUGHNESS],
      ['#include <metalnessmap_fragment>', LOOK_FRAGMENT_METALNESS],
      ['#include <normal_fragment_maps>', LOOK_FRAGMENT_NORMAL],
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
  };
  update();

  return {
    material,
    depthMaterial,
    params,
    update,
    dispose() {
      material.dispose();
      depthMaterial.dispose();
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
