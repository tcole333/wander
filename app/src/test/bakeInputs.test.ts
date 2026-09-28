import { afterEach, describe, expect, it, vi } from 'vitest';
import { CODE_PATHS, SURFACE_CODE_PATHS, matchesSurfaceCode } from './bakeInputs';
import * as stamp from './stamp';

// These are the independently recorded fingerprints in provenance.md. The compatibility path
// must match BOTH; a recognized old bake never excuses a new surface edit.
const SHIPPED = '07a04a65765ced8063726fa8d91cc4676e38be460e4f339060317ab6a650a499';
const COMPATIBLE = 'a804ffaf4e0ad24cef5f23e4ece67821624538657e29450b803dd99717809da7';

afterEach(() => vi.restoreAllMocks());

describe('the shipped bake’s code provenance', () => {
  it('accepts its audited surface inputs when other stages have changed', () => {
    vi.spyOn(stamp, 'treeSha').mockImplementation((paths) =>
      paths === SURFACE_CODE_PATHS ? COMPATIBLE : 'changed stages',
    );
    expect(matchesSurfaceCode(SHIPPED, '/repo')).toBe(true);
  });

  it('rejects changed surface code even with the shipped code hash', () => {
    vi.spyOn(stamp, 'treeSha').mockReturnValue('changed surface');
    expect(matchesSurfaceCode(SHIPPED, '/repo')).toBe(false);
  });

  it('rejects unknown old code even with the compatible surface fingerprint', () => {
    vi.spyOn(stamp, 'treeSha').mockImplementation((paths) =>
      paths === SURFACE_CODE_PATHS ? COMPATIBLE : 'current tree',
    );
    expect(matchesSurfaceCode('unverified bake', '/repo')).toBe(false);
  });

  it('accepts an exact current tree without needing compatibility evidence', () => {
    const hash = vi.spyOn(stamp, 'treeSha').mockReturnValue('current tree');
    expect(matchesSurfaceCode('current tree', '/repo')).toBe(true);
    expect(hash).toHaveBeenCalledExactlyOnceWith(CODE_PATHS, '/repo');
  });
});
