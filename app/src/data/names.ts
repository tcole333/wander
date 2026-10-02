// The state names' chunks (streaming.md 3.3, Names): where each name stands on the border steps of
// one chunk of `per` steps, as the names stage writes them, `fd/names/<sha16>.wsn`, gzip-in-file
// JSON. Decoded into typed columns, one entry a placement, which holds over a run of the chunk's
// steps; the JSON and its text go once decoded. Pure: no three, no fetches.
import type { NamesRelease } from './release';
import { inflate } from '../surface/wst';

/** The most a chunk's JSON may inflate to; the global bake's largest is ~0.1 MB. */
export const NAMES_MAX_JSON = 8 * 1024 * 1024;

/** The fields of a placement in a chunk's `place`, in order, as the stage writes them. */
export const NAMES_FIELDS = [
  'name',
  's0',
  's1',
  'lon',
  'lat',
  'angle',
  'em',
  'span',
  'km2',
  'flags',
  'group',
] as const;

/** A placement's flags: its plane, its kind, its form and its level. */
export const NAME_FLAG = { inner: 1, member: 2, short: 4, levelShift: 3 } as const;

export class NamesError extends Error {
  override name = 'NamesError';
}

/** One chunk of placements, its steps' indices relative to `first`. */
export interface NamesChunk {
  /** The chunk's first step, as an index into the release's border steps, and its steps' years. */
  first: number;
  years: number[];
  /** Each name's full form, drawn close, and its short form, drawn far. */
  full: string[];
  short: string[];
  count: number;
  /** Its name, by index into full and short. */
  name: Uint16Array;
  /** The first and last of the chunk's steps it holds over. */
  s0: Uint8Array;
  s1: Uint8Array;
  /** Its anchor, degrees; its baseline's direction at the anchor, degrees from east. */
  lon: Float32Array;
  lat: Float32Array;
  angle: Float32Array;
  /** Its letters' em and its span along the baseline, degrees of arc. */
  em: Float32Array;
  span: Float32Array;
  /** Its region's area, km², by which a stronger name keeps its place. */
  km2: Float32Array;
  flags: Uint8Array;
  /** Its region within the chunk: a region shows one level and form of its name at a time. */
  group: Uint16Array;
  /** The typed columns' bytes, resident once decoded. */
  bytes: number;
}

interface ChunkDocument {
  version: number;
  first: number;
  years: number[];
  fields: string[];
  names: [string, string][];
  place: number[];
}

/** A chunk's stored bytes, inflated and decoded; a document the format does not describe throws. */
export async function decodeNamesChunk(stored: ArrayBuffer): Promise<NamesChunk> {
  const text = new TextDecoder().decode(await inflate(stored, NAMES_MAX_JSON));
  return namesChunk(JSON.parse(text) as ChunkDocument);
}

/** A chunk document's placements as typed columns. */
export function namesChunk(doc: ChunkDocument): NamesChunk {
  if (doc.version !== 1) throw new NamesError(`names chunk version ${doc.version}, not 1`);
  const width = NAMES_FIELDS.length;
  if (doc.fields.join() !== NAMES_FIELDS.join() || doc.place.length % width !== 0) {
    throw new NamesError(`a names chunk's placements are not ${NAMES_FIELDS.join(', ')}`);
  }
  const count = doc.place.length / width;
  const column = <T extends Uint8Array | Uint16Array | Float32Array>(
    make: new (length: number) => T,
    field: (typeof NAMES_FIELDS)[number],
    scale = 1,
  ): T => {
    const at = NAMES_FIELDS.indexOf(field);
    const out = new make(count);
    for (let k = 0; k < count; k++) out[k] = (doc.place[k * width + at] ?? 0) / scale;
    return out;
  };
  const chunk: NamesChunk = {
    first: doc.first,
    years: doc.years,
    full: doc.names.map(([full]) => full),
    short: doc.names.map(([, short]) => short),
    count,
    name: column(Uint16Array, 'name'),
    s0: column(Uint8Array, 's0'),
    s1: column(Uint8Array, 's1'),
    lon: column(Float32Array, 'lon', 100),
    lat: column(Float32Array, 'lat', 100),
    angle: column(Float32Array, 'angle', 10),
    em: column(Float32Array, 'em', 1e4),
    span: column(Float32Array, 'span', 1e3),
    km2: column(Float32Array, 'km2'),
    flags: column(Uint8Array, 'flags'),
    group: column(Uint16Array, 'group'),
    bytes: 0,
  };
  chunk.bytes = count * (2 + 1 + 1 + 4 * 6 + 1 + 2);
  return chunk;
}

/** The chunk holding a step, by the step's index, and the step's index within it. */
export function namesChunkOf(names: NamesRelease, step: number): { chunk: number; index: number } {
  return { chunk: Math.floor(step / names.per), index: step % names.per };
}

/** The placements a chunk holds at one of its steps, by its index within the chunk. */
export function placementsAt(chunk: NamesChunk, index: number): number[] {
  const found: number[] = [];
  for (let k = 0; k < chunk.count; k++) {
    if ((chunk.s0[k] ?? 0) <= index && index <= (chunk.s1[k] ?? -1)) found.push(k);
  }
  return found;
}
