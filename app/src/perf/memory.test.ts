import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DataTexture,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import { describe, expect, it } from 'vitest';
import { MemoryAccount } from './memory';

describe('the CPU memory account', () => {
  it('counts whole shared backing buffers once, across textures, attributes and subarrays', () => {
    const bytes = new Uint8Array(1024);
    const texture = new DataTexture(bytes.subarray(16), 1, 1);
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(bytes.buffer, 32, 12), 3),
    );
    const material = new MeshBasicMaterial({ map: texture });
    const account = new MemoryAccount();
    account.texture('field', texture);
    account.object('mesh', new Mesh(geometry, material));
    expect(account.report().totals.arrayBuffers).toBe(1024);
    expect(account.owners.field?.arrayBuffers).toBe(1024);
    expect(account.owners['mesh.geometry']?.arrayBuffers).toBe(0);
  });

  it('counts shared native canvases and audio once without reading back their pixels/samples', () => {
    const canvas = {
      width: 2048,
      height: 2048,
      getContext: () => {
        throw new Error('no readback');
      },
    };
    const texture = new CanvasTexture(canvas as unknown as HTMLCanvasElement);
    const sound = { length: 48_000, numberOfChannels: 2 } as AudioBuffer;
    const account = new MemoryAccount();
    account.texture('engraving', texture);
    account.texture('shared', texture.clone());
    account.audio('noise', sound);
    account.audio('cue', sound);
    expect(account.report().totals).toEqual({
      arrayBuffers: 0,
      canvasPixels: 16 * 2 ** 20,
      audioSamples: 384_000,
      imagePixels: 0,
    });
  });
});
