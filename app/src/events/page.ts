// The only resident representation of .wev: typed columns, sparse extents, UTF-8 labels and a
// sorted qid → local index lookup. JSON, strings and compressed buffers die after decoding.
import type { EventFile } from '../data/release';
import { inflate } from '../surface/wst';

export type Extent = [west: number, south: number, east: number, north: number];

export interface EventPage {
  rows: number;
  classes?: string[];
  row: Int32Array;
  qid: Int32Array;
  lon: Int32Array;
  lat: Int32Array;
  parent: Int32Array;
  score: Uint16Array;
  unc: Uint16Array;
  prec: Uint8Array;
  cls: Uint8Array;
  flags: Uint8Array;
  t0: Float64Array;
  t1: Float64Array;
  ext: Int32Array;
  text: Uint8Array;
  offsets: Uint32Array;
  /** Indices into qid, sorted by Q number. No per-row JS objects or Map entries. */
  qidOrder: Uint32Array;
  bytes: number;
}

function numbers(
  doc: Record<string, unknown>,
  key: string,
  length: number,
  min: number,
  max: number,
): number[] {
  const column = doc[key];
  if (
    !Array.isArray(column) ||
    column.length !== length ||
    column.some(
      (n: unknown) => typeof n !== 'number' || !Number.isSafeInteger(n) || n < min || n > max,
    )
  ) {
    throw new Error(`invalid .wev ${key}`);
  }
  return column as number[];
}

/** Parse already-inflated JSON; also used by fixture tests and the local benchmark. */
export function parsePage(value: unknown): EventPage {
  if (!value || typeof value !== 'object') throw new Error('invalid .wev document');
  const doc = value as Record<string, unknown>;
  const n = doc.rows;
  if (doc.v !== 1 || typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) {
    throw new Error('invalid .wev version or rows');
  }
  const arrays = {
    row: Int32Array.from(numbers(doc, 'row', n, 0, 0x7fffffff)),
    qid: Int32Array.from(numbers(doc, 'qid', n, 1, 0x7fffffff)),
    lon: Int32Array.from(numbers(doc, 'lon', n, -18000000, 18000000)),
    lat: Int32Array.from(numbers(doc, 'lat', n, -9000000, 9000000)),
    parent: Int32Array.from(numbers(doc, 'parent', n, -1, 0x7fffffff)),
    score: Uint16Array.from(numbers(doc, 'score', n, 0, 1000)),
    unc: Uint16Array.from(numbers(doc, 'unc', n, 0, 65535)),
    prec: Uint8Array.from(numbers(doc, 'prec', n, 0, 14)),
    cls: Uint8Array.from(numbers(doc, 'cls', n, 0, 255)),
    flags: Uint8Array.from(numbers(doc, 'flags', n, 0, 63)),
    t0: Float64Array.from(numbers(doc, 't0', n, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)),
    t1: Float64Array.from(numbers(doc, 't1', n, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)),
  };
  const labels = doc.label;
  if (
    !Array.isArray(labels) ||
    labels.length !== n ||
    labels.some((s: unknown) => typeof s !== 'string')
  ) {
    throw new Error('invalid .wev labels');
  }
  const encoder = new TextEncoder();
  const offsets = new Uint32Array(n + 1);
  let length = 0;
  for (let i = 0; i < n; i++) {
    offsets[i] = length;
    length += encoder.encode(labels[i] as string).byteLength;
    if (
      arrays.t0[i]! > arrays.t1[i]! ||
      arrays.parent[i] === arrays.row[i] ||
      (i > 0 && (arrays.row[i]! <= arrays.row[i - 1]! || arrays.score[i]! > arrays.score[i - 1]!))
    ) {
      throw new Error('invalid .wev order, span or parent');
    }
  }
  offsets[n] = length;
  const text = new Uint8Array(length);
  for (let i = 0; i < n; i++) encoder.encodeInto(labels[i] as string, text.subarray(offsets[i]));
  const qidOrder = Uint32Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => arrays.qid[a]! - arrays.qid[b]!,
  );
  for (let i = 1; i < n; i++) {
    if (arrays.qid[qidOrder[i]!] === arrays.qid[qidOrder[i - 1]!])
      throw new Error('duplicate .wev qid');
  }
  if (!Array.isArray(doc.ext)) throw new Error('invalid .wev extents');
  let previous = -1;
  for (const entry of doc.ext as unknown[]) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 5 ||
      entry.some(
        (x: unknown) => typeof x !== 'number' || !Number.isInteger(x) || Math.abs(x) > 0x7fffffff,
      )
    )
      throw new Error('invalid .wev extent');
    const [row, w, s, e, north] = entry as number[];
    if (
      row! <= previous ||
      findRow({ row: arrays.row }, row!) < 0 ||
      w! > e! ||
      s! > north! ||
      e! - w! > 36000000 ||
      s! < -9000000 ||
      north! > 9000000
    )
      throw new Error('invalid .wev extent bounds');
    previous = row!;
  }
  const ext = Int32Array.from((doc.ext as number[][]).flat());
  let classes: string[] | undefined;
  if (doc.classes !== undefined) {
    if (
      !Array.isArray(doc.classes) ||
      doc.classes.length > 256 ||
      doc.classes.some((c: unknown) => typeof c !== 'string')
    ) {
      throw new Error('invalid .wev classes');
    }
    classes = doc.classes as string[];
    if (arrays.cls.some((c) => c >= classes!.length)) throw new Error('invalid .wev class index');
  }
  const bytes =
    Object.values(arrays).reduce((sum, a) => sum + a.byteLength, 0) +
    text.byteLength +
    offsets.byteLength +
    qidOrder.byteLength +
    ext.byteLength;
  return { rows: n, ...arrays, text, offsets, qidOrder, ext, classes, bytes };
}

export async function decodePage(buf: ArrayBuffer, file: EventFile): Promise<EventPage> {
  if (buf.byteLength !== file.bytes) throw new Error(`wrong stored size: ${file.key}`);
  const raw = await inflate(buf, file.jsonBytes);
  if (raw.byteLength !== file.jsonBytes) throw new Error(`wrong JSON size: ${file.key}`);
  const page = parsePage(JSON.parse(new TextDecoder().decode(raw)));
  if (page.rows !== file.rows || page.bytes !== file.decoded)
    throw new Error(`wrong decoded size: ${file.key}`);
  return page;
}

const decoder = new TextDecoder();
export function labelAt(page: EventPage, i: number): string {
  return decoder.decode(page.text.subarray(page.offsets[i], page.offsets[i + 1]));
}

export function findRow(page: Pick<EventPage, 'row'>, row: number): number {
  let lo = 0,
    hi = page.row.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (page.row[mid]! < row) lo = mid + 1;
    else hi = mid;
  }
  return page.row[lo] === row ? lo : -1;
}

export function findQid(page: EventPage, qid: number): number {
  let lo = 0,
    hi = page.rows;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (page.qid[page.qidOrder[mid]!]! < qid) lo = mid + 1;
    else hi = mid;
  }
  const i = page.qidOrder[lo];
  return i !== undefined && page.qid[i] === qid ? i : -1;
}

export function extentAt(page: EventPage, row: number): Extent | undefined {
  let lo = 0,
    hi = page.ext.length / 5;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (page.ext[mid * 5]! < row) lo = mid + 1;
    else hi = mid;
  }
  const at = lo * 5;
  return page.ext[at] === row
    ? [
        page.ext[at + 1]! / 1e5,
        page.ext[at + 2]! / 1e5,
        page.ext[at + 3]! / 1e5,
        page.ext[at + 4]! / 1e5,
      ]
    : undefined;
}
