// GPU array pools (streaming.md 5.5): one DataArrayTexture per tile part, allocated at boot with
// its whole mip chain and never reallocated. A write uploads one mip of one slot. The recipe
// relies on how three 0.186.1 allocates and copies textures, and the pool smoke test
// (e2e/gpu-pool.spec.ts) checks the exact GL calls three makes for it.
import constants from '@shared/constants.json';
import {
  ClampToEdgeWrapping,
  DataArrayTexture,
  DataTexture,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  NearestFilter,
  NearestMipmapNearestFilter,
  RawShaderMaterial,
  RedFormat,
  RGFormat,
  UnsignedByteType,
  Vector3,
  WebGLRenderTarget,
  type PixelFormat,
  type TextureDataType,
  type WebGLRenderer,
} from 'three';
import { TILE } from '../surface/cube';
import { drawFullscreen, FULLSCREEN_VERTEX } from './fullscreen';

export type PoolArray = Uint16Array | Uint8Array;

export interface PoolChannel<A extends PoolArray> {
  format: PixelFormat;
  type: TextureDataType;
  /** Values per texel. */
  components: number;
  arrayType: { new (length: number): A; readonly BYTES_PER_ELEMENT: number };
}

/** Height codes and edge profiles as half floats, which hold every code (|code| ≤ 2048) exactly. */
export const HEIGHT_R16F: PoolChannel<Uint16Array> = {
  format: RedFormat,
  type: HalfFloatType,
  components: 1,
  arrayType: Uint16Array,
};

/** The shore and water bytes, sampled as unsigned normalized values. */
export const SHORE_WATER_RG8: PoolChannel<Uint8Array> = {
  format: RGFormat,
  type: UnsignedByteType,
  components: 2,
  arrayType: Uint8Array,
};

export interface PoolSpec<A extends PoolArray> {
  channel: PoolChannel<A>;
  /** Level 0 size in texels; level l is `width >> l` by `height >> l`. */
  width: number;
  height: number;
  levels: number;
  slots: number;
  filter: 'linear' | 'nearest';
}

export interface GpuPool<A extends PoolArray> {
  texture: DataArrayTexture;
  spec: PoolSpec<A>;
  bytesPerSlot: number;
  /** Uploads one mip level of one slot; `texels` holds that level, rows first, tightly packed. */
  write(slot: number, level: number, texels: A): void;
  /** One draw into a 1×1 target that samples every slot and level (streaming.md 5.5). */
  warm(): void;
  dispose(): void;
}

/** ES 3.0's minimum MAX_ARRAY_TEXTURE_LAYERS; no pool may exceed it (streaming.md 5.5). */
export const MAX_SLOTS = 256;
/** ES 3.0's minimum MAX_TEXTURE_SIZE. */
const MAX_SIZE = 2048;

const SURFACE_SIZE = TILE + 2 * constants.cube.border;

/** The pools behind a surface tile (streaming.md 3.1, 5.5), each with `slots` slots. */
export function surfacePoolSpecs(slots: number): {
  height: PoolSpec<Uint16Array>;
  shoreWater: PoolSpec<Uint8Array>;
  edges: PoolSpec<Uint16Array>;
} {
  const tile = { width: SURFACE_SIZE, height: SURFACE_SIZE, levels: 3, slots } as const;
  return {
    height: { channel: HEIGHT_R16F, ...tile, filter: 'linear' },
    shoreWater: { channel: SHORE_WATER_RG8, ...tile, filter: 'linear' },
    // Entry k of each edge (N, E, S, W) sits at texel corner k, 0..256 (streaming.md 3.0 item 7).
    edges: {
      channel: HEIGHT_R16F,
      width: TILE + 1,
      height: 4,
      levels: 1,
      slots,
      filter: 'nearest',
    },
  };
}

/** Throws a RangeError unless WebGL 2 on any conforming device can allocate the pool. */
export function validatePoolSpec(spec: PoolSpec<PoolArray>): void {
  const { width, height, levels, slots } = spec;
  requireInteger('width', width, 1, MAX_SIZE);
  requireInteger('height', height, 1, MAX_SIZE);
  requireInteger('slots', slots, 1, MAX_SLOTS);
  requireInteger('levels', levels, 1, Math.floor(Math.log2(Math.max(width, height))) + 1);
}

/** GPU bytes one slot takes across all its levels. */
export function poolBytesPerSlot(spec: PoolSpec<PoolArray>): number {
  let texels = 0;
  for (let level = 0; level < spec.levels; level++) {
    texels += levelSize(spec.width, level) * levelSize(spec.height, level);
  }
  return texels * spec.channel.components * spec.channel.arrayType.BYTES_PER_ELEMENT;
}

/**
 * Allocates the pool with renderer.initTexture, so its storage exists from boot and its filters,
 * wrap, format, type and unpack state are fixed: changing any of them later is either ignored or
 * reallocates the array and empties every slot.
 */
export function createGpuPool<A extends PoolArray>(
  renderer: WebGLRenderer,
  spec: PoolSpec<A>,
): GpuPool<A> {
  validatePoolSpec(spec);
  const { channel, width, height, levels, slots, filter } = spec;
  const sizes = Array.from({ length: levels }, (_, level) => ({
    width: levelSize(width, level),
    height: levelSize(height, level),
  }));

  // The constructor takes no format or type, so they are set afterwards.
  const texture = new DataArrayTexture(null, width, height, slots);
  texture.format = channel.format;
  texture.type = channel.type;
  // three counts these descriptors to size texStorage3D and never reads their data, but
  // @types/three needs real ones.
  texture.generateMipmaps = false;
  texture.mipmaps = sizes.map((size) => ({ data: new channel.arrayType(0), ...size }));
  // Linear magnification returns the mean at a texel corner, where mesh vertices sit; Nearest
  // would return one texel there and break the seams.
  texture.magFilter = filter === 'linear' ? LinearFilter : NearestFilter;
  texture.minFilter = mipFilter(filter, levels);
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  // 3D uploads reject flipY. Rows are tightly packed (an edge row is 514 bytes).
  texture.flipY = false;
  texture.unpackAlignment = 1;
  // Allocate storage without uploading a whole array; needsUpdate makes three allocate it
  // instead of binding its placeholder texture.
  texture.source.dataReady = false;
  texture.needsUpdate = true;
  renderer.initTexture(texture);

  // One staging texture per level size, never given to a material, a uniform or initTexture.
  // Unknown to the renderer and read from level 0, it sends copyTextureToTexture down its
  // texSubImage3D path, with no framebuffer copy and no mip regeneration.
  const staging = sizes.map((size) => new DataTexture(null, size.width, size.height));
  const origin = new Vector3();

  return {
    texture,
    spec,
    bytesPerSlot: poolBytesPerSlot(spec),

    write(slot, level, texels) {
      requireInteger('slot', slot, 0, slots - 1);
      const source = staging[level];
      if (source === undefined) {
        throw new RangeError(`level must be an integer in 0..${levels - 1}, got ${level}`);
      }
      const expected = source.image.width * source.image.height * channel.components;
      if (texels.length !== expected) {
        throw new RangeError(`level ${level} takes ${expected} values, got ${texels.length}`);
      }
      source.image.data = texels;
      renderer.copyTextureToTexture(source, texture, null, origin.set(0, 0, slot), 0, level);
      source.image.data = null;
    },

    warm() {
      const target = new WebGLRenderTarget(1, 1, { depthBuffer: false });
      const material = new RawShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: FULLSCREEN_VERTEX,
        fragmentShader: warmFragment(slots, levels),
        uniforms: { pool: { value: texture } },
      });
      drawFullscreen(renderer, material, target);
      material.dispose();
      target.dispose();
    },

    dispose() {
      texture.dispose();
    },
  };
}

function levelSize(size: number, level: number): number {
  return Math.max(1, size >> level);
}

function mipFilter(filter: PoolSpec<PoolArray>['filter'], levels: number) {
  if (filter === 'linear') return levels > 1 ? LinearMipmapLinearFilter : LinearFilter;
  return levels > 1 ? NearestMipmapNearestFilter : NearestFilter;
}

// ANGLE may zero-fill storage lazily on first use, so the first real draw would pay for it.
// Summing every sample keeps the compiler from dropping any of them.
function warmFragment(slots: number, levels: number): string {
  return /* glsl */ `
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray pool;
out vec4 color;
void main() {
  vec4 sum = vec4(0.0);
  for (int slot = 0; slot < ${slots}; slot++) {
    for (int level = 0; level < ${levels}; level++) {
      sum += textureLod(pool, vec3(0.5, 0.5, float(slot)), float(level));
    }
  }
  color = sum;
}`;
}

function requireInteger(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer in ${min}..${max}, got ${value}`);
  }
}
