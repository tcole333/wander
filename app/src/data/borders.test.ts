// The border fields (streaming.md 3.3): a WBF1 field as the borders stage writes one, read into
// its six faces' bytes.
import { gzipSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { BORDER_FACES, BORDER_TEXELS, BordersError, inflateBorders } from './borders';

const FACE = BORDER_TEXELS * BORDER_TEXELS;

/** A stored field of `faces` faces, each texel its face's number. */
function stored(faces = BORDER_FACES): ArrayBuffer {
  const header = Buffer.alloc(16);
  header.write('WBF1', 0, 'ascii');
  header.writeUInt8(1, 4);
  header.writeUInt8(faces, 5);
  header.writeUInt16LE(BORDER_TEXELS, 6);
  header.writeUInt16LE(4, 8);
  header.writeInt16LE(1815, 10);
  const texels = Buffer.alloc(faces * FACE);
  for (let face = 0; face < faces; face += 1) texels.fill(face, face * FACE, (face + 1) * FACE);
  const gz = gzipSync(Buffer.concat([header, texels]));
  return gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength);
}

describe('border fields', () => {
  test("inflate into their six faces' bytes, one face after another", async () => {
    const faces = await inflateBorders(stored());
    expect(faces.length).toBe(BORDER_FACES * FACE);
    expect([faces[0], faces[FACE - 1], faces[5 * FACE + 3]]).toEqual([0, 0, 5]);
  });

  test('refuse a field of another face count', async () => {
    await expect(inflateBorders(stored(5))).rejects.toThrow(BordersError);
  });
});
