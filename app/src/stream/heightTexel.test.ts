// A mark's height texel: read from the source the surface draws at its place, not from whatever
// finer tile the pool still holds there, and never from a tile still uploading.
import { describe, expect, it } from 'vitest';
import { SlotTable } from '../gpu/slotTable';
import { stToDir, tileKey, tileOf, type Tile } from '../surface/cube';
import { heightTexelAt } from './heightTexel';

/** A place on face 2 at (s, t) = (0.3, −0.35), and its tile at each level. */
const [S, T] = [0.3, -0.35];
const dir = stToDir(2, S, T);
const tileAt = (level: number): Tile => ({
  face: 2,
  level,
  x: tileOf(S, level),
  y: tileOf(T, level),
});
const keyAt = (level: number) => tileKey(tileAt(level));

/** A pool holding the place's tiles resident or uploading at these levels, codeMid −10 × each. */
function pool(resident: number[], uploading: number[] = []) {
  const table = new SlotTable({ slots: 64, quarantineFrames: 0, fixedRoots: false });
  const codeMids = new Map<string, number>();
  for (const level of [...resident, ...uploading]) {
    table.reserve(keyAt(level));
    codeMids.set(keyAt(level), -10 * level);
  }
  for (const level of resident) table.publish(keyAt(level));
  return { table, codeMids };
}

describe('heightTexelAt', () => {
  it('reads the source the drawn node holding the place draws from, not a finer resident tile', () => {
    const { table, codeMids } = pool([0, 3, 4, 6]);
    // The view drew L6 there once; now an L5 node draws from its L4 ancestor.
    const drawn = new Map([[keyAt(5), 4]]);
    const texel = heightTexelAt(dir, drawn, table, codeMids, 7);
    expect(texel?.level).toBe(4);
    expect(texel?.slot).toBe(table.slotOf(keyAt(4)));
    expect(texel?.codeMid).toBe(-40);
  });

  it('gives the place’s uv in the source tile’s texels, its border included', () => {
    const { table, codeMids } = pool([3]);
    const texel = heightTexelAt(dir, new Map([[keyAt(3), 3]]), table, codeMids, 7);
    // At L3 the place lies 0.2 and 0.6 of the way across its tile, which holds 256 texels within a
    // border of 4.
    expect(tileAt(3)).toMatchObject({ x: 5, y: 2 });
    expect(texel?.u).toBeCloseTo((4 + 0.2 * 256) / 264, 9);
    expect(texel?.v).toBeCloseTo((4 + 0.6 * 256) / 264, 9);
  });

  it('never reads a tile still uploading, but the resident tile below it', () => {
    const { table, codeMids } = pool([0, 2], [4]);
    const texel = heightTexelAt(dir, new Map([[keyAt(5), 4]]), table, codeMids, 7);
    expect(texel?.level).toBe(2);
  });

  it('reads a place no drawn node holds from its finest resident tile no finer than any drawn', () => {
    const { table, codeMids } = pool([0, 3, 5, 7]);
    const elsewhere = new Map([
      [tileKey({ face: 0, level: 6, x: 1, y: 1 }), 5],
      [tileKey({ face: 0, level: 6, x: 1, y: 2 }), 4],
    ]);
    expect(heightTexelAt(dir, elsewhere, table, codeMids, 7)?.level).toBe(5);
    // Before any node is drawn, the roots.
    expect(heightTexelAt(dir, new Map(), table, codeMids, 7)?.level).toBe(0);
  });

  it('reads nothing where no tile is resident', () => {
    const { table, codeMids } = pool([], [3]);
    expect(heightTexelAt(dir, new Map([[keyAt(3), 3]]), table, codeMids, 7)).toBeNull();
  });
});
