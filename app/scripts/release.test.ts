// The release's surface section (streaming.md 3.8) from the coverage and surface records (7.2).
import { describe, expect, test } from 'vitest';
import { surfaceRelease } from './release';

const coverage = { qLand: [39.09375, 2], c200: [-5, -100], avail: 'Pw==' };
const surface = { ver: '4359ef83', maxLevel: 1, avail: 'Pw==', bounds: 'surf/4359ef83/bounds.bin' };

describe('surfaceRelease', () => {
  test('takes the layer from the surface record and the code scale from coverage', () => {
    expect(surfaceRelease(coverage, surface)).toEqual({
      ver: '4359ef83',
      maxLevel: 1,
      qLand: [39.09375, 2],
      c200: [-5, -100],
      avail: 'Pw==',
      bounds: 'surf/4359ef83/bounds.bin',
    });
  });

  test('refuses records built from different coverage', () => {
    expect(() => surfaceRelease(coverage, { ...surface, avail: 'Pg==' })).toThrow(
      /another coverage record/,
    );
  });

  test('refuses a code scale without one entry per level', () => {
    expect(() => surfaceRelease({ ...coverage, qLand: [39.09375] }, surface)).toThrow(
      /one entry per level 0-1/,
    );
  });
});
