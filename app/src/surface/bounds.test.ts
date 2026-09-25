// bounds.bin parsing on hand-built files. fixture.test.ts reads the fixture build's own file and
// checks it against the decoded tiles.
import { describe, expect, it } from 'vitest';
import { BOUNDS_MAGIC, BOUNDS_VERSION, parseSurfaceBounds } from './bounds';
import { nodeCount } from './cube';

const MAX_LEVEL = 1;
const AVAIL_BYTES = Math.ceil(nodeCount(MAX_LEVEL) / 8); // 30 nodes

function bitmap(nodes: number[]): Uint8Array {
  const avail = new Uint8Array(AVAIL_BYTES);
  for (const k of nodes) avail[k >> 3] = (avail[k >> 3] ?? 0) | (1 << (k & 7));
  return avail;
}

interface Header {
  magic: string;
  version: number;
  maxLevel: number;
  count: number;
}

function file(entries: [number, number][], changes: Partial<Header> = {}): ArrayBuffer {
  const header: Header = {
    magic: BOUNDS_MAGIC,
    version: BOUNDS_VERSION,
    maxLevel: MAX_LEVEL,
    count: entries.length,
    ...changes,
  };
  const buf = new ArrayBuffer(12 + 4 * entries.length);
  const view = new DataView(buf);
  [...header.magic].forEach((c, k) => view.setUint8(k, c.charCodeAt(0)));
  view.setUint8(4, header.version);
  view.setUint8(5, header.maxLevel);
  view.setUint32(8, header.count, true);
  entries.forEach(([low, high], k) => {
    view.setInt16(12 + 4 * k, low, true);
    view.setInt16(14 + 4 * k, high, true);
  });
  return buf;
}

describe('parseSurfaceBounds', () => {
  it('pairs the entries with the available nodes in node order', () => {
    const bounds = parseSurfaceBounds(
      file([
        [-10994, 8848],
        [-3, 0],
        [12, 400],
      ]),
      bitmap([0, 7, 29]),
    );
    expect([...bounds]).toEqual([
      [0, [-10994, 8848]],
      [7, [-3, 0]],
      [29, [12, 400]],
    ]);
  });

  it('refuses a wrong magic or version', () => {
    expect(() => parseSurfaceBounds(file([], { magic: 'WST1' }), bitmap([]))).toThrow(/magic/);
    expect(() => parseSurfaceBounds(file([], { version: 2 }), bitmap([]))).toThrow(/version/);
  });

  it('refuses a bitmap sized for another maxLevel', () => {
    expect(() => parseSurfaceBounds(file([], { maxLevel: 2 }), bitmap([]))).toThrow(/maxLevel/);
  });

  it('refuses a count the file does not hold', () => {
    expect(() => parseSurfaceBounds(file([[0, 1]], { count: 2 }), bitmap([0, 1]))).toThrow(
      /do not hold/,
    );
  });

  it('refuses a count other than the number of available nodes', () => {
    expect(() => parseSurfaceBounds(file([[0, 1]]), bitmap([0, 1]))).toThrow(/more available/);
    expect(() =>
      parseSurfaceBounds(
        file([
          [0, 1],
          [0, 1],
        ]),
        bitmap([3]),
      ),
    ).toThrow(/2 bounds for 1/);
  });

  it('refuses a file shorter than its header', () => {
    expect(() => parseSurfaceBounds(new ArrayBuffer(8), bitmap([]))).toThrow(/header/);
  });
});
