import { describe, expect, it } from 'vitest';
import { tunables } from '../config/tunables';
import { BORDER_FACES, BORDER_TEXELS } from '../data/borders';
import { MemoryAccount } from '../perf/memory';
import {
  createBorderUniforms,
  createStepUniforms,
  ETCHED_LOOK,
  etchedScale,
  fillBorderField,
  innerShare,
  sourceVector,
  uploadBorderFace,
  type BorderSource,
} from './bordersHook';

it('keeps the border backing buffer through partial uploads and releases it after the last upload', () => {
  const uniforms = createBorderUniforms();
  const texture = uniforms.lookBorderField.value;
  // inflateBorders returns a subarray of the complete WBF1 allocation, header included.
  const backingBytes = 16 + BORDER_FACES * BORDER_TEXELS ** 2;
  fillBorderField(uniforms, new Uint8Array(backingBytes).subarray(16));
  const retained = () => {
    const account = new MemoryAccount();
    account.texture('borders.1815', texture);
    return account.report().totals.arrayBuffers;
  };
  for (let face = 0; face < BORDER_FACES; face++) {
    uploadBorderFace(uniforms, face);
    // Scheduling the last face must not discard bytes before three reads them.
    expect(retained()).toBe(backingBytes);
    // WebGLTextures calls onUpdate after texSubImage3D and clearLayerUpdates.
    texture.clearLayerUpdates();
    texture.onUpdate?.(texture);
    expect(retained()).toBe(face < BORDER_FACES - 1 ? backingBytes : 0);
  }
  expect(texture.image).toMatchObject({
    width: BORDER_TEXELS,
    height: BORDER_TEXELS,
    depth: BORDER_FACES,
  });
  expect(texture.onUpdate).toBeNull();
});

describe("the steps' sources", () => {
  it('name a slot by its first layer and a cell by its ring layer, place and channel', () => {
    const at = (tier: 'full' | 'lite', source: BorderSource) => [
      ...sourceVector(tier, source).toArray(),
    ];
    expect(at('full', { kind: 'none' })).toEqual([0, 0, 0, 0]);
    expect(at('full', { kind: 'slot', slot: 1 })).toEqual([1, 6, 0, 0]);
    expect(at('full', { kind: 'cell', cell: 5, channel: 0 })).toEqual([2, 12, 512, 512]);
    expect(at('full', { kind: 'cell', cell: 12, channel: 1 })).toEqual([3, 13, 0, 512]);
    expect(at('lite', { kind: 'cell', cell: 0, channel: 1 })).toEqual([3, 6, 0, 0]);
  });

  it('draw nothing until the runtime gives them a step', () => {
    const uniforms = createStepUniforms('lite');
    expect(uniforms.lookBorderStrength.value).toBe(0);
    expect(uniforms.lookBorderField.value.image).toMatchObject({
      width: 1024,
      height: 1024,
      depth: 8,
    });
    expect([...uniforms.lookBorderB.value.toArray()]).toEqual([0, 0, 0, 0]);
  });
});

describe("the etched outer line's size", () => {
  const { near, far } = tunables.borderWeightKm;

  it('keeps its near size at 14,000 km across and closer', () => {
    for (const viewKm of [300, 3000, 4750, near]) expect(etchedScale(viewKm)).toBe(1);
  });

  it('grows to its far size at world view', () => {
    for (const viewKm of [far, 40_000, Infinity]) expect(etchedScale(viewKm)).toBe(ETCHED_LOOK.far);
  });

  it('grows evenly on a log scale between them', () => {
    const middle = etchedScale(Math.sqrt(near * far));
    expect(middle).toBeCloseTo((1 + ETCHED_LOOK.far) / 2, 9);
    expect(etchedScale(17_500)).toBeGreaterThan(1);
    expect(etchedScale(17_500)).toBeLessThan(middle);
  });

  it("starts the steps' uniform at the near size", () => {
    expect(createStepUniforms('full').lookBorderScale.value).toBe(1);
  });
});

describe("the inner lines' share", () => {
  const fade = tunables.borderInnerKm;
  const close = tunables.borderInnerCloseKm;

  it('draws none at 9,000 km across and wider', () => {
    for (const viewKm of [fade.far, 14_000, Infinity]) expect(innerShare(viewKm)).toBe(0);
  });

  it('draws all from 4,500 to 2,000 km across', () => {
    for (const viewKm of [fade.near, 3000, close.far]) expect(innerShare(viewKm)).toBe(1);
  });

  it('fades in between, half drawn halfway', () => {
    expect(innerShare((fade.near + fade.far) / 2)).toBeCloseTo(0.5, 9);
    expect(innerShare(6000)).toBeGreaterThan(innerShare(8000));
  });

  it('dims close in, to its close share at 1,000 km across and closer', () => {
    for (const viewKm of [close.near, 500, 200]) {
      expect(innerShare(viewKm)).toBeCloseTo(ETCHED_LOOK.inner.close, 9);
    }
    const middle = innerShare(Math.sqrt(close.near * close.far));
    expect(middle).toBeCloseTo((1 + ETCHED_LOOK.inner.close) / 2, 9);
  });
});
