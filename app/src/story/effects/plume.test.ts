import { expect, it } from 'vitest';
import type { DataTexture } from 'three';
import { MemoryAccount } from '../../perf/memory';
import { Plume } from './plume';

it('releases only the puff atlas after upload, keeping the arrays used to animate and sort puffs', () => {
  const plume = new Plume({
    kind: 'plume',
    at: [118, -8],
    start: 0,
    peak: 1,
    end: 2,
    heightKm: 40,
    drift: [-1, 1],
    seed: 7,
  });
  const atlas = plume.mesh.material.uniforms.uPuff?.value as DataTexture;
  const before = new MemoryAccount();
  before.texture('puff', atlas);
  expect(before.report().totals.arrayBuffers).toBe(65_536);
  atlas.onUpdate?.(atlas);
  const after = new MemoryAccount();
  after.texture('puff', atlas);
  expect(after.report().totals.arrayBuffers).toBe(0);
  plume.inspectMemory(after);
  expect(after.owners['effects.plumeArrays']?.arrayBuffers).toBe(171_600);
  plume.dispose();
});
