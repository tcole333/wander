// publish-data's local half (streaming.md 4.2, 4.3): the keys a release names in an output root, and
// the headers each object is uploaded with. Nothing here reaches the network.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Release } from '../src/data/release';
import { objectHeaders } from './objectHeaders';
import { releaseSections } from './publish';

// Bits 0-6: the six L0 nodes and L1 node 6 (face 0, x 0, y 0).
const SEVEN = 'fwAAAA==';
const FILES: Record<string, number> = {
  'surf/aaaa1111/bounds.bin': 12,
  ...Object.fromEntries([0, 1, 2, 3, 4, 5].map((f) => [`surf/aaaa1111/0/${f}/0/0.wst`, 100 + f])),
  'surf/aaaa1111/1/0/0/0.wst': 200,
  // An older bake's version, left in the same output root.
  'surf/bbbb2222/0/0/0/0.wst': 300,
};

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'wander-publish-'));
  for (const [key, size] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, key)), { recursive: true });
    writeFileSync(join(root, key), Buffer.alloc(size));
  }
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

function release(avail: string): Release {
  const bounds = 'surf/aaaa1111/bounds.bin';
  const surface = { ver: 'aaaa1111', maxLevel: 1, qLand: [1, 1], c200: [0, 0], avail, bounds };
  return { id: '0', built: '', dataHost: '', surface };
}

describe('releaseSections', () => {
  test("names bounds.bin and every tile of the release's version, with their sizes", () => {
    const [surface] = releaseSections(release(SEVEN), root);
    const expected = Object.entries(FILES).filter(([key]) => key.startsWith('surf/aaaa1111/'));
    expect(surface?.prefix).toBe('surf/aaaa1111/');
    expect(surface?.objects.map(({ key, size }) => [key, size]).sort()).toEqual(expected.sort());
  });

  test('refuses a version folder with fewer tiles than the release makes available', () => {
    expect(() => releaseSections(release('/wAAAA=='), root)).toThrow(/7 tiles, not the 8/);
  });
});

describe('objectHeaders', () => {
  test.each(['.wst', '.wot', '.wev', '.bin'])('%s is an immutable octet stream', (extension) => {
    expect(objectHeaders(`surf/aaaa1111/x${extension}`)).toEqual({
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Type': 'application/octet-stream',
    });
  });

  test('.json is immutable JSON', () => {
    expect(objectHeaders('rel/0123456789abcdef.json')?.['Content-Type']).toBe('application/json');
  });

  test('an extension R2 never holds has none', () => {
    expect(objectHeaders('lic/notes.txt')).toBeUndefined();
  });
});
