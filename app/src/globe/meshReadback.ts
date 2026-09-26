// GPU readback of the surface vertex (streaming.md 5.6, 7.3): what the vertex stage computes for
// every grid vertex of every instance, read back as float32 bits. A THREE.Points draws the grid's
// (k, l, role) attribute over the instance words, as the globe draws its triangles, and a GLSL3
// RawShaderMaterial built from the same pars writes each vertex's results, flat, to pixel
// (gl_VertexID, gl_InstanceID) of an RGBA32F target. A uniform picks the pass, so no pass
// recompiles, and every pass writes its fourth channel, so a pixel no vertex reached keeps the
// clear value and shows up.
import {
  BufferAttribute,
  FloatType,
  GLSL3,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  NearestFilter,
  NoBlending,
  OrthographicCamera,
  Points,
  RawShaderMaterial,
  RGBAFormat,
  Scene,
  Vector2,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import { INSTANCE_CAPACITY, INSTANCE_WORDS } from './instances';
import { surfaceVertexChunk, type SurfaceVertexUniforms } from './surfaceVertex.glsl';
import type { TileGrid } from './tileGrid';

/**
 * What each pass writes per vertex, 4 floats:
 * - position: P.xyz (three space, R = 1) and the role
 * - data: the last point's code, h and disp, and `info`
 * - extra: the last point's shore, the uv, and 1
 */
export const READBACK_PASSES = ['position', 'data', 'extra'] as const;
export type ReadbackPass = (typeof READBACK_PASSES)[number];

/** A pixel no vertex wrote holds this in every channel; every pass writes channel 3 ≥ 0. */
export const UNWRITTEN = -1;

/**
 * The bits of `info`, an exact small integer: land, m, the class (interior 0, edge 1, corner 2,
 * T-junction 3), whether the point is on a face edge, whether it read the up tile, count − 1 (1 at
 * a T-junction), and lv.
 */
export const INFO = {
  land: [0, 1],
  m: [1, 2],
  cls: [3, 2],
  faceEdge: [5, 1],
  up: [6, 1],
  tjunction: [7, 1],
  lv: [8, 3],
} as const satisfies Record<string, readonly [shift: number, bits: number]>;

export type InfoField = keyof typeof INFO;

export function infoField(info: number, field: InfoField): number {
  const [shift, width] = INFO[field];
  return (info >>> shift) & ((1 << width) - 1);
}

/** Per pass, 4 floats per vertex, instance-major: instance i's vertex v at 4·(i·vertices + v). */
export type MeshReadout = Record<ReadbackPass, Float32Array> & {
  vertices: number;
  instances: number;
  /** Wall time of the draws and pixel reads, in milliseconds. */
  ms: number;
};

export interface MeshReadback {
  /** The vertex results of the first `count` instances in `words` (INSTANCE_WORDS each). */
  read(words: Uint32Array, count: number): MeshReadout;
  /** The readback's material, whose program the renderer compiles on the first read. */
  material: RawShaderMaterial;
  dispose(): void;
}

const VERTEX = (pars: string, mainStart: string) => /* glsl */ `
precision highp float;
precision highp int;
in vec3 position;
${pars}
uniform int wanderPass;
uniform vec2 wanderTarget;
flat out vec4 vWanderOut;

void main() {
${mainStart}
  WanderPoint p = wv.last;
  if (wanderPass == 0) {
    vWanderOut = vec4(wv.position, float(wv.role));
  } else if (wanderPass == 1) {
    int info = int(p.land) | (p.m << 1) | (wv.cls << 3) | (int(p.faceEdge) << 5) |
      (int(p.up) << 6) | ((wv.count - 1) << 7) | (p.lv << 8);
    vWanderOut = vec4(p.code, p.h, p.disp, float(info));
  } else {
    vWanderOut = vec4(p.shore, wv.uv, 1.0);
  }
  gl_Position = vec4((vec2(gl_VertexID, gl_InstanceID) + 0.5) / wanderTarget * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}`;

const FRAGMENT = /* glsl */ `
precision highp float;
flat in vec4 vWanderOut;
out vec4 wanderOut;
void main() {
  wanderOut = vWanderOut;
}`;

/** Reads the surface vertex back for `grid`'s tier, with the pools and relief `uniforms` hold. */
export function createMeshReadback(
  renderer: WebGLRenderer,
  grid: TileGrid,
  uniforms: SurfaceVertexUniforms,
  capacity = INSTANCE_CAPACITY,
): MeshReadback {
  const chunk = surfaceVertexChunk({ segments: grid.segments, debugChecks: false });
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(grid.position, 3));
  // A Uint32Array, so three binds both halves with vertexAttribIPointer.
  const words = new Uint32Array(capacity * INSTANCE_WORDS);
  const buffer = new InstancedInterleavedBuffer(words, INSTANCE_WORDS, 1);
  geometry.setAttribute('wanderNode', new InterleavedBufferAttribute(buffer, 4, 0));
  geometry.setAttribute('wanderPrev', new InterleavedBufferAttribute(buffer, 4, 4));
  const pass = { value: 0 };
  const targetSize = { value: new Vector2() };
  const material = new RawShaderMaterial({
    name: `wander-readback-${grid.segments}`,
    glslVersion: GLSL3,
    defines: chunk.defines,
    uniforms: { ...uniforms, wanderPass: pass, wanderTarget: targetSize },
    vertexShader: VERTEX(chunk.pars, chunk.mainStart),
    fragmentShader: FRAGMENT,
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  const scene = new Scene().add(points);
  const camera = new OrthographicCamera();
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const unwritten = new Float32Array(4).fill(UNWRITTEN);
  // One row per instance of a batch: 1,217 × 1,024 texels, 19 MiB, on full.
  const target = new WebGLRenderTarget(grid.vertexCount, capacity, {
    type: FloatType,
    format: RGBAFormat,
    depthBuffer: false,
    magFilter: NearestFilter,
    minFilter: NearestFilter,
  });
  targetSize.value.set(grid.vertexCount, capacity);

  return {
    material,
    read(source, count) {
      if (!Number.isInteger(count) || count < 0 || source.length < count * INSTANCE_WORDS) {
        throw new RangeError(`${count} instances do not fit ${source.length} words`);
      }
      const vertices = grid.vertexCount;
      const out = Object.fromEntries(
        READBACK_PASSES.map((name) => [name, new Float32Array(4 * vertices * count)]),
      ) as Record<ReadbackPass, Float32Array>;
      const start = performance.now();
      const previous = renderer.getRenderTarget();
      // The clear below marks unwritten pixels; the renderer's own clear would erase the mark.
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      for (let first = 0; first < count; first += capacity) {
        const batch = Math.min(capacity, count - first);
        words.set(source.subarray(first * INSTANCE_WORDS, (first + batch) * INSTANCE_WORDS));
        buffer.addUpdateRange(0, batch * INSTANCE_WORDS);
        buffer.needsUpdate = true;
        geometry.instanceCount = batch;
        READBACK_PASSES.forEach((name, index) => {
          pass.value = index;
          renderer.setRenderTarget(target);
          gl.clearBufferfv(gl.COLOR, 0, unwritten);
          renderer.render(scene, camera);
          const pixels = out[name].subarray(4 * vertices * first, 4 * vertices * (first + batch));
          renderer.readRenderTargetPixels(target, 0, 0, vertices, batch, pixels);
        });
      }
      renderer.setRenderTarget(previous);
      renderer.autoClear = autoClear;
      return { ...out, vertices, instances: count, ms: performance.now() - start };
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      target.dispose();
    },
  };
}
