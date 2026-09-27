import { describe, expect, it } from 'vitest';
import { dataOverride } from './dataOrigin';

describe('dataOverride', () => {
  it('ignores ?data= on the public page', () => {
    const page = { hostname: 'wander.traviscole.xyz', search: '?data=http://127.0.0.1:8791' };
    expect(dataOverride(page)).toBeNull();
  });

  it('reads a named or given data server on a page served from this machine', () => {
    expect(dataOverride({ hostname: '127.0.0.1', search: '?data=fixture' })).toBe(
      'http://127.0.0.1:8791',
    );
    expect(dataOverride({ hostname: 'localhost', search: '?data=http://127.0.0.1:5211/' })).toBe(
      'http://127.0.0.1:5211',
    );
    expect(dataOverride({ hostname: '[::1]', search: '' })).toBeNull();
  });
});
