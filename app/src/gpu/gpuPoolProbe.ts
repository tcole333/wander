// The pool smoke test's page logic (streaming.md 5.5, 7.3), run by e2e/gpu-pool.html on the Vite
// dev server and never bundled. It builds the three surface pools with 8 slots, records the GL
// calls three makes for them, writes mips of a few slots, samples them back with textureLod into
// a float target and reads the pixels. e2e/gpu-pool.spec.ts asserts on the report.
import {
  DataUtils,
  FloatType,
  GLSL3,
  NearestFilter,
  RawShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  WebGLRenderer,
  type DataArrayTexture,
} from 'three';
import { drawFullscreen, FULLSCREEN_VERTEX } from './fullscreen';
import { createGpuPool, surfacePoolSpecs } from './gpuPool';

const PROBE_SLOTS = 8;

/** Calls that allocate or write 3D storage, the copy paths a write must not take, and draws. */
const RECORDED = [
  'texStorage3D',
  'texImage3D',
  'texSubImage3D',
  'copyTexSubImage3D',
  'compressedTexSubImage3D',
  'generateMipmap',
  'blitFramebuffer',
  'framebufferTextureLayer',
  'drawArrays',
] as const;

export interface GlCall {
  fn: (typeof RECORDED)[number];
  /** Numbers as passed; a typed array as `Uint16Array(4356)`. */
  args: (number | string | null)[];
}

export type Phase = 'alloc' | 'warm' | 'write' | 'readback';

export interface ProbeReport {
  /** The unmasked renderer, so the spec can tell SwiftShader from Metal. */
  renderer: string;
  calls: Record<Phase, GlCall[]>;
  /** gl.getError() at the end of each phase. */
  glError: Record<Phase, number>;
  /**
   * The largest |sampled − written| per readback, in height codes or shore/water bytes. Shore and
   * water sample as unsigned normalized values; round(v × 255) recovers the byte.
   */
  worst: {
    /** Written texels, sampled at their centers. */
    centers: { heightMip2: number; shoreWaterMip2: number };
    /** Bilinear at texel corners, and trilinear halfway between mips 1 and 2. */
    filtered: { heightMip2Corners: number; heightMip0Corners: number; heightLod1_5: number };
    /** Levels and slots never written, which read 0. */
    unwritten: {
      heightMip0: number;
      heightMip1: number;
      heightSlot4: number;
      shoreWaterMip0: number;
    };
    edges: { written: number; unwritten: number };
  };
}

declare global {
  interface Window {
    /** Set by gpuPoolProbe.main.ts when e2e/gpu-pool.html loads. */
    gpuPoolProbe?: Promise<ProbeReport>;
  }
}

// Written: heights mip 2 of slot 5 (the smoke test's headline), mips 1-2 of slot 6 and mip 0 of
// slot 7; shore and water mip 2 of slot 5; the edge profiles of slot 3.
const SLOT = 5;

export function runGpuPoolProbe(): ProbeReport {
  const renderer = new WebGLRenderer({ antialias: false });
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const calls: Record<Phase, GlCall[]> = { alloc: [], warm: [], write: [], readback: [] };
  const glError = { alloc: 0, warm: 0, write: 0, readback: 0 };
  let phase: Phase = 'alloc';
  record(gl, (call) => calls[phase].push(call));

  const specs = surfacePoolSpecs(PROBE_SLOTS);
  const height = createGpuPool(renderer, specs.height);
  const shoreWater = createGpuPool(renderer, specs.shoreWater);
  const edges = createGpuPool(renderer, specs.edges);
  glError.alloc = gl.getError();

  phase = 'warm';
  height.warm();
  shoreWater.warm();
  edges.warm();
  glError.warm = gl.getError();

  const writes = {
    heightMip2: heightTexels(SLOT, 2, 66, 66),
    shoreWaterMip2: shoreWaterTexels(SLOT, 2, 66),
    heightSlot6Mip1: heightTexels(6, 1, 132, 132),
    heightSlot6Mip2: heightTexels(6, 2, 66, 66),
    heightSlot7Mip0: heightTexels(7, 0, 264, 264),
    edges: heightTexels(3, 0, 257, 4),
  };
  phase = 'write';
  height.write(SLOT, 2, writes.heightMip2);
  shoreWater.write(SLOT, 2, writes.shoreWaterMip2);
  height.write(6, 1, writes.heightSlot6Mip1);
  height.write(6, 2, writes.heightSlot6Mip2);
  height.write(7, 0, writes.heightSlot7Mip0);
  edges.write(3, 0, writes.edges);
  glError.write = gl.getError();

  phase = 'readback';
  const sampler = createSampler(renderer);
  const bytes = (value: number) => Math.round(value * 255);
  const zero = () => [0];
  const worst: ProbeReport['worst'] = {
    centers: {
      heightMip2: sampler.worst(height.texture, centers(SLOT, 2, 66), (x, y) => [
        heightCode(SLOT, 2, x, y),
      ]),
      shoreWaterMip2: sampler.worst(
        shoreWater.texture,
        centers(SLOT, 2, 66),
        (x, y) => shoreWaterBytes(SLOT, 2, x, y),
        bytes,
      ),
    },
    filtered: {
      heightMip2Corners: sampler.worst(height.texture, corners(SLOT, 2, 66), (x, y) => [
        cornerMean(SLOT, 2, x, y),
      ]),
      heightMip0Corners: sampler.worst(height.texture, corners(7, 0, 264), (x, y) => [
        cornerMean(7, 0, x, y),
      ]),
      // A mip 2 texel center is the corner of four mip 1 texels.
      heightLod1_5: sampler.worst(height.texture, centers(6, 1.5, 66), (x, y) => [
        (cornerMean(6, 1, 2 * x, 2 * y) + heightCode(6, 2, x, y)) / 2,
      ]),
    },
    unwritten: {
      heightMip0: sampler.worst(height.texture, centers(SLOT, 0, 264), zero),
      heightMip1: sampler.worst(height.texture, centers(SLOT, 1, 132), zero),
      heightSlot4: sampler.worst(height.texture, centers(SLOT - 1, 2, 66), zero),
      shoreWaterMip0: sampler.worst(shoreWater.texture, centers(SLOT, 0, 264), () => [0, 0], bytes),
    },
    edges: {
      written: sampler.worst(edges.texture, centers(3, 0, 257, 4), (x, y) => [
        heightCode(3, 0, x, y),
      ]),
      unwritten: sampler.worst(edges.texture, centers(4, 0, 257, 4), zero),
    },
  };
  glError.readback = gl.getError();

  const report = { renderer: rendererName(gl), calls, glError, worst };
  sampler.dispose();
  height.dispose();
  shoreWater.dispose();
  edges.dispose();
  renderer.dispose();
  return report;
}

/** Wraps the recorded methods of this context, so every call three makes is logged. */
function record(gl: WebGL2RenderingContext, log: (call: GlCall) => void): void {
  const methods = gl as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const fn of RECORDED) {
    const original = methods[fn];
    if (original === undefined) throw new Error(`WebGL 2 has no ${fn}`);
    methods[fn] = (...args: unknown[]) => {
      log({ fn, args: args.map(summarize) });
      return original.apply(gl, args);
    };
  }
}

function summarize(arg: unknown): number | string | null {
  if (typeof arg === 'number' || arg === null) return arg;
  if (arg instanceof Uint16Array || arg instanceof Uint8Array || arg instanceof Float32Array) {
    return `${arg.constructor.name}(${arg.length})`;
  }
  return Object.prototype.toString.call(arg);
}

function rendererName(gl: WebGL2RenderingContext): string {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
}

// Distinct codes across neighbors, slots and levels, within ±2000 so half floats hold them exactly.
function heightCode(slot: number, level: number, x: number, y: number): number {
  return ((x * 131 + y * 71 + slot * 29 + level * 17) % 4001) - 2000;
}

function shoreWaterBytes(slot: number, level: number, x: number, y: number): number[] {
  return [(x * 7 + y * 3 + slot + level * 5) & 255, (x * 5 + y * 11 + slot * 3 + level) & 255];
}

/** The mean of the four texels around the corner between texels (x, y) and (x + 1, y + 1). */
function cornerMean(slot: number, level: number, x: number, y: number): number {
  const sum =
    heightCode(slot, level, x, y) +
    heightCode(slot, level, x + 1, y) +
    heightCode(slot, level, x, y + 1) +
    heightCode(slot, level, x + 1, y + 1);
  return sum / 4;
}

function heightTexels(slot: number, level: number, width: number, rows: number): Uint16Array {
  const texels = new Uint16Array(width * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < width; x++) {
      texels[y * width + x] = DataUtils.toHalfFloat(heightCode(slot, level, x, y));
    }
  }
  return texels;
}

function shoreWaterTexels(slot: number, level: number, size: number): Uint8Array {
  const texels = new Uint8Array(size * size * 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      texels.set(shoreWaterBytes(slot, level, x, y), (y * size + x) * 2);
    }
  }
  return texels;
}

/** Sample points, one per output pixel: pixel (x, y) samples texel coordinates (x, y) + offset. */
interface Grid {
  slot: number;
  lod: number;
  /** The sampled level's width and height in texels. */
  texels: [number, number];
  /** 0.5 samples texel centers; 1 samples the corner shared with texel (x + 1, y + 1). */
  offset: number;
  /** Points across and down. */
  points: [number, number];
}

function centers(slot: number, lod: number, width: number, height = width): Grid {
  return { slot, lod, texels: [width, height], offset: 0.5, points: [width, height] };
}

/** The interior corners of a square level. */
function corners(slot: number, lod: number, size: number): Grid {
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

interface Sampler {
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
function createSampler(renderer: WebGLRenderer): Sampler {
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
