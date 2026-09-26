// A decoded tile as upload parts (streaming.md 5.4): heights first, then shore and water, then the
// edge profiles, each part one write of one level into the tile's slot.
import { expect, test } from 'vitest';
import type { DecodedWst } from '../surface/wst';
import type { GpuPool, PoolArray } from './gpuPool';
import { surfaceParts, type SurfacePools } from './surfaceUploads';

interface Write {
  pool: string;
  slot: number;
  level: number;
  texels: PoolArray;
}

/** Pools that record each write instead of making it. */
function recordingPools(log: Write[]): SurfacePools {
  const pool = <A extends PoolArray>(name: string) =>
    ({
      write: (slot: number, level: number, texels: A) =>
        log.push({ pool: name, slot, level, texels }),
    }) as unknown as GpuPool<A>;
  return {
    height: pool<Uint16Array>('height'),
    shoreWater: pool<Uint8Array>('shoreWater'),
    edges: pool<Uint16Array>('edges'),
  };
}

const tile = {
  heightMips: [264, 132, 66].map((size) => new Uint16Array(size * size)),
  channelMips: [264, 132, 66].map((size) => new Uint8Array(2 * size * size)),
  edges: new Uint16Array(257 * 12 * 2),
} as unknown as DecodedWst;

test('writes the heights, then shore and water, then the edges, into the one slot', () => {
  const log: Write[] = [];
  for (const part of surfaceParts(recordingPools(log), 42, tile)) part.write();
  expect(log.map(({ pool, slot, level }) => `${pool} ${level} @${slot}`)).toEqual([
    'height 0 @42',
    'height 1 @42',
    'height 2 @42',
    'shoreWater 0 @42',
    'shoreWater 1 @42',
    'shoreWater 2 @42',
    'edges 0 @42',
  ]);
  expect(log.map(({ texels }) => texels)).toEqual([
    ...tile.heightMips,
    ...tile.channelMips,
    tile.edges,
  ]);
});

test('sizes each part by the bytes it writes', () => {
  expect(surfaceParts(recordingPools([]), 0, tile).map((part) => part.bytes)).toEqual([
    139_392, 34_848, 8_712, 139_392, 34_848, 8_712, 12_336,
  ]);
});
