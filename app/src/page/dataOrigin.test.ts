import { describe, expect, it } from 'vitest';
import { dataOverride, exploreRequested, memoryRequested } from './dataOrigin';

describe('memoryRequested', () => {
  it('requires an explicit opt-in on an exact loopback hostname', () => {
    for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
      expect(memoryRequested({ hostname, search: '?data=global&memory=1' })).toBe(true);
      for (const search of ['', '?data=global', '?memory', '?memory=0']) {
        expect(memoryRequested({ hostname, search })).toBe(false);
      }
    }
    for (const hostname of ['wander.traviscole.xyz', 'localhost.example.com', '192.168.1.1']) {
      expect(memoryRequested({ hostname, search: '?memory=1' })).toBe(false);
    }
  });
});

describe('exploreRequested', () => {
  it('enables Explore only where a page on this machine asks for it', () => {
    for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
      for (const search of ['?explore', '?data=fixture&explore', '?explore=1&opening=Q48314']) {
        expect(exploreRequested({ hostname, search })).toBe(true);
      }
      for (const search of ['', '?data=fixture', '?explore=0', '?explorer']) {
        expect(exploreRequested({ hostname, search })).toBe(false);
      }
    }
    expect(exploreRequested({ hostname: 'wander.traviscole.xyz', search: '?explore' })).toBe(false);
  });
});

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
