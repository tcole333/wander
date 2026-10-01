// The border files (streaming.md 3.3), the inverse of pipeline/src/prebuild/borders.py, pure and
// without three, like the surface decoder: a step's field (WBF2), six faces of two planes, the
// outer distance in R and the inner distance with the soft bit in G, read in bands of 256 KiB so it
// never inflates whole; and the preview chunks (WBP2), whose two previews a ring cell pairs decode
// by streaming the chunk through the cell as a running sum. All stored gzip.
import constants from '@shared/constants.json' with { type: 'json' };

/** The apron past each face edge, in texels, and the faces. */
export const BORDER_APRON = 4;
export const BORDER_FACES = 6;

export class BordersError extends Error {
  override name = 'BordersError';
}

/** A band of a step's field: the rows of one face a band carries, a quarter MiB. */
export const BAND_BYTES = 256 * 1024;
export const STEP_MAGIC: string = constants.formats.borderStep.magic;
export const STEP_VERSION: number = constants.formats.borderStep.version;
/** Texels a step's face side, apron included; bytes a texel (R and G). */
export const STEP_TEXELS = 1024;
export const STEP_CHANNELS = 2;
/** Rows of one face in a band, and the bands a face and a field take. */
export const BAND_ROWS = BAND_BYTES / (STEP_TEXELS * STEP_CHANNELS);
export const FACE_BANDS = STEP_TEXELS / BAND_ROWS;
export const STEP_BANDS = BORDER_FACES * FACE_BANDS;
/** 'WBF2' u8 version | u8 faces | u16 size | u16 apron | i16 year | u8 channels | u8 pad[3]. */
const STEP_HEADER_BYTES = 16;

export const PREVIEW_MAGIC: string = constants.formats.borderPreviews.magic;
export const PREVIEW_VERSION: number = constants.formats.borderPreviews.version;
/** A preview's equirect texels, and the bytes a ring cell takes: two previews, R and G. */
export const PREVIEW_W = 512;
export const PREVIEW_H = 256;
export const CELL_BYTES = PREVIEW_W * PREVIEW_H * 2;
/** 'WBP2' u8 version | u8 pad | u16 count | u16 w | u16 h, then i32 years[count]. */
const PREVIEW_FIXED_BYTES = 12;
/** A chunk's previews at most. */
const PREVIEW_COUNT_MAX = 16;
/** The stored bytes the inflater takes at a time, as the surface decoder's. */
const INFLATE_SLICE = 64 * 1024;

/** A band of a step's field: `rows` rows of `face` from `row` on, R and G a texel. */
export interface StepBand {
  face: number;
  row: number;
  texels: Uint8Array;
}

/**
 * A stored gzip file's inflated bytes as `DecompressionStream` gives them, fed a slice at a time,
 * so no more of it inflates than the reader has asked for. Aborting `signal` stops it.
 */
export async function* inflateStream(
  stored: ArrayBuffer,
  signal?: AbortSignal,
): AsyncGenerator<Uint8Array> {
  let at = 0;
  const slices = new ReadableStream<BufferSource>(
    {
      pull(controller) {
        if (at >= stored.byteLength) return controller.close();
        const end = Math.min(at + INFLATE_SLICE, stored.byteLength);
        controller.enqueue(new Uint8Array(stored, at, end - at));
        at = end;
      },
    },
    { highWaterMark: 0 },
  );
  const reader = slices.pipeThrough(new DecompressionStream('gzip')).getReader();
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/**
 * A stored file's inflated bytes in pieces: first `headBytes`, then `bandBytes` at a time, each
 * band a new array, the last shorter where the file ends. Only the band being filled is held.
 */
export async function* inflateBands(
  stored: ArrayBuffer,
  headBytes: number,
  bandBytes = BAND_BYTES,
  signal?: AbortSignal,
): AsyncGenerator<Uint8Array> {
  let piece = new Uint8Array(headBytes > 0 ? headBytes : bandBytes);
  let filled = 0;
  for await (const chunk of inflateStream(stored, signal)) {
    let at = 0;
    while (at < chunk.length) {
      const take = Math.min(piece.length - filled, chunk.length - at);
      piece.set(chunk.subarray(at, at + take), filled);
      filled += take;
      at += take;
      if (filled < piece.length) continue;
      yield piece;
      piece = new Uint8Array(bandBytes);
      filled = 0;
    }
  }
  if (filled > 0) yield piece.subarray(0, filled);
}

export interface StepHeader {
  faces: number;
  /** Texels a face side, apron included. */
  size: number;
  apron: number;
  /** The step's first year, astronomical. */
  year: number;
  channels: number;
}

/** A step field's header, checking its magic and version. */
export function parseStepHeader(raw: Uint8Array): StepHeader {
  if (raw.length < STEP_HEADER_BYTES) throw new BordersError(`${raw.length} bytes hold no header`);
  const view = new DataView(raw.buffer, raw.byteOffset, STEP_HEADER_BYTES);
  const magic = String.fromCharCode(...raw.subarray(0, 4));
  const version = view.getUint8(4);
  if (magic !== STEP_MAGIC || version !== STEP_VERSION) {
    throw new BordersError(`not a version ${STEP_VERSION} border step: ${magic} ${version}`);
  }
  return {
    faces: view.getUint8(5),
    size: view.getUint16(6, true),
    apron: view.getUint16(8, true),
    year: view.getInt16(10, true),
    channels: view.getUint8(12),
  };
}

/**
 * A stored step's field in bands, face 0's rows first: its header's year, then each band as it
 * inflates. Rejects a field of another shape, and one that ends early or runs on.
 */
export async function* stepBands(
  stored: ArrayBuffer,
  signal?: AbortSignal,
): AsyncGenerator<StepBand, number> {
  const pieces = inflateBands(stored, STEP_HEADER_BYTES, BAND_BYTES, signal);
  const head = await pieces.next();
  if (head.done) throw new BordersError('an empty border step');
  const { faces, size, apron, channels, year } = parseStepHeader(head.value);
  const fits =
    faces === BORDER_FACES &&
    size === STEP_TEXELS &&
    apron === BORDER_APRON &&
    channels === STEP_CHANNELS;
  if (!fits) {
    throw new BordersError(`a step of ${faces} faces of ${size}² in ${channels} planes`);
  }
  let band = 0;
  for await (const texels of pieces) {
    if (band >= STEP_BANDS || texels.length !== BAND_BYTES) {
      throw new BordersError(`a border step of the wrong length at band ${band}`);
    }
    const face = Math.floor(band / FACE_BANDS);
    yield { face, row: (band % FACE_BANDS) * BAND_ROWS, texels };
    band += 1;
  }
  if (band !== STEP_BANDS) throw new BordersError(`a border step of ${band} bands`);
  return year;
}

export interface PreviewHeader {
  count: number;
  w: number;
  h: number;
  /** Each preview's step's first year, astronomical. */
  years: number[];
}

/** A preview chunk's header from its first bytes, or null until they hold all of it. */
export function parsePreviewHeader(raw: Uint8Array): PreviewHeader | null {
  if (raw.length < PREVIEW_FIXED_BYTES) return null;
  const view = new DataView(raw.buffer, raw.byteOffset, raw.length);
  const magic = String.fromCharCode(...raw.subarray(0, 4));
  const version = view.getUint8(4);
  if (magic !== PREVIEW_MAGIC || version !== PREVIEW_VERSION) {
    throw new BordersError(`not a version ${PREVIEW_VERSION} preview chunk: ${magic} ${version}`);
  }
  const count = view.getUint16(6, true);
  const w = view.getUint16(8, true);
  const h = view.getUint16(10, true);
  if (count < 1 || count > PREVIEW_COUNT_MAX || w !== PREVIEW_W || h !== PREVIEW_H) {
    throw new BordersError(`a chunk of ${count} previews of ${w} × ${h}`);
  }
  if (raw.length < previewHeaderBytes(count)) return null;
  const years = Array.from({ length: count }, (_, i) =>
    view.getInt32(PREVIEW_FIXED_BYTES + 4 * i, true),
  );
  return { count, w, h, years };
}

/** A chunk's header bytes for `count` previews. */
function previewHeaderBytes(count: number): number {
  return PREVIEW_FIXED_BYTES + 4 * count;
}

/**
 * The previews at `index` (even) and `index + 1` of a stored chunk, as one ring cell's texels:
 * the first in R and the second in G, a copy of the first where the chunk ends there. The chunk
 * streams through `cell` as a running sum of its layers, so no more than the cell is held besides
 * the stored chunk, and it stops inflating after the second preview.
 */
export async function decodePreviewPair(
  stored: ArrayBuffer,
  index: number,
  cell: Uint8Array = new Uint8Array(CELL_BYTES),
  signal?: AbortSignal,
): Promise<{ cell: Uint8Array; header: PreviewHeader }> {
  if (index % 2 !== 0) throw new BordersError(`a cell pairs even and odd previews, not ${index}`);
  if (cell.length !== CELL_BYTES) throw new BordersError(`a cell of ${cell.length} bytes`);
  cell.fill(0);
  const layer = PREVIEW_W * PREVIEW_H;
  let head = new Uint8Array(0);
  let header: PreviewHeader | null = null;
  /** Bytes of the layers read so far. */
  let at = 0;
  let last = 0;
  for await (const chunk of inflateStream(stored, signal)) {
    let bytes = chunk;
    if (!header) {
      const joined = new Uint8Array(head.length + bytes.length);
      joined.set(head);
      joined.set(bytes, head.length);
      header = parsePreviewHeader(joined);
      if (!header) {
        head = joined;
        continue;
      }
      if (index >= header.count) {
        throw new BordersError(`a chunk of ${header.count} previews has none at ${index}`);
      }
      last = Math.min(index + 1, header.count - 1);
      bytes = joined.subarray(previewHeaderBytes(header.count));
      head = new Uint8Array(0);
    }
    const end = (last + 1) * layer;
    for (let i = 0; i < bytes.length && at < end;) {
      const which = Math.floor(at / layer);
      const offset = at - which * layer;
      const n = Math.min(bytes.length - i, layer - offset, end - at);
      // A layer at or before the first preview adds to the running sum in R; the second preview
      // is R's sum plus its own layer. The cell's bytes wrap, as the deltas do, mod 256.
      if (which <= index) {
        for (let k = 0, t = 2 * offset; k < n; k += 1, t += 2) {
          cell[t] = (cell[t] ?? 0) + (bytes[i + k] ?? 0);
        }
      } else {
        for (let k = 0, t = 2 * offset; k < n; k += 1, t += 2) {
          cell[t + 1] = (cell[t] ?? 0) + (bytes[i + k] ?? 0);
        }
      }
      i += n;
      at += n;
    }
    if (at >= (last + 1) * layer) break;
  }
  if (!header || at < (last + 1) * layer) throw new BordersError('a preview chunk ends early');
  if (last === index) for (let t = 0; t < CELL_BYTES; t += 2) cell[t + 1] = cell[t] ?? 0;
  return { cell, header };
}
