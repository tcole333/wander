import { BoxGeometry, CanvasTexture } from 'three';
import { WebGLAttributes } from 'three/src/renderers/webgl/WebGLAttributes.js';
import { expect, it, vi } from 'vitest';
import { MemoryAccount } from '../perf/memory';
import { releaseCanvasAfterUpload, releaseGeometryAfterUpload } from './uploadOnce';

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

it('lets the pinned three upload and bind immutable geometry again without its CPU arrays', () => {
  const geometry = new BoxGeometry(2, 4, 6);
  releaseGeometryAfterUpload(geometry);
  const bounds = geometry.boundingBox?.clone();
  const sphere = geometry.boundingSphere?.clone();
  const gl = {
    FLOAT: 0x1406,
    UNSIGNED_SHORT: 0x1403,
    createBuffer: () => ({}),
    bindBuffer: vi.fn(),
    bufferData: vi.fn((_target: number, array: ArrayBufferView) =>
      expect(array.byteLength).toBeGreaterThan(0),
    ),
    bufferSubData: vi.fn(),
    deleteBuffer: vi.fn(),
  };
  const gpu = new WebGLAttributes(gl as unknown as WebGL2RenderingContext);
  const attributes = [...Object.values(geometry.attributes), geometry.index].filter(
    (a) => a !== null,
  );
  for (const attribute of attributes) {
    const bytes = attribute.array.byteLength;
    const count = attribute.count;
    gpu.update(attribute, 0x8892);
    expect(attribute.array.byteLength).toBe(0);
    expect(attribute.count).toBe(count);
    expect(gpu.get(attribute)?.size).toBe(bytes);
    gpu.update(attribute, 0x8892);
    gpu.remove(attribute);
  }
  expect(gl.bufferData).toHaveBeenCalledTimes(attributes.length);
  expect(gl.bufferSubData).not.toHaveBeenCalled();
  expect(gl.deleteBuffer).toHaveBeenCalledTimes(attributes.length);
  expect(geometry.boundingBox).toEqual(bounds);
  expect(geometry.boundingSphere).toEqual(sphere);
});
