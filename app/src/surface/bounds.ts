// The surface layer's LOD bounds, surf/<ver8>/bounds.bin (streaming.md 3.8): the [min, max] meters
// of every available node, in node order, as the decoder returns them for a loaded tile. The file is
// a gzip stream; this reads the inflated bytes.
import constants from '@shared/constants.json';
import { availGet, nodeCount } from './cube';

export const BOUNDS_MAGIC: string = constants.formats.surfaceBounds.magic;
export const BOUNDS_VERSION: number = constants.formats.surfaceBounds.version;
/** 'WSB1' u8 version | u8 maxLevel | u16 pad | u32 count. */
const HEADER_BYTES = 12;
const ENTRY_BYTES = 4;

export class BoundsError extends Error {
  override name = 'BoundsError';
}

/**
 * The bounds by node index of an inflated bounds.bin, checked against the availability bitmap it
 * was written for: the magic and version, a bitmap sized for maxLevel, and one entry per set bit.
 */
export function parseSurfaceBounds(
  buf: ArrayBuffer,
  avail: Uint8Array,
): Map<number, [number, number]> {
  if (buf.byteLength < HEADER_BYTES) {
    throw new BoundsError(`${buf.byteLength} bytes hold no bounds.bin header`);
  }
  const view = new DataView(buf);
  const magic = String.fromCharCode(...new Uint8Array(buf, 0, 4));
  if (magic !== BOUNDS_MAGIC) {
    throw new BoundsError(`magic is ${JSON.stringify(magic)}, not ${BOUNDS_MAGIC}`);
  }
  const version = view.getUint8(4);
  if (version !== BOUNDS_VERSION) {
    throw new BoundsError(`version is ${version}, not ${BOUNDS_VERSION}`);
  }
  const maxLevel = view.getUint8(5);
  const count = view.getUint32(8, true);
  const nodes = nodeCount(maxLevel);
  if (avail.length !== Math.ceil(nodes / 8)) {
    throw new BoundsError(`a ${avail.length}-byte bitmap does not cover maxLevel ${maxLevel}`);
  }
  if (buf.byteLength !== HEADER_BYTES + ENTRY_BYTES * count) {
    throw new BoundsError(`${buf.byteLength} bytes do not hold ${count} bounds`);
  }
  const bounds = new Map<number, [number, number]>();
  for (let k = 0; k < nodes; k += 1) {
    if (!availGet(avail, k)) continue;
    const at = HEADER_BYTES + ENTRY_BYTES * bounds.size;
    if (bounds.size === count) {
      throw new BoundsError(`the bitmap has more available nodes than the ${count} bounds`);
    }
    bounds.set(k, [view.getInt16(at, true), view.getInt16(at + 2, true)]);
  }
  if (bounds.size !== count) {
    throw new BoundsError(`${count} bounds for ${bounds.size} available nodes`);
  }
  return bounds;
}
