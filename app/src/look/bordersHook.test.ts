import { describe, expect, it } from 'vitest';
import { BORDER_FACES, BORDER_TEXELS } from '../data/borders';
import { MemoryAccount } from '../perf/memory';
import {
  BORDER_WEIGHTS,
  createBorderUniforms,
  createStepUniforms,
  fillBorderField,
  OUTER_TODAY,
  outerWeight,
  sourceVector,
  uploadBorderFace,
  WEIGHT_NEAR_KM,
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

describe("the outer line's weights", () => {
  const today = [OUTER_TODAY.widthPx, OUTER_TODAY.darken, OUTER_TODAY.halfDotPx, 0];
  const look = (name: string, viewKm: number) => [...outerWeight(name, viewKm).toArray()];

  it.each(Object.keys(BORDER_WEIGHTS))('%s draws today’s line at 6,000 km and closer', (name) => {
    for (const viewKm of [300, 2500, WEIGHT_NEAR_KM]) expect(look(name, viewKm)).toEqual(today);
  });

  it.each(Object.entries(BORDER_WEIGHTS))(
    '%s reaches its far look at world view',
    (name, weight) => {
      const { widthPx, darken, halfDotPx, follow } = weight.far;
      expect(look(name, Infinity)).toEqual([widthPx, darken, halfDotPx, follow]);
    },
  );

  it('eases the eased weight on through 17,500 km, where the others are already full', () => {
    const [eased] = look('eased', 17_500);
    expect(eased).toBeGreaterThan(OUTER_TODAY.widthPx);
    expect(eased).toBeLessThan(BORDER_WEIGHTS.eased.far.widthPx);
    expect(look('wide', 17_500)[0]).toBe(BORDER_WEIGHTS.wide.far.widthPx);
  });

  it("draws today's line for a name no weight has, and starts the steps' uniform there", () => {
    expect(look('heavier', Infinity)).toEqual(today);
    expect([...createStepUniforms('full').lookBorderOuter.value.toArray()]).toEqual(today);
  });
});
