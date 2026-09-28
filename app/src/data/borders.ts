// The border fields of milestone 1 (streaming.md 3.3), the inverse of
// pipeline/src/prebuild/borders.py: for one historical-basemaps snapshot, six faces of signed
// distances to the borders between its polities, one byte a texel, stored gzip. Pure and without
// three, like the surface decoder.
import constants from '@shared/constants.json' with { type: 'json' };
import { inflate } from '../surface/wst';

export const BORDER_MAGIC: string = constants.formats.borderField.magic;
export const BORDER_VERSION: number = constants.formats.borderField.version;
/** Texels a face side, apron included; the apron past each face edge; the faces. */
export const BORDER_TEXELS = 2048;
export const BORDER_APRON = 4;
export const BORDER_FACES = 6;
/** 'WBF1' u8 version | u8 faces | u16 size | u16 apron | i16 year | u32 pad. */
const HEADER_BYTES = 16;
/** The header and the six faces, as a stored field inflates. */
const FIELD_BYTES = HEADER_BYTES + BORDER_FACES * BORDER_TEXELS * BORDER_TEXELS;

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
 * A stored field's six faces, one after another, BORDER_TEXELS² bytes each. Rejects a field of
 * another face count, size or apron.
 */
export async function inflateBorders(stored: ArrayBuffer): Promise<Uint8Array> {
  const raw = await inflate(stored, FIELD_BYTES);
  const { faces, size, apron } = parseBorderHeader(raw);
  const fits = faces === BORDER_FACES && size === BORDER_TEXELS && apron === BORDER_APRON;
  if (!fits || raw.length !== FIELD_BYTES) {
    throw new BordersError(`${faces} faces of ${size}² in ${raw.length} bytes are not the field`);
  }
  return raw.subarray(HEADER_BYTES);
}
