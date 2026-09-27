// The streamer's sources: each node's deepest usable ancestor-or-self, demoted until nodes that
// touch differ in source by at most one level, so seamFlags accepts the set.
import { Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import { ancestorAt, checkCover } from '../globe/seamFlags';
import { lonLatToDir, tileKey, toThree, type Tile } from '../surface/cube';
import { NodeSelector } from './selectNodes';
import { assignSources } from './sources';

/** A balanced whole cover refined toward Sumbawa from 100 km up, down to L7. */
function cover(): Tile[] {
  const selector = new NodeSelector({ available: () => true, heightRange: () => [0, 0], hMin: 0 });
  const eye = new Vector3(...toThree(lonLatToDir(118.0, -8.25))).multiplyScalar(1.016);
  const pxPerUnit = 900 / (2 * Math.tan(Math.PI / 12));
  return selector.select({
    eye,
    frustum: null,
    pxPerUnit,
    refinePx: 0.83,
    maxLevel: 7,
    cull: false,
  });
}

/** A deterministic hash of a tile, 0..1. */
function hash(tile: Tile): number {
  let h = 2166136261;
  for (const c of tileKey(tile)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) / 2 ** 32;
}

describe('assignSources', () => {
  test('draws every node at its own level, or one above, when every tile is usable', () => {
    const nodes = assignSources(cover(), () => true);
    expect(() => checkCover(nodes)).not.toThrow();
    for (const node of nodes) {
      expect(node.source).toBeLessThanOrEqual(node.tile.level);
      expect(node.source).toBeGreaterThanOrEqual(node.tile.level - 1);
    }
  });

  test('demotes the finer source where touching nodes would differ by two or more', () => {
    const tiles = cover();
    // Every tile to L3; below that, a hashed half of them.
    const usable = (t: Tile) => t.level <= 3 || hash(t) < 0.5;
    const nodes = assignSources(tiles, usable);
    expect(() => checkCover(nodes)).not.toThrow();
    for (const node of nodes) {
      expect(node.source).toBeGreaterThanOrEqual(Math.min(3, node.tile.level));
      expect(usable(ancestorAt(node.tile, node.source))).toBe(true);
    }
    expect(nodes.some((node) => node.source < node.tile.level)).toBe(true);
    expect(Math.max(...nodes.map((node) => node.source))).toBeGreaterThan(3);
  });

  test('falls back to L0 where nothing deeper is usable', () => {
    const nodes = assignSources(cover(), (t) => t.level === 0);
    for (const node of nodes) expect(node.source).toBe(0);
  });
});
