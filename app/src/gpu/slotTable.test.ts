// Slot allocation for a GPU pool (streaming.md 5.5): fixed root slots, the lowest free slot,
// quarantine after release, and least-recently-drawn eviction of what is not protected.
import { describe, expect, test } from 'vitest';
import { SlotTable } from './slotTable';

const surface = (slots = 32) => new SlotTable({ slots, quarantineFrames: 2, fixedRoots: true });

describe('reserve', () => {
  test('puts L0-L1 tiles in their fixed slots, their node indices', () => {
    const table = surface();
    expect(table.reserve('0/0/0/0')).toBe(0);
    expect(table.reserve('0/5/0/0')).toBe(5);
    expect(table.reserve('1/0/0/0')).toBe(6);
    expect(table.reserve('1/5/1/1')).toBe(29);
  });

  test('gives other tiles the lowest free slot above the fixed ones', () => {
    const table = surface();
    expect(table.reserve('2/0/0/0')).toBe(30);
    expect(table.reserve('2/0/1/0')).toBe(31);
  });

  test('gives a tile that already holds a slot the same slot', () => {
    const table = surface();
    const slot = table.reserve('7/1/103/50');
    expect(table.reserve('7/1/103/50')).toBe(slot);
    expect(table.free).toBe(1);
  });

  test('returns undefined when no slot is free', () => {
    const table = surface(31);
    table.reserve('2/0/0/0');
    expect(table.reserve('2/0/1/0')).toBeUndefined();
  });

  test('holds a tile as uploading until it is published', () => {
    const table = surface();
    table.reserve('2/0/0/0');
    expect(table.stateOf('2/0/0/0')).toBe('uploading');
    table.publish('2/0/0/0');
    expect(table.stateOf('2/0/0/0')).toBe('resident');
  });
});

describe('release', () => {
  test('keeps the slot out of use for the quarantine frames', () => {
    const table = surface(31);
    table.reserve('2/0/0/0');
    table.release('2/0/0/0');
    expect(table.slotOf('2/0/0/0')).toBeUndefined();
    expect(table.reserve('2/0/1/0')).toBeUndefined();
    table.endFrame();
    expect(table.reserve('2/0/1/0')).toBeUndefined();
    table.endFrame();
    expect(table.reserve('2/0/1/0')).toBe(30);
  });

  test('never frees a fixed slot', () => {
    const table = surface();
    table.reserve('1/2/0/1');
    expect(() => table.release('1/2/0/1')).toThrow(/fixed slot/);
  });
});

describe('evictionCandidate', () => {
  function withResident(keys: string[]): SlotTable {
    const table = surface(40);
    for (const key of keys) {
      table.reserve(key);
      table.publish(key);
    }
    return table;
  }

  test('is the least recently drawn tile', () => {
    const table = withResident(['2/0/0/0', '2/0/1/0', '2/0/0/1']);
    table.drawn(['2/0/0/0', '2/0/1/0', '2/0/0/1']);
    table.endFrame();
    table.drawn(['2/0/0/0', '2/0/0/1']);
    expect(table.evictionCandidate(() => false)).toBe('2/0/1/0');
  });

  test('skips protected, fixed and uploading tiles', () => {
    const table = withResident(['0/0/0/0', '2/0/0/0', '2/0/1/0']);
    table.reserve('2/0/0/1');
    expect(table.evictionCandidate((key) => key === '2/0/0/0')).toBe('2/0/1/0');
    expect(table.evictionCandidate((key) => key.startsWith('2/'))).toBeUndefined();
  });

  test('takes tiles marked last only when nothing else is left', () => {
    const table = withResident(['2/0/0/0', '2/0/1/0']);
    table.endFrame();
    table.drawn(['2/0/1/0']);
    const last = (key: string) => key === '2/0/0/0';
    expect(table.evictionCandidate(() => false, last)).toBe('2/0/1/0');
    expect(table.evictionCandidate((key) => key === '2/0/1/0', last)).toBe('2/0/0/0');
  });
});

test('a pool without fixed roots allocates from slot 0', () => {
  const table = new SlotTable({ slots: 4, quarantineFrames: 2, fixedRoots: false });
  expect(table.reserve('0/0/0/0')).toBe(0);
  expect(table.reserve('5/0/0/0')).toBe(1);
});
