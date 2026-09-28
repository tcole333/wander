import { CanvasTexture } from 'three';
import { expect, it } from 'vitest';
import { MemoryAccount } from '../perf/memory';
import { releaseCanvasAfterUpload } from './uploadOnce';

it('keeps a static canvas until upload completes, then drops its native pixels and callback', () => {
  const canvas = { width: 1024, height: 640, getContext: () => null };
  const texture = releaseCanvasAfterUpload(
    new CanvasTexture(canvas as unknown as HTMLCanvasElement),
  );
  const before = new MemoryAccount();
  before.texture('room.backdrop', texture);
  expect(before.report().totals.canvasPixels).toBe(2_621_440);
  expect(texture.image).toBe(canvas);
  const version = texture.version;
  texture.onUpdate?.(texture);
  expect(canvas).toMatchObject({ width: 0, height: 0 });
  expect(texture.image).toBeNull();
  expect(texture.onUpdate).toBeNull();
  expect(texture.version).toBe(version);
  const after = new MemoryAccount();
  after.texture('room.backdrop', texture);
  expect(after.report().totals.canvasPixels).toBe(0);
});
