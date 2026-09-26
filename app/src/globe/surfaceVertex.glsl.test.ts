// The surface vertex chunk (streaming.md 5.6): the GLSL holds the mirror's float32 constants and
// face table bit for bit, leaves `position` to its host, and is shaped for three's materials. The
// GPU readback (e2e/globe-mesh.spec.ts) checks what it computes.
import { describe, expect, test } from 'vitest';
import { FACE_THREE } from './faceFrames';
import { glslFaceTable, glslFloatBits, surfaceVertexChunk } from './surfaceVertex.glsl';
import { GRID_SEGMENTS } from './tileGrid';
import { INV_R, QUARTER_PI, TAN_POLY } from './vertexMirror';

const view = new DataView(new ArrayBuffer(4));

/** The float32 value uintBitsToFloat(0x…u) yields. */
function bitsValue(hex: string): number {
  view.setUint32(0, Number.parseInt(hex, 16));
  return view.getFloat32(0);
}

/** Every float the source emits as its bits, in order. */
function emittedFloats(glsl: string): number[] {
  return [...glsl.matchAll(/uintBitsToFloat\(0x([0-9A-F]{8})u\)/g)].map(([, hex]) =>
    bitsValue(hex ?? ''),
  );
}

const { pars, mainStart, defines } = surfaceVertexChunk({
  segments: GRID_SEGMENTS.full,
  debugChecks: false,
});

describe('glslFloatBits', () => {
  test('yields exactly the float32 it is given', () => {
    for (const value of [INV_R, QUARTER_PI, ...TAN_POLY, -0.5, 2 ** -149]) {
      expect(emittedFloats(glslFloatBits(value))).toEqual([value]);
    }
  });

  test('refuses what float32 does not hold exactly', () => {
    for (const value of [0.1, Math.PI / 4, Infinity, NaN]) {
      expect(() => glslFloatBits(value)).toThrow(RangeError);
    }
  });
});

describe('surfaceVertexChunk', () => {
  test("holds the mirror's 1/R, π/4 and tan polynomial as their float32 bits", () => {
    expect(pars).toMatch(`#define WANDER_INV_R ${glslFloatBits(INV_R)}`);
    expect(pars).toMatch(`#define WANDER_QUARTER_PI ${glslFloatBits(QUARTER_PI)}`);
    const tan = /float wanderTan\(float x\) \{[^}]*\}/.exec(pars)?.[0] ?? '';
    expect(emittedFloats(tan)).toEqual(TAN_POLY);
  });

  test("emits WANDER_FACE from the mirror's face table, columns U, V and C", () => {
    const table = /const mat3 WANDER_FACE\[6\] = mat3\[6\]\(([^;]*)\);/.exec(pars)?.[1] ?? '';
    const faces = [...table.matchAll(/mat3\(([^)]*)\)/g)].map(([, entries]) =>
      (entries ?? '').split(',').map(Number),
    );
    expect(faces).toEqual(FACE_THREE.map((columns) => columns.flat()));
    expect(pars).toContain(glslFaceTable());
  });

  test('refuses a face table entry other than 0 or ±1', () => {
    const [U, V, C] = FACE_THREE[0] ?? [];
    if (!U || !V || !C) throw new Error('no face 0');
    expect(() => glslFaceTable([[[0.5, 0, 0], V, C]])).toThrow(RangeError);
  });

  test('reads position but leaves its declaration to three or the readback program', () => {
    expect(pars).toMatch(/\bposition\.xy\b/);
    expect(pars).not.toMatch(/\bin\s+\w+\s+position\s*;/);
  });

  test('declares invariant gl_Position and the two instance attributes, nothing else', () => {
    expect(pars).toMatch(/^invariant gl_Position;$/m);
    expect(
      [...pars.matchAll(/^in\s+(\w+)\s+(\w+);$/gm)].map(([, type, name]) => `${type} ${name}`),
    ).toEqual(['uvec4 wanderNode', 'uvec4 wanderPrev']);
  });

  test('sets the grid per tier through defines, and main starts with the vertex', () => {
    for (const segments of Object.values(GRID_SEGMENTS)) {
      const chunk = surfaceVertexChunk({ segments, debugChecks: false });
      expect(chunk.defines).toEqual({ WANDER_G: segments, WANDER_LOG2G: Math.log2(segments) });
      expect(chunk.pars).toBe(pars);
    }
    expect(defines.WANDER_G).toBe(32);
    expect(mainStart).toMatch(/^\s*WanderVertex wv = wanderVertex\(\);/);
  });

  test('adds the skirt tint only with debug checks', () => {
    const plain = surfaceVertexChunk({ segments: GRID_SEGMENTS.lite, debugChecks: false });
    const debug = surfaceVertexChunk({ segments: GRID_SEGMENTS.lite, debugChecks: true });
    expect([plain.fragmentPars, plain.fragmentDebug]).toEqual(['', '']);
    expect(debug.defines.WANDER_DEBUG_CHECKS).toBe(1);
    expect(debug.fragmentPars).toContain('in float vWanderSkirt;');
    expect(debug.fragmentDebug).toContain('vWanderSkirt > 0.0');
  });
});
