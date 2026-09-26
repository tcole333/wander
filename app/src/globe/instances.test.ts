// Instance packing (streaming.md 5.6): every field round-trips over its whole range, the shader's
// decode reads the same bits, and anything out of range is refused.
import { describe, expect, test } from 'vitest';
import {
  CS_MASK,
  flag,
  glslDecode,
  INSTANCE_CAPACITY,
  INSTANCE_WORDS,
  packInstance,
  unpackInstance,
  type InstanceState,
} from './instances';

const words = () => new Uint32Array(INSTANCE_CAPACITY * INSTANCE_WORDS);

/** A seeded generator, so the random round trips repeat. */
function random(seed: number) {
  let state = seed >>> 0;
  return (below: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % below;
  };
}

/** Random flags without dN 3 in any corner. */
function randomFlags(next: (below: number) => number): number {
  let flags = next(1 << 12);
  for (let c = 0; c < 4; c += 1)
    flags |= flag.cornerDN(c, next(3)) | (next(2) ? flag.cornerCS(c) : 0);
  return flags;
}

function randomState(next: (below: number) => number): InstanceState {
  const level = next(8);
  const src = { slot: next(256), level: next(level + 1), codeMid: next(65536) - 32768 };
  let flags = randomFlags(next);
  if (src.level === 0) flags &= ~CS_MASK;
  const state: InstanceState = {
    tile: { face: next(6), level, x: next(2 ** level), y: next(2 ** level) },
    src,
    flags,
  };
  if (flags & CS_MASK) state.up = { slot: next(256), codeMid: next(65536) - 32768 };
  if (next(2)) {
    const prevSrc = { slot: next(256), level: next(8), codeMid: next(65536) - 32768 };
    let prevFlags = randomFlags(next);
    if (prevSrc.level === 0) prevFlags &= ~CS_MASK;
    state.prev = { src: prevSrc, flags: prevFlags };
    if (prevFlags & CS_MASK) state.prev.up = { slot: next(256), codeMid: next(65536) - 32768 };
    state.transition = {
      kind: next(2) ? 1 : 2,
      startS: Math.fround(next(100000) / 64),
      durationMs: 8 * next(1024),
    };
  }
  return state;
}

describe('packInstance and unpackInstance', () => {
  test('round-trip 4,096 random states over every field range', () => {
    const next = random(7);
    const buffer = words();
    for (let n = 0; n < 4096; n += 1) {
      const state = randomState(next);
      const i = n % INSTANCE_CAPACITY;
      packInstance(buffer, i, state);
      expect(unpackInstance(buffer, i)).toEqual(state);
    }
  });

  test('round-trip the ends of every range', () => {
    const buffer = words();
    const state: InstanceState = {
      tile: { face: 5, level: 7, x: 127, y: 127 },
      src: { slot: 255, level: 7, codeMid: -32768 },
      up: { slot: 255, codeMid: 32767 },
      flags:
        0xffffff &
        ~(flag.cornerDN(0, 1) | flag.cornerDN(1, 1) | flag.cornerDN(2, 1) | flag.cornerDN(3, 1)),
      prev: { src: { slot: 0, level: 7, codeMid: 32767 }, flags: 0 },
      transition: { kind: 2, startS: 0, durationMs: 8184 },
    };
    packInstance(buffer, INSTANCE_CAPACITY - 1, state);
    expect(unpackInstance(buffer, INSTANCE_CAPACITY - 1)).toEqual(state);
  });

  test('leave the previous state all zero when there is none', () => {
    const buffer = words().fill(0xffffffff);
    packInstance(buffer, 0, {
      tile: { face: 0, level: 0, x: 0, y: 0 },
      src: { slot: 0, level: 0, codeMid: 0 },
      flags: 0,
    });
    expect([...buffer.subarray(4, 8)]).toEqual([0, 0, 0, 0]);
  });
});

test("glslDecode reads what the shader's wanderDecode reads", () => {
  const next = random(11);
  const buffer = words();
  for (let n = 0; n < 1024; n += 1) {
    const state = randomState(next);
    packInstance(buffer, n, state);
    const decoded = glslDecode(buffer, n);
    expect(decoded).toEqual({
      xy: [state.tile.x, state.tile.y],
      level: state.tile.level,
      face: state.tile.face,
      src: state.src.level,
      srcSlot: state.src.slot,
      upSlot: state.up?.slot ?? 0,
      srcMid: state.src.codeMid,
      upMid: state.up?.codeMid ?? -32768,
      flags: state.flags,
    });
  }
});

describe('packInstance refuses', () => {
  const base: InstanceState = {
    tile: { face: 1, level: 3, x: 2, y: 5 },
    src: { slot: 40, level: 2, codeMid: 12 },
    flags: 0,
  };
  const pack =
    (state: InstanceState, i = 0) =>
    () =>
      packInstance(words(), i, state);

  test.each<[string, InstanceState]>([
    ['slot 256', { ...base, src: { ...base.src, slot: 256 } }],
    ['a source finer than the node', { ...base, src: { ...base.src, level: 4 } }],
    ['x past the level', { ...base, tile: { ...base.tile, x: 8 } }],
    ['face 6', { ...base, tile: { ...base.tile, face: 6 } }],
    ['codeMid past i16', { ...base, src: { ...base.src, codeMid: 32768 } }],
    ['dN 3', { ...base, flags: flag.cornerDN(2, 3) }],
    ['a cS bit without up', { ...base, flags: flag.cS0(1) }],
    ['up without a cS bit', { ...base, up: { slot: 3, codeMid: 0 } }],
    [
      'a cS bit on a level-0 source',
      {
        ...base,
        src: { ...base.src, level: 0 },
        flags: flag.cornerCS(0),
        up: { slot: 1, codeMid: 0 },
      },
    ],
    ['flags past 24 bits', { ...base, flags: 1 << 24 }],
    [
      'a transition over 8,184 ms',
      {
        ...base,
        prev: { src: base.src, flags: 0 },
        transition: { kind: 1, startS: 0, durationMs: 8192 },
      },
    ],
    [
      'a transition without a previous state',
      { ...base, transition: { kind: 1, startS: 0, durationMs: 8 } },
    ],
  ])('%s', (_name, state) => {
    expect(pack(state)).toThrow(RangeError);
  });

  test('more instances than the capacity', () => {
    expect(pack(base, INSTANCE_CAPACITY)).toThrow(/capacity/);
  });
});

test('CS_MASK is every cS bit: both edge halves and the four corners', () => {
  let mask = 0;
  for (let e = 0; e < 4; e += 1) mask |= flag.cS0(e) | flag.cS1(e);
  for (let c = 0; c < 4; c += 1) mask |= flag.cornerCS(c);
  expect(mask).toBe(CS_MASK);
});
