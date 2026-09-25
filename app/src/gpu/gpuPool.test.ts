// Pool specs only; the pool itself needs WebGL 2 and is checked by e2e/gpu-pool.spec.ts.
import { describe, expect, it } from 'vitest';
import {
  HEIGHT_R16F,
  MAX_SLOTS,
  poolBytesPerSlot,
  surfacePoolSpecs,
  validatePoolSpec,
  type PoolSpec,
} from './gpuPool';

const surface = surfacePoolSpecs(MAX_SLOTS);

function heights(overrides: Partial<PoolSpec<Uint16Array>>): PoolSpec<Uint16Array> {
  return { ...surface.height, ...overrides };
}

describe('surfacePoolSpecs', () => {
  it('stores heights with mips 0-2 of the 264² tile', () => {
    expect(surface.height).toMatchObject({ width: 264, height: 264, levels: 3 });
  });

  it('stores shore and water with mips 0-2 of the 264² tile', () => {
    expect(surface.shoreWater).toMatchObject({ width: 264, height: 264, levels: 3 });
  });

  it('stores the four edge profiles as 257 × 4 R16F, one level, Nearest', () => {
    expect(surface.edges).toMatchObject({
      channel: HEIGHT_R16F,
      width: 257,
      height: 4,
      levels: 1,
      filter: 'nearest',
    });
  });

  it('fits every pool at the full tier', () => {
    for (const spec of Object.values(surface)) expect(() => validatePoolSpec(spec)).not.toThrow();
  });

  // The slot that streaming.md 5.4 stages over two frames.
  it('takes 359 KiB per surface slot: 182,952 + 182,952 + 2,056 bytes', () => {
    const bytes = Object.values(surface).map((spec) => poolBytesPerSlot(spec));
    expect(bytes).toEqual([182_952, 182_952, 2_056]);
  });
});

describe('validatePoolSpec', () => {
  it('accepts a two-level 132² overlay pool', () => {
    expect(() =>
      validatePoolSpec(heights({ width: 132, height: 132, levels: 2, slots: 160 })),
    ).not.toThrow();
  });

  it('rejects more slots than the ES 3.0 minimum of 256 array layers', () => {
    expect(() => validatePoolSpec(heights({ slots: 257 }))).toThrow(RangeError);
  });

  it('rejects a pool without slots', () => {
    expect(() => validatePoolSpec(heights({ slots: 0 }))).toThrow(RangeError);
  });

  it('rejects a fractional slot count', () => {
    expect(() => validatePoolSpec(heights({ slots: 7.5 }))).toThrow(RangeError);
  });

  it('rejects zero levels', () => {
    expect(() => validatePoolSpec(heights({ levels: 0 }))).toThrow(RangeError);
  });

  it('accepts the full mip chain of a 264² pool, down to 1²', () => {
    expect(() => validatePoolSpec(heights({ levels: 9 }))).not.toThrow();
  });

  it('rejects more levels than the mip chain has', () => {
    expect(() => validatePoolSpec(heights({ levels: 10 }))).toThrow(RangeError);
  });

  it('rejects a width over the ES 3.0 minimum texture size of 2048', () => {
    expect(() => validatePoolSpec(heights({ width: 2049 }))).toThrow(RangeError);
  });

  it('rejects an empty height', () => {
    expect(() => validatePoolSpec(heights({ height: 0 }))).toThrow(RangeError);
  });
});
