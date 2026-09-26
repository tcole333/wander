// The streamer page's material: the merged surface vertex chunk, and a flat-shaded color by node
// level, source level or height, with the skirts tinted so a gap they cover shows up close.
import { GLSL3, ShaderMaterial } from 'three';
import { tunables } from '../../config/tunables';
import type { SurfaceRelease } from '../../data/release';
import {
  createSurfaceVertexUniforms,
  surfaceVertexChunk,
  type SurfaceVertexUniforms,
} from '../../globe/surfaceVertex.glsl';
import { GRID_SEGMENTS } from '../../globe/tileGrid';
import type { SurfacePools } from '../../gpu/surfaceUploads';

export const COLOR_MODES = ['level', 'source', 'height'] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

export interface DebugMaterial {
  material: ShaderMaterial;
  uniforms: SurfaceVertexUniforms & {
    colorMode: { value: number };
    showSkirts: { value: boolean };
  };
}

export function createDebugMaterial(pools: SurfacePools, surface: SurfaceRelease): DebugMaterial {
  const chunk = surfaceVertexChunk({ segments: GRID_SEGMENTS.full, debugChecks: false });
  const uniforms = {
    ...createSurfaceVertexUniforms(pools, surface, {
      kLand: tunables.kLand,
      kSeaEff: tunables.kSea,
      skirtTexels: tunables.skirtTexels,
    }),
    colorMode: { value: 0 },
    showSkirts: { value: false },
  };
  const material = new ShaderMaterial({
    name: 'wander-streamer-debug',
    glslVersion: GLSL3,
    defines: chunk.defines,
    uniforms,
    vertexShader: VERTEX(chunk.pars, chunk.mainStart),
    fragmentShader: FRAGMENT,
  });
  return { material, uniforms };
}

const VERTEX = (pars: string, mainStart: string) => /* glsl */ `
${pars}
flat out int vLevel;
flat out int vSource;
out float vHeight;
out float vLand;
out float vSkirt;
out vec3 vView;

void main() {
${mainStart}
  WanderNode n = wanderDecode(wanderNode);
  vLevel = n.level;
  vSource = n.src;
  vHeight = wv.last.h;
  vLand = wv.last.land ? 1.0 : 0.0;
  vSkirt = float(wv.role);
  vec4 view = modelViewMatrix * vec4(wv.position, 1.0);
  vView = view.xyz;
  gl_Position = projectionMatrix * view;
}
`;

const FRAGMENT = /* glsl */ `
uniform int colorMode;
uniform bool showSkirts;
flat in int vLevel;
flat in int vSource;
in float vHeight;
in float vLand;
in float vSkirt;
in vec3 vView;
layout(location = 0) out highp vec4 wanderColor;

const vec3 LEVEL_COLORS[8] = vec3[8](
  vec3(0.35, 0.35, 0.40), vec3(0.20, 0.35, 0.80), vec3(0.10, 0.65, 0.85), vec3(0.15, 0.70, 0.35),
  vec3(0.75, 0.80, 0.20), vec3(0.95, 0.60, 0.15), vec3(0.90, 0.25, 0.20), vec3(0.95, 0.95, 0.95)
);

vec3 heightColor(float h, bool land) {
  if (!land) return mix(vec3(0.02, 0.10, 0.30), vec3(0.20, 0.45, 0.70), clamp(1.0 + h / 6000.0, 0.0, 1.0));
  float t = clamp(h / 4000.0, 0.0, 1.0);
  vec3 low = mix(vec3(0.20, 0.45, 0.20), vec3(0.60, 0.50, 0.30), smoothstep(0.0, 0.4, t));
  return mix(low, vec3(0.95), smoothstep(0.5, 1.0, t));
}

void main() {
  vec3 base = colorMode == 0 ? LEVEL_COLORS[vLevel]
    : colorMode == 1 ? LEVEL_COLORS[vSource]
    : heightColor(vHeight, vLand > 0.5);
  if (colorMode != 2) base *= mix(0.75, 1.0, vLand);
  if (showSkirts && vSkirt > 0.0) base = vec3(0.0, 1.0, 1.0);
  // Flat shading from the view-space triangle, lit from the upper left of the screen.
  vec3 normal = normalize(cross(dFdx(vView), dFdy(vView)));
  float light = 0.35 + 0.65 * max(dot(normal, normalize(vec3(-0.4, 0.6, 0.7))), 0.0);
  wanderColor = vec4(base * light, 1.0);
}
`;
