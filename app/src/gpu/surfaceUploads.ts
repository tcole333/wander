// A decoded surface tile as upload parts (streaming.md 5.4, 5.5): one pool write per mip of the
// heights, then per mip of shore and water, then the edge profiles. At `uploadAnimated` (256 KiB on
// lite) the three height mips (183 KB) fit one frame and the rest the next: two frames, height first.
import type { WebGLRenderer } from 'three';
import type { DecodedWst } from '../surface/wst';
import { createGpuPool, surfacePoolSpecs, type GpuPool } from './gpuPool';
import type { UploadPart } from './uploadQueue';

export interface SurfacePools {
  height: GpuPool<Uint16Array>;
  shoreWater: GpuPool<Uint8Array>;
  edges: GpuPool<Uint16Array>;
}

export function createSurfacePools(renderer: WebGLRenderer, slots: number): SurfacePools {
  const specs = surfacePoolSpecs(slots);
  return {
    height: createGpuPool(renderer, specs.height),
    shoreWater: createGpuPool(renderer, specs.shoreWater),
    edges: createGpuPool(renderer, specs.edges),
  };
}

/** The parts that write `tile` into `slot` of each pool, heights first. */
export function surfaceParts(pools: SurfacePools, slot: number, tile: DecodedWst): UploadPart[] {
  const part = <A extends Uint16Array | Uint8Array>(
    pool: GpuPool<A>,
    level: number,
    texels: A,
  ) => ({
    bytes: texels.byteLength,
    write: () => pool.write(slot, level, texels),
  });
  return [
    ...tile.heightMips.map((texels, level) => part(pools.height, level, texels)),
    ...tile.channelMips.map((texels, level) => part(pools.shoreWater, level, texels)),
    part(pools.edges, 0, tile.edges),
  ];
}
