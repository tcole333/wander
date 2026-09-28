// No browser or rasterizer: run the actual geometry constructors and size the actual canvas
// sources. Rendering equivalence belongs to e2e:gpu and the walk shots on Metal.
import { afterEach, expect, it, vi } from 'vitest';
import { Mesh, Texture, type BufferGeometry } from 'three';
import { MemoryAccount } from '../perf/memory';
import { buildInstrument } from './instrument';

afterEach(() => vi.unstubAllGlobals());

it('accounts for the built instrument, including shared material maps only once', () => {
  const noop = () => {};
  const context = {
    createImageData: (width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    }),
    putImageData: noop,
    fillRect: noop,
    beginPath: noop,
    arc: noop,
    stroke: noop,
    moveTo: noop,
    lineTo: noop,
    save: noop,
    translate: noop,
    rotate: noop,
    fillText: noop,
    restore: noop,
  };
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
  const instrument = buildInstrument();
  const account = new MemoryAccount();
  account.object('instrument', instrument.fixed);
  account.object('instrument', instrument.tilting);
  expect(account.report().totals).toMatchInlineSnapshot(`
    {
      "arrayBuffers": 6720512,
      "audioSamples": 0,
      "canvasPixels": 36700160,
      "imagePixels": 0,
    }
  `);
  for (const root of [instrument.fixed, instrument.tilting]) {
    root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const geometry = object.geometry as BufferGeometry;
      for (const attribute of [...Object.values(geometry.attributes), geometry.index]) {
        if (attribute && 'onUploadCallback' in attribute) attribute.onUploadCallback();
      }
      for (const material of [object.material].flat()) {
        for (const value of Object.values(material as object)) {
          if (value instanceof Texture) value.onUpdate?.(value as Texture);
        }
      }
    });
  }
  const uploaded = new MemoryAccount();
  uploaded.object('instrument', instrument.fixed);
  uploaded.object('instrument', instrument.tilting);
  expect(uploaded.report().totals.canvasPixels).toBe(0);
  expect(uploaded.report().totals.arrayBuffers).toBe(0);
});
