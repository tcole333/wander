// publish-data's decisions (streaming.md 4.3): the keys a release names in an output root, and
// which of them an upload sends given R2's listing. Nothing here reaches the network.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Release } from '../src/data/release';
import { plan, releaseSections } from './publish';
import type { R2Bucket } from './r2';

// Bits 0-6: the six L0 nodes and L1 node 6 (face 0, x 0, y 0).
const SEVEN = 'fwAAAA==';
const BOUNDS = 'surf/aaaa1111/bounds.bin';
const FILES: Record<string, number> = {
  [BOUNDS]: 12,
  ...Object.fromEntries([0, 1, 2, 3, 4, 5].map((f) => [`surf/aaaa1111/0/${f}/0/0.wst`, 100 + f])),
  'surf/aaaa1111/1/0/0/0.wst': 200,
  // An older bake's version, left in the same output root.
  'surf/bbbb2222/0/0/0/0.wst': 300,
  'fd/modera/cccc3333/mean/1816.bin': 90,
  'fd/modera/cccc3333/spread/1816.bin': 60,
  'fd/modera/cccc3333/annual.bin': 400,
};
const MODERA = {
  ver: 'cccc3333',
  years: [1816, 1816] as [number, number],
  lat: [45, -45],
  lon0: -180,
  dlon: 90,
  bytes: { mean: { '1816': 90 }, spread: { '1816': 60 }, annual: 400 },
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
  const surface = { ver: 'aaaa1111', maxLevel: 1, qLand: [1, 1], c200: [0, 0], avail };
  return { id: '0', built: '', dataHost: '', surface: { ...surface, bounds: BOUNDS } };
}

/** R2 as a listing of the keys it holds, with their sizes. */
function holding(held: Record<string, number>): Pick<R2Bucket, 'list'> {
  const keys = Object.entries(held);
  return { list: (prefix) => Promise.resolve(new Map(keys.filter(([k]) => k.startsWith(prefix)))) };
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

  test('names every climate file the modera section lists, with their sizes', () => {
    const [, climate] = releaseSections({ ...release(SEVEN), modera: MODERA }, root);
    const expected = Object.entries(FILES).filter(([key]) => key.startsWith('fd/modera/'));
    expect(climate?.prefix).toBe('fd/modera/cccc3333/');
    expect(climate?.objects.map(({ key, size }) => [key, size]).sort()).toEqual(expected.sort());
  });

  test('refuses a climate file of another size than the modera section gives', () => {
    const modera = { ...MODERA, bytes: { ...MODERA.bytes, annual: 401 } };
    expect(() => releaseSections({ ...release(SEVEN), modera }, root)).toThrow(/400 B, not/);
  });
});

describe('plan', () => {
  test('leaves out the keys R2 already holds at their size', async () => {
    const sections = releaseSections(release(SEVEN), root);
    const [surface] = await plan(holding({ [BOUNDS]: 12 }), sections);
    const others = surface?.objects.map(({ key }) => key).filter((key) => key !== BOUNDS);
    expect(surface?.missing.map(({ key }) => key)).toEqual(others);
  });

  test('stops on a key R2 holds at another size, before anything is uploaded', async () => {
    const sections = releaseSections(release(SEVEN), root);
    await expect(plan(holding({ [BOUNDS]: 13 }), sections)).rejects.toThrow(/13 B, not 12 B/);
  });
});
