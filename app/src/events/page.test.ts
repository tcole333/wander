import { describe, expect, test } from 'vitest';
import { gunzipSync } from 'node:zlib';
import type { EventsRelease } from '../data/release';
import { readFixtureFile, readStageRecord } from '../test/fixture';
import { decodePage, extentAt, findQid, labelAt, parsePage } from './page';
import { pageOf } from './testSupport';

describe('.wev pages', () => {
  test('the fixture agrees with Python on every array byte, its labels and references', async () => {
    const release = readStageRecord<EventsRelease>('event-files');
    const pages = await Promise.all(
      release.files.map((f) => decodePage(readFixtureFile(f.key).buffer, f)),
    );
    for (const [i, file] of release.files.entries()) {
      const doc = JSON.parse(gunzipSync(readFixtureFile(file.key)).toString('utf8')) as Record<
        string,
        number[]
      > & { label: string[]; ext: number[][] };
      const page = pages[i]!;
      const compare = (actual: ArrayBufferView, expected: number[], width: 1 | 2 | 4 | 8) => {
        const bytes = Buffer.alloc(expected.length * width);
        expected.forEach((value, at) => {
          if (width === 8) bytes.writeDoubleLE(value, at * width);
          else bytes.writeIntLE(value, at * width, width);
        });
        expect(Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength)).toEqual(bytes);
      };
      for (const key of ['row', 'qid', 'lon', 'lat', 'parent'] as const)
        compare(page[key], doc[key]!, 4);
      for (const key of ['score', 'unc'] as const) compare(page[key], doc[key]!, 2);
      for (const key of ['prec', 'cls', 'flags'] as const) compare(page[key], doc[key]!, 1);
      for (const key of ['t0', 't1'] as const) compare(page[key], doc[key]!, 8);
      compare(page.ext, doc.ext.flat(), 4);
      const labels = doc.label.map((label) => Buffer.from(label, 'utf8'));
      expect(Buffer.from(page.text)).toEqual(Buffer.concat(labels));
      const offsets = [0];
      for (const label of labels) offsets.push(offsets.at(-1)! + label.length);
      compare(page.offsets, offsets, 4);
      compare(
        page.qidOrder,
        doc.qid!.map((_, at) => at).sort((a, b) => doc.qid![a]! - doc.qid![b]!),
        4,
      );
    }
    expect(pages.reduce((n, p) => n + p.rows, 0)).toBe(release.rows);
    expect(pages.reduce((n, p) => n + p.bytes, 0)).toBe(
      release.files.reduce((n, f) => n + f.decoded, 0),
    );
    const overview = pages[0]!;
    const at = findQid(overview, 48314);
    expect(labelAt(overview, at)).toBe('Battle of Waterloo');
    const parent = overview.parent[at]!;
    expect(extentAt(overview, parent)).toBeDefined();
    expect(overview.t0).toBeInstanceOf(Float64Array);
    expect(overview.score).toBeInstanceOf(Uint16Array);
  });
  test('deep-time days and UTF-8 survive without Int32 wrapping or UTF-16 labels', () => {
    const p = pageOf([{ row: 0, t0: -5478637807, t1: -5478637800, label: 'Éruption 火山' }]);
    expect(p.t0[0]).toBe(-5478637807);
    expect(labelAt(p, 0)).toBe('Éruption 火山');
    expect(findQid(p, 1)).toBe(0);
    expect(findQid(p, 999)).toBe(-1);
    expect(p.bytes).toBe(55 + new TextEncoder().encode('Éruption 火山').length);
  });
  test('rejects unknown versions and malformed columns before coercing typed arrays', () => {
    expect(() => parsePage({ v: 2, rows: 0 })).toThrow(/version/);
    expect(() => parsePage({ v: 1, rows: 1, row: [2 ** 32] })).toThrow(/row/);
  });
});
