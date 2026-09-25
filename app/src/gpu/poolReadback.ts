// Reads GPU array pools back (streaming.md 5.5, 7.3): textureLod at chosen texel coordinates of
// one slot and level, drawn into a float target and read as pixels. The pool smoke test and the
// surface upload test compare what they wrote with what the GPU samples.
import {
  FloatType,
  GLSL3,
  NearestFilter,
  RawShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type DataArrayTexture,
  type WebGLRenderer,
} from 'three';
import { drawFullscreen, FULLSCREEN_VERTEX } from './fullscreen';

export function rendererName(gl: WebGL2RenderingContext): string {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
}

/** Sample points, one per output pixel: pixel (x, y) samples texel coordinates (x, y) + offset. */
export interface Grid {
  slot: number;
  lod: number;
  /** The sampled level's width and height in texels. */
  texels: [number, number];
  /** 0.5 samples texel centers; 1 samples the corner shared with texel (x + 1, y + 1). */
  offset: number;
  /** Points across and down. */
  points: [number, number];
}

export function centers(slot: number, lod: number, width: number, height = width): Grid {
  return { slot, lod, texels: [width, height], offset: 0.5, points: [width, height] };
}

/** The interior corners of a square level. */
export function corners(slot: number, lod: number, size: number): Grid {
  return { slot, lod, texels: [size, size], offset: 1, points: [size - 1, size - 1] };
}

const SAMPLE_FRAGMENT = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray pool;
uniform float slot;
uniform float lod;
uniform vec2 texels;
uniform float offset;
out vec4 color;
void main() {
  vec2 uv = (floor(gl_FragCoord.xy) + offset) / texels;
  color = textureLod(pool, vec3(uv, slot), lod);
}`;

export interface Sampler {
  /** The largest |decode(sample) − want| over the grid, across the components `want` returns. */
  worst(
    pool: DataArrayTexture,
    grid: Grid,
    want: (x: number, y: number) => number[],
    decode?: (value: number) => number,
  ): number;
  dispose(): void;
}

/** Samples a pool with textureLod into a float target and reads the pixels back. */
export function createSampler(renderer: WebGLRenderer): Sampler {
  const uniforms = {
    pool: { value: null as DataArrayTexture | null },
    slot: { value: 0 },
    lod: { value: 0 },
    texels: { value: new Vector2() },
    offset: { value: 0 },
  };
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: SAMPLE_FRAGMENT,
    uniforms,
  });

  function sample(pool: DataArrayTexture, grid: Grid): Float32Array {
    const [across, down] = grid.points;
    uniforms.pool.value = pool;
    uniforms.slot.value = grid.slot;
    uniforms.lod.value = grid.lod;
    uniforms.texels.value.set(...grid.texels);
    uniforms.offset.value = grid.offset;
    const target = new WebGLRenderTarget(across, down, {
      type: FloatType,
      depthBuffer: false,
      magFilter: NearestFilter,
      minFilter: NearestFilter,
    });
    drawFullscreen(renderer, material, target);
    const pixels = new Float32Array(across * down * 4);
    renderer.readRenderTargetPixels(target, 0, 0, across, down, pixels);
    target.dispose();
    return pixels;
  }

  return {
    worst(pool, grid, want, decode = (value) => value) {
      const pixels = sample(pool, grid);
      const [across, down] = grid.points;
      let worst = 0;
      for (let y = 0; y < down; y++) {
        for (let x = 0; x < across; x++) {
          want(x, y).forEach((expected, component) => {
            const got = decode(pixels[(y * across + x) * 4 + component] ?? NaN);
            worst = Math.max(worst, Math.abs(got - expected));
          });
        }
      }
      return worst;
    },
    dispose() {
      material.dispose();
    },
  };
}
