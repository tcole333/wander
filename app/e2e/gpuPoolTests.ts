// The pool smoke test's assertions (streaming.md 5.5, 7.3), shared by the Chromium projects
// (e2e/gpu-pool.spec.ts) and the installed Safari and Firefox (e2e/lab/gpu-pool.lab.ts), so every
// browser is held to the same GL calls and readbacks.
import { expect, test } from '@playwright/test';
import type { GlCall, ProbeReport } from '../src/gpu/gpuPoolProbe';

/** One browser's run of e2e/gpu-pool.html. */
export interface PoolRun {
  report: ProbeReport;
  /** The renderer this browser should report. */
  renderer: RegExp;
  /** Page errors and WebGL warnings, where the browser exposes them to the spec. */
  problems: string[];
}

// WebGL 2 enums in the recorded calls.
const TEXTURE_2D_ARRAY = 0x8c1a;
const R16F = 0x822d;
const RG8 = 0x822b;
const RED = 0x1903;
const RG = 0x8227;
const HALF_FLOAT = 0x140b;
const UNSIGNED_BYTE = 0x1401;
const TRIANGLES = 0x0004;

// One texStorage3D of the probe's 8 slots.
function storage(levels: number, internalFormat: number, width: number, height: number): GlCall {
  return { fn: 'texStorage3D', args: [TEXTURE_2D_ARRAY, levels, internalFormat, width, height, 8] };
}

// One level of one slot at the origin, from `data` (the typed array's name and length).
function subImage(
  level: number,
  slot: number,
  width: number,
  height: number,
  format: number,
  type: number,
  data: string,
): GlCall {
  return {
    fn: 'texSubImage3D',
    args: [TEXTURE_2D_ARRAY, level, 0, 0, slot, width, height, 1, format, type, data],
  };
}

/** Declares the pool tests against the run `get` returns once the probe has run. */
export function definePoolTests(get: () => PoolRun): void {
  test('runs on the renderer its project names', () => {
    const { report, renderer } = get();
    expect(report.renderer).toMatch(renderer);
  });

  test('allocates each pool once, with its whole mip chain', () => {
    expect(get().report.calls.alloc).toEqual([
      storage(3, R16F, 264, 264),
      storage(3, RG8, 264, 264),
      storage(1, R16F, 257, 4),
    ]);
  });

  test('warms each pool with one draw and no upload or GL error', () => {
    const { report } = get();
    const draw: GlCall = { fn: 'drawArrays', args: [TRIANGLES, 0, 3] };
    expect({ calls: report.calls.warm, glError: report.glError.warm }).toEqual({
      calls: [draw, draw, draw],
      glError: 0,
    });
  });

  test('writes each mip of a slot with one texSubImage3D', () => {
    expect(get().report.calls.write).toEqual([
      subImage(2, 5, 66, 66, RED, HALF_FLOAT, 'Uint16Array(4356)'),
      subImage(2, 5, 66, 66, RG, UNSIGNED_BYTE, 'Uint8Array(8712)'),
      subImage(1, 6, 132, 132, RED, HALF_FLOAT, 'Uint16Array(17424)'),
      subImage(2, 6, 66, 66, RED, HALF_FLOAT, 'Uint16Array(4356)'),
      subImage(0, 7, 264, 264, RED, HALF_FLOAT, 'Uint16Array(69696)'),
      subImage(0, 3, 257, 4, RED, HALF_FLOAT, 'Uint16Array(1028)'),
    ]);
  });

  test('never regenerates mips or copies through a framebuffer', () => {
    const copies = new Set([
      'generateMipmap',
      'blitFramebuffer',
      'copyTexSubImage3D',
      'framebufferTextureLayer',
    ]);
    const all = Object.values(get().report.calls).flat();
    expect(all.filter(({ fn }) => copies.has(fn))).toEqual([]);
  });

  test('samples written texels back exactly at their centers', () => {
    expect(get().report.worst.centers).toEqual({ heightMip2: 0, shoreWaterMip2: 0 });
  });

  test('filters heights within one code at texel corners and between mips', () => {
    for (const [check, worst] of Object.entries(get().report.worst.filtered)) {
      expect(worst, check).toBeLessThanOrEqual(1);
    }
  });

  test('reads zero from levels and slots never written', () => {
    expect(get().report.worst.unwritten).toEqual({
      heightMip0: 0,
      heightMip1: 0,
      heightSlot4: 0,
      shoreWaterMip0: 0,
    });
  });

  test('reads the edge profiles back exactly', () => {
    expect(get().report.worst.edges).toEqual({ written: 0, unwritten: 0 });
  });

  test('raises no GL error, page error or WebGL warning', () => {
    const { report, problems } = get();
    expect({ glError: report.glError, problems }).toEqual({
      glError: { alloc: 0, warm: 0, write: 0, readback: 0 },
      problems: [],
    });
  });
}
