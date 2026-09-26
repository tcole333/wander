import { DataUtils } from 'three';
import { describe, expect, it } from 'vitest';
import { HALF_EXACT, halfBitsOf, halfValue, intToHalfBits } from './half';

const RANGE = Array.from({ length: 2 * HALF_EXACT + 1 }, (_, k) => k - HALF_EXACT);

describe('intToHalfBits', () => {
  it('agrees with three for every integer within ±2048', () => {
    const off = RANGE.filter((v) => intToHalfBits(v) !== DataUtils.toHalfFloat(v));
    expect(off).toEqual([]);
  });

  it('gives the IEEE binary16 bits of known values', () => {
    const values = [0, 1, -1, 1025, 2047, 2048, -2048];
    expect(values.map(intToHalfBits)).toEqual([
      0x0000, 0x3c00, 0xbc00, 0x6401, 0x67ff, 0x6800, 0xe800,
    ]);
  });

  it('refuses values half-float cannot hold exactly', () => {
    for (const v of [2049, -2049, 0.5, Number.NaN]) {
      expect(() => intToHalfBits(v)).toThrow(RangeError);
    }
  });

  it('is what the table lookup returns', () => {
    const off = RANGE.filter((v) => halfBitsOf(v) !== intToHalfBits(v));
    expect(off).toEqual([]);
  });
});

describe('halfValue', () => {
  it('agrees with three for all 65,536 bit patterns', () => {
    const off = Array.from({ length: 0x10000 }, (_, bits) => bits).filter(
      (bits) => !Object.is(halfValue(bits), DataUtils.fromHalfFloat(bits)),
    );
    expect(off).toEqual([]);
  });

  it('inverts intToHalfBits for every integer within ±2048', () => {
    const off = RANGE.filter((v) => halfValue(intToHalfBits(v)) !== v);
    expect(off).toEqual([]);
  });
});
