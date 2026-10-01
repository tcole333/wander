// The border steps' GPU array, with the renderer's calls recorded: allocated at once, each band
// written to its slot's face and rows and each cell to its ring layer and place, through staging
// that holds no bytes between writes.
import { DataTexture, type DataArrayTexture, type Vector3, type WebGLRenderer } from 'three';
import { describe, expect, test, vi } from 'vitest';
import { BAND_BYTES, BAND_ROWS, CELL_BYTES } from '../data/borders';
import { createStepUniforms, stepLayers } from '../look/bordersHook';
import { MemoryAccount } from '../perf/memory';
import { BorderArray } from './borderArray';

function array(tier: 'full' | 'lite') {
  const copies: { size: [number, number]; at: [number, number, number]; held: boolean }[] = [];
  const renderer = {
    initTexture: vi.fn(),
    copyTextureToTexture: vi.fn((source: DataTexture, _t: DataArrayTexture, _r, at: Vector3) => {
      copies.push({
        size: [source.image.width, source.image.height],
        at: [at.x, at.y, at.z],
        held: source.image.data !== null,
      });
    }),
  };
  const texture = createStepUniforms(tier).lookBorderField.value;
  const gpu = new BorderArray(renderer as unknown as WebGLRenderer, texture, tier);
  return { gpu, renderer, texture, copies };
}

describe('the border array', () => {
  test('allocates its slots and ring at once: 14 layers on full, 8 on lite', () => {
    for (const tier of ['full', 'lite'] as const) {
      const { gpu, renderer, texture } = array(tier);
      expect(renderer.initTexture).toHaveBeenCalledWith(texture);
      expect(texture.image.depth).toBe(stepLayers(tier));
      expect([gpu.slots, gpu.cells]).toEqual([tier === 'full' ? 2 : 1, 16]);
    }
    expect(stepLayers('full') * 1024 * 1024 * 2).toBe(28 * 1024 * 1024);
    expect(stepLayers('lite') * 1024 * 1024 * 2).toBe(16 * 1024 * 1024);
  });

  test("writes a band to its slot's face at its rows", () => {
    const { gpu, copies } = array('full');
    const part = gpu.band(1, 2, 3 * BAND_ROWS, new Uint8Array(BAND_BYTES));
    expect(part.bytes).toBe(BAND_BYTES);
    part.write();
    expect(copies).toEqual([{ size: [1024, BAND_ROWS], at: [0, 3 * BAND_ROWS, 8], held: true }]);
  });

  test('writes a cell to its ring layer, two across and four down', () => {
    const { gpu, copies } = array('full');
    for (const cell of [0, 1, 2, 7, 8, 15]) gpu.cell(cell, new Uint8Array(CELL_BYTES)).write();
    expect(copies.map(({ at }) => at)).toEqual([
      [0, 0, 12],
      [512, 0, 12],
      [0, 256, 12],
      [512, 768, 12],
      [0, 0, 13],
      [512, 768, 13],
    ]);
    const lite = array('lite');
    lite.gpu.cell(9, new Uint8Array(CELL_BYTES)).write();
    expect(lite.copies[0]?.at).toEqual([512, 0, 7]);
  });

  test('refuses a band or cell of the wrong size, or past its slots and cells', () => {
    const { gpu } = array('lite');
    expect(() => gpu.band(1, 0, 0, new Uint8Array(BAND_BYTES))).toThrow(RangeError);
    expect(() => gpu.band(0, 0, 5, new Uint8Array(BAND_BYTES))).toThrow(RangeError);
    expect(() => gpu.band(0, 0, 0, new Uint8Array(10))).toThrow(RangeError);
    expect(() => gpu.cell(16, new Uint8Array(CELL_BYTES))).toThrow(RangeError);
  });

  test('holds no bytes of its own between writes', () => {
    const { gpu } = array('full');
    gpu.band(0, 0, 0, new Uint8Array(BAND_BYTES)).write();
    gpu.cell(0, new Uint8Array(CELL_BYTES)).write();
    const account = new MemoryAccount();
    gpu.inspectMemory(account);
    expect(account.report().totals.arrayBuffers).toBe(0);
    expect(Object.keys(account.owners).sort()).toEqual(['borders.previews', 'borders.slots']);
  });
});
