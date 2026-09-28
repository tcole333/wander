import { expect, it } from 'vitest';
import { BORDER_FACES, BORDER_TEXELS } from '../data/borders';
import { MemoryAccount } from '../perf/memory';
import { createBorderUniforms, fillBorderField, uploadBorderFace } from './bordersHook';

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
