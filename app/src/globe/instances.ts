// A drawn tile's instance data (streaming.md 5.6): two uvec4 of integers, 32 bytes. Sub-rects,
// mips, the L1 bevel slot and expected keys are all exact functions of these integers, so the
// shader derives them rather than reading inexact floats (1/264 is not dyadic).
//
// wanderNode, the current state:
//   .x  x (bits 0-7), y (8-15), node level N (16-19), face (20-22), source level s (23-26)
//   .y  source codeMid + 32768 (0-15), up codeMid + 32768 (16-31)
//   .z  source slot (0-7), up slot (8-15)
//   .w  seam flags (0-23)
// The up fields are the parent of the source (level s − 1), filled only when a seam flag asks for
// it (CS_MASK). wanderPrev, for E2's morphs and fades, holds one previous state and a transition:
//   .x  previous source and up codeMid + 32768
//   .y  previous source slot (0-7), up slot (8-15), source level (16-18), kind (19-20),
//       duration in 8 ms units (21-30)
//   .z  previous seam flags
//   .w  the transition's start in seconds, as float32 bits
import type { Tile } from '../surface/cube';

export const INSTANCE_WORDS = 8;
/** Instances the buffer holds; three caches the count at first bind, so it never grows. */
export const INSTANCE_CAPACITY = 1024;

/** Seam flag bits: per edge e (N 0, E 1, S 2, W 3) and corner c (SW 0, SE 1, NW 2, NE 3). */
export const flag = {
  /** The node across edge e is one level coarser: this side has T-junctions. */
  cN: (e: number) => 1 << e,
  /** The coarsest source on the first half of edge e (along index below G/2) is s − 1. */
  cS0: (e: number) => 1 << (4 + e),
  /** The same for the second half. */
  cS1: (e: number) => 1 << (8 + e),
  /** The coarsest source touching corner c is s − 1. */
  cornerCS: (c: number) => 1 << (12 + 3 * c),
  /** The coarsest node touching corner c is dN (0-2) levels coarser. */
  cornerDN: (c: number, dN: number) => dN << (13 + 3 * c),
};

/** The flags that make a vertex read the up tile: every cS bit. */
export const CS_MASK = 0x249ff0;

export interface SourceRef {
  slot: number;
  level: number;
  codeMid: number;
}

export interface UpRef {
  slot: number;
  codeMid: number;
}

export interface InstanceState {
  tile: Tile;
  src: SourceRef;
  /** The parent of the source; present exactly when a flag in CS_MASK is set. */
  up?: UpRef;
  flags: number;
  prev?: { src: SourceRef; up?: UpRef; flags: number };
  transition?: { kind: 1 | 2; startS: number; durationMs: number };
}

const MID_BIAS = 32768;
const DURATION_UNIT_MS = 8;

export function packInstance(words: Uint32Array, i: number, state: InstanceState): void {
  if (!Number.isInteger(i) || i < 0 || i >= INSTANCE_CAPACITY) {
    throw new RangeError(`instance ${i} is past the capacity of ${INSTANCE_CAPACITY}`);
  }
  if (words.length < INSTANCE_WORDS * (i + 1)) throw new RangeError(`no room for instance ${i}`);
  const { tile, src, flags } = state;
  const { face, level, x, y } = tile;
  check('face', face, 0, 5);
  check('level', level, 0, 7);
  check('x', x, 0, 2 ** level - 1);
  check('y', y, 0, 2 ** level - 1);
  check('source level', src.level, 0, level);
  checkFlags(flags, src.level, state.up);
  const up = flagsNeedUp(flags) ? state.up : undefined;
  const at = INSTANCE_WORDS * i;
  words[at] = (x | (y << 8) | (level << 16) | (face << 20) | (src.level << 23)) >>> 0;
  words[at + 1] = mids(src.codeMid, up?.codeMid);
  words[at + 2] = slots(src.slot, up?.slot);
  words[at + 3] = flags >>> 0;

  const { prev, transition } = state;
  if (!prev || !transition) {
    if (prev || transition) throw new RangeError('prev and transition come together');
    words.fill(0, at + 4, at + 8);
    return;
  }
  check('previous source level', prev.src.level, 0, 7);
  checkFlags(prev.flags, prev.src.level, prev.up);
  const prevUp = flagsNeedUp(prev.flags) ? prev.up : undefined;
  const units = Math.round(transition.durationMs / DURATION_UNIT_MS);
  check('transition duration (8 ms units)', units, 0, 1023);
  words[at + 4] = mids(prev.src.codeMid, prevUp?.codeMid);
  words[at + 5] =
    (slots(prev.src.slot, prevUp?.slot) |
      (prev.src.level << 16) |
      (transition.kind << 19) |
      (units << 21)) >>>
    0;
  words[at + 6] = prev.flags >>> 0;
  words[at + 7] = floatBits(transition.startS);
}

export function unpackInstance(words: Uint32Array, i: number): InstanceState {
  const at = INSTANCE_WORDS * i;
  const [w0 = 0, w1 = 0, w2 = 0, w3 = 0, p0 = 0, p1 = 0, p2 = 0, p3 = 0] = words.subarray(
    at,
    at + INSTANCE_WORDS,
  );
  const state: InstanceState = {
    tile: {
      face: (w0 >>> 20) & 7,
      level: (w0 >>> 16) & 15,
      x: w0 & 255,
      y: (w0 >>> 8) & 255,
    },
    src: { slot: w2 & 255, level: (w0 >>> 23) & 15, codeMid: (w1 & 0xffff) - MID_BIAS },
    flags: w3,
  };
  if (flagsNeedUp(w3)) state.up = { slot: (w2 >>> 8) & 255, codeMid: (w1 >>> 16) - MID_BIAS };
  const kind = (p1 >>> 19) & 3;
  if (kind === 1 || kind === 2) {
    state.prev = {
      src: { slot: p1 & 255, level: (p1 >>> 16) & 7, codeMid: (p0 & 0xffff) - MID_BIAS },
      flags: p2,
    };
    if (flagsNeedUp(p2))
      state.prev.up = { slot: (p1 >>> 8) & 255, codeMid: (p0 >>> 16) - MID_BIAS };
    state.transition = {
      kind,
      startS: bitsFloat(p3),
      durationMs: ((p1 >>> 21) & 1023) * DURATION_UNIT_MS,
    };
  }
  return state;
}

/** What the vertex shader's wanderDecode reads from wanderNode, bit for bit. */
export interface DecodedNode {
  xy: [number, number];
  level: number;
  face: number;
  src: number;
  srcSlot: number;
  upSlot: number;
  srcMid: number;
  upMid: number;
  flags: number;
}

/** A port of the GLSL wanderDecode (surfaceVertex.glsl.ts), for the round-trip tests. */
export function glslDecode(words: Uint32Array, i: number): DecodedNode {
  const at = INSTANCE_WORDS * i;
  const [x = 0, y = 0, z = 0, w = 0] = words.subarray(at, at + 4);
  return {
    xy: [x & 0xff, (x >>> 8) & 0xff],
    level: (x >>> 16) & 0xf,
    face: (x >>> 20) & 7,
    src: (x >>> 23) & 0xf,
    srcMid: (y & 0xffff) - 32768,
    upMid: (y >>> 16) - 32768,
    srcSlot: z & 0xff,
    upSlot: (z >>> 8) & 0xff,
    flags: w,
  };
}

export function flagsNeedUp(flags: number): boolean {
  return (flags & CS_MASK) !== 0;
}

function checkFlags(flags: number, sourceLevel: number, up: UpRef | undefined): void {
  check('seam flags', flags, 0, 2 ** 24 - 1);
  for (let c = 0; c < 4; c += 1) {
    if (((flags >>> (13 + 3 * c)) & 3) === 3) throw new RangeError(`corner ${c} has dN 3`);
  }
  const needUp = flagsNeedUp(flags);
  if (needUp && sourceLevel === 0) throw new RangeError('a level-0 source has no parent to read');
  if (needUp !== (up !== undefined)) {
    throw new RangeError(
      needUp ? 'the flags read an up tile none was given' : 'an up tile no flag reads',
    );
  }
}

function mids(src: number, up: number | undefined): number {
  check('codeMid', src, -32768, 32767);
  if (up === undefined) return src + MID_BIAS;
  check('up codeMid', up, -32768, 32767);
  return ((src + MID_BIAS) | ((up + MID_BIAS) << 16)) >>> 0;
}

function slots(src: number, up: number | undefined): number {
  check('slot', src, 0, 255);
  if (up === undefined) return src;
  check('up slot', up, 0, 255);
  return src | (up << 8);
}

function check(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer in ${min}..${max}, got ${value}`);
  }
}

const scratch = new DataView(new ArrayBuffer(4));
function floatBits(value: number): number {
  scratch.setFloat32(0, value);
  return scratch.getUint32(0);
}
function bitsFloat(bits: number): number {
  scratch.setUint32(0, bits);
  return scratch.getFloat32(0);
}
