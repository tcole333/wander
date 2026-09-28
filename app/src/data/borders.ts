// The border fields of milestone 1 (streaming.md 3.3), the inverse of
// pipeline/src/prebuild/borders.py: for one historical-basemaps snapshot, six faces of signed
// distances to the borders between its polities, one byte a texel, stored gzip. inflateBorders
// reads a stored file into the look's array a face at a time; snapshotFor picks the snapshot a day
// shows (3.0). Pure and without three, like the surface decoder.
import constants from '@shared/constants.json' with { type: 'json' };
import { dayFromCivil } from '../story/dates';
import type { BordersRelease } from './release';

export const BORDER_MAGIC: string = constants.formats.borderField.magic;
export const BORDER_VERSION: number = constants.formats.borderField.version;
/** Texels a face side, apron included; the apron past each face edge; the faces. */
export const BORDER_TEXELS = 2048;
export const BORDER_APRON = 4;
export const BORDER_FACES = 6;
/** 'WBF1' u8 version | u8 faces | u16 size | u16 apron | i16 year | u32 pad. */
const HEADER_BYTES = 16;

export class BordersError extends Error {
  override name = 'BordersError';
}

export interface BorderHeader {
  faces: number;
  /** Texels a face side, apron included. */
  size: number;
  apron: number;
  /** The snapshot's astronomical year. */
  year: number;
}

/** A stored field's header, checking its magic and version. */
export function parseBorderHeader(raw: Uint8Array): BorderHeader {
  if (raw.length < HEADER_BYTES) throw new BordersError(`${raw.length} bytes hold no header`);
  const view = new DataView(raw.buffer, raw.byteOffset, HEADER_BYTES);
  const magic = String.fromCharCode(...raw.subarray(0, 4));
  const version = view.getUint8(4);
  if (magic !== BORDER_MAGIC || version !== BORDER_VERSION) {
    throw new BordersError(`not a version ${BORDER_VERSION} border field: ${magic} ${version}`);
  }
  return {
    faces: view.getUint8(5),
    size: view.getUint16(6, true),
    apron: view.getUint16(8, true),
    year: view.getInt16(10, true),
  };
}

/**
 * Inflates a stored field into `into`, which holds its faces' bytes one after another, calling
 * `onFace` with each face's index as its last byte arrives. Rejects a field whose faces would not
 * fill `into` exactly.
 */
export async function inflateBorders(
  stored: ArrayBuffer,
  into: Uint8Array,
  onFace: (face: number) => void,
): Promise<BorderHeader> {
  const reader = new Blob([stored])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
    .getReader();
  const header = new Uint8Array(HEADER_BYTES);
  let parsed: BorderHeader | null = null;
  let faceBytes = 0;
  let read = 0;
  let done = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    let bytes = chunk.value;
    if (read < HEADER_BYTES) {
      const head = bytes.subarray(0, HEADER_BYTES - read);
      header.set(head, read);
      read += head.length;
      bytes = bytes.subarray(head.length);
      if (read < HEADER_BYTES) continue;
      parsed = parseBorderHeader(header);
      faceBytes = parsed.size * parsed.size;
      if (parsed.faces * faceBytes !== into.length) {
        await reader.cancel();
        throw new BordersError(`${parsed.faces} faces of ${parsed.size}² do not fill the field`);
      }
    }
    const at = read - HEADER_BYTES;
    if (at + bytes.length > into.length) {
      await reader.cancel();
      throw new BordersError(`the field inflates past ${into.length} bytes`);
    }
    into.set(bytes, at);
    read += bytes.length;
    const faces = parsed?.faces ?? 0;
    for (; done < faces && (done + 1) * faceBytes <= read - HEADER_BYTES; done += 1) onFace(done);
  }
  if (!parsed || read - HEADER_BYTES !== into.length) {
    throw new BordersError(`the field holds ${Math.max(0, read - HEADER_BYTES)} of its bytes`);
  }
  return parsed;
}

/**
 * The stem of the snapshot a day shows: the one whose 1 July lies nearest the day, the earlier on
 * a tie, as the release lists them oldest first (3.0); undefined when the release has none.
 */
export function snapshotFor(borders: BordersRelease, day: number): string | undefined {
  let best: string | undefined;
  let gap = Infinity;
  borders.years.forEach((year, i) => {
    const d = Math.abs(day - dayFromCivil({ year, month: 7, day: 1 }));
    if (d < gap) {
      best = borders.stems[i];
      gap = d;
    }
  });
  return best;
}
