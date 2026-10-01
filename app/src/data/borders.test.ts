// The border files (streaming.md 3.3): a WBF2 step as the borders stage writes one, read in bands;
// and a WBP2 chunk's previews decoded in pairs.
import { gzipSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { previewChunk, stepFile } from '../test/borderFiles';
import {
  BAND_BYTES,
  BAND_ROWS,
  BordersError,
  CELL_BYTES,
  decodePreviewPair,
  FACE_BANDS,
  inflateBands,
  PREVIEW_H,
  PREVIEW_W,
  STEP_BANDS,
  STEP_CHANNELS,
  STEP_TEXELS,
  stepBands,
  type StepBand,
} from './borders';

/** Gzipped as the build stores them. */
function gz(raw: Uint8Array): ArrayBuffer {
  const out = gzipSync(raw);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

/** A step whose R is its texel's face and G its row's low byte. */
const step = (options?: Parameters<typeof stepFile>[2]) =>
  stepFile(
    1815,
    (face, _i, j, out, at) => {
      out[at] = face;
      out[at + 1] = j & 255;
    },
    options,
  );

async function bandsOf(stored: ArrayBuffer): Promise<{ bands: StepBand[]; year: number }> {
  const bands: StepBand[] = [];
  const reader = stepBands(stored);
  for (;;) {
    const next = await reader.next();
    if (next.done) return { bands, year: next.value };
    bands.push(next.value);
  }
}

describe('border steps', () => {
  test('inflate in bands of a quarter MiB, each a new array of one face’s rows', async () => {
    const { bands, year } = await bandsOf(gz(step()));
    expect(year).toBe(1815);
    expect(bands).toHaveLength(STEP_BANDS);
    expect(bands.every(({ texels }) => texels.length === BAND_BYTES)).toBe(true);
    expect(new Set(bands.map(({ texels }) => texels.buffer)).size).toBe(STEP_BANDS);
    const [first, ninth, last] = [bands[0], bands[FACE_BANDS + 1], bands[STEP_BANDS - 1]];
    expect([first?.face, first?.row, ninth?.face, ninth?.row]).toEqual([0, 0, 1, BAND_ROWS]);
    expect([last?.face, last?.row]).toEqual([5, STEP_TEXELS - BAND_ROWS]);
    // Row BAND_ROWS + 1 of face 1, texel 3: R the face, G the row.
    const texel = (1 * STEP_TEXELS + 3) * STEP_CHANNELS;
    expect([ninth?.texels[texel], ninth?.texels[texel + 1]]).toEqual([1, BAND_ROWS + 1]);
  });

  test('refuse another size, another plane count, and a field cut short', async () => {
    await expect(bandsOf(gz(step({ size: 512 })))).rejects.toThrow(BordersError);
    await expect(bandsOf(gz(step({ channels: 1 })))).rejects.toThrow(BordersError);
    await expect(bandsOf(gz(step().subarray(0, 16 + 5 * BAND_BYTES)))).rejects.toThrow(
      BordersError,
    );
    await expect(bandsOf(gz(step({ version: 9 })))).rejects.toThrow(BordersError);
  });

  test('stop inflating once aborted', async () => {
    const controller = new AbortController();
    const reader = stepBands(gz(step()), controller.signal);
    await reader.next();
    controller.abort();
    await expect(reader.next()).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('inflateBands', () => {
  test('gives the head, then bands, the last as long as what is left', async () => {
    const raw = Uint8Array.from({ length: 30 }, (_, i) => i);
    const pieces: number[][] = [];
    for await (const piece of inflateBands(gz(raw), 4, 8)) pieces.push([...piece]);
    expect(pieces.map((p) => p.length)).toEqual([4, 8, 8, 8, 2]);
    expect(pieces.flat()).toEqual([...raw]);
  });
});

describe('preview chunks', () => {
  const PLANE = PREVIEW_W * PREVIEW_H;
  /** Previews whose texels run up and wrap, so the chunk's differences wrap too. */
  const layers = [0, 1, 2, 3, 4].map((k) =>
    Uint8Array.from({ length: PLANE }, (_, t) => (t * (k + 3) + 200 * k) & 255),
  );
  const chunk = gz(previewChunk([1800, 1805, 1810, 1815, 1817], layers));
  const channel = (cell: Uint8Array, c: 0 | 1) =>
    Uint8Array.from({ length: PLANE }, (_, t) => cell[2 * t + c] ?? 0);

  test("decode a cell's two previews, the even one in R and the odd in G", async () => {
    for (const index of [0, 2]) {
      const { cell, header } = await decodePreviewPair(chunk, index);
      expect(header.years).toEqual([1800, 1805, 1810, 1815, 1817]);
      expect(cell.length).toBe(CELL_BYTES);
      expect(channel(cell, 0)).toEqual(layers[index]);
      expect(channel(cell, 1)).toEqual(layers[index + 1]);
    }
  });

  test('copy the last preview into G where the chunk ends on an even step', async () => {
    const { cell } = await decodePreviewPair(chunk, 4);
    expect(channel(cell, 0)).toEqual(layers[4]);
    expect(channel(cell, 1)).toEqual(layers[4]);
  });

  test('decode into the cell given, refusing an odd index and one past the chunk', async () => {
    const given = new Uint8Array(CELL_BYTES).fill(9);
    expect((await decodePreviewPair(chunk, 2, given)).cell).toBe(given);
    expect(channel(given, 0)).toEqual(layers[2]);
    await expect(decodePreviewPair(chunk, 1)).rejects.toThrow(BordersError);
    await expect(decodePreviewPair(chunk, 6)).rejects.toThrow(BordersError);
  });

  test('refuse another magic and a chunk cut short', async () => {
    const raw = previewChunk([1800, 1805], layers.slice(0, 2));
    const wrong = raw.slice();
    wrong[3] = 'Z'.charCodeAt(0);
    await expect(decodePreviewPair(gz(wrong), 0)).rejects.toThrow(BordersError);
    await expect(decodePreviewPair(gz(raw.subarray(0, raw.length - 10)), 0)).rejects.toThrow(
      BordersError,
    );
  });
});
