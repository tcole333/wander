// The border fields (streaming.md 3.3): a small WBF1 field as the borders stage writes one, read
// into the look's array a face at a time, and the snapshot a day shows.
import { gzipSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { dayFromIso } from '../story/dates';
import { BordersError, inflateBorders, snapshotFor } from './borders';
import type { BordersRelease } from './release';

const SIZE = 4;

/** A stored field of six SIZE² faces, each texel its face's number times 10 plus its index. */
function stored(year = 1815, faces = 6): ArrayBuffer {
  const header = Buffer.alloc(16);
  header.write('WBF1', 0, 'ascii');
  header.writeUInt8(1, 4);
  header.writeUInt8(faces, 5);
  header.writeUInt16LE(SIZE, 6);
  header.writeUInt16LE(4, 8);
  header.writeInt16LE(year, 10);
  const texels = Buffer.from(
    Array.from({ length: faces * SIZE * SIZE }, (_, i) => 10 * Math.floor(i / 16) + (i % 16)),
  );
  const gz = gzipSync(Buffer.concat([header, texels]));
  return gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength);
}

const BORDERS: BordersRelease = {
  ver: 'f00dcafe',
  stems: ['1783', '1815', '1880'],
  years: [1783, 1815, 1880],
  files: {},
};

describe('border fields', () => {
  test('inflate into the look array, naming each face once its bytes are in', async () => {
    const into = new Uint8Array(6 * SIZE * SIZE);
    const faces: number[] = [];
    const header = await inflateBorders(stored(), into, (face) => faces.push(face));
    expect(header).toEqual({ faces: 6, size: SIZE, apron: 4, year: 1815 });
    expect(faces).toEqual([0, 1, 2, 3, 4, 5]);
    expect(into[0]).toBe(0);
    expect(into[5 * 16 + 3]).toBe(53);
  });

  test('refuse a field that would not fill the array', async () => {
    const into = new Uint8Array(6 * SIZE * SIZE);
    await expect(inflateBorders(stored(1815, 5), into, () => {})).rejects.toThrow(BordersError);
  });

  test('show the snapshot whose 1 July lies nearest the day, the earlier on a tie', () => {
    expect(snapshotFor(BORDERS, dayFromIso('1816-07-01'))).toBe('1815');
    expect(snapshotFor(BORDERS, dayFromIso('1799-04-01'))).toBe('1783');
    // 1 July 1801 lies 365 days after 1 July 1800 and 365 days before 1 July 1802.
    const tied = { ...BORDERS, stems: ['1800', '1802'], years: [1800, 1802] };
    expect(snapshotFor(tied, dayFromIso('1801-07-01'))).toBe('1800');
    expect(snapshotFor({ ...BORDERS, stems: [], years: [] }, 0)).toBeUndefined();
  });
});
