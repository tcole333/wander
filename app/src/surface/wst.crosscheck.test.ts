// The decoder against the Python encoder: the fixture build writes synthetic .wst tiles with the
// planes and GPU outputs each must decode to (streaming.md 3.1), and every one must match bit for
// bit.
import { describe, expect, it } from 'vitest';
import { readExpectation, readExpectationBytes } from '../test/fixture';
import { parseTileKey } from './cube';
import {
  FLAG_ALL_SEA,
  FLAG_INLAND_WATER,
  PAYLOAD_BYTES,
  decodePlanes,
  decodeWst,
  inflate,
  type DecodedWst,
  type WstHeader,
  type WstPlanes,
} from './wst';

type PlaneName = keyof Omit<WstPlanes, 'edges'>;
type OutputName =
  | PlaneName
  | 'height0'
  | 'height1'
  | 'height2'
  | 'channel0'
  | 'channel1'
  | 'channel2'
  | 'edges'
  | 'grid';

interface SyntheticTile {
  name: string;
  key: string;
  wst: string;
  header: WstHeader;
  boundsM: [number, number];
  outputs: Record<OutputName, string>;
}

const tiles = readExpectation<SyntheticTile[]>('synthetic.json');
const EDGE_N100 = 26 + 2 * 100; // payload offset of edge profile N, entry 100

function syntheticTile(name: string): SyntheticTile {
  const tile = tiles.find((t) => t.name === name);
  if (!tile) throw new Error(`synthetic.json has no ${name} tile`);
  return tile;
}

function stored(tile: SyntheticTile): ArrayBuffer {
  return readExpectationBytes(tile.wst).buffer;
}

async function payload(tile: SyntheticTile): Promise<Uint8Array> {
  return (await inflate(stored(tile), PAYLOAD_BYTES)).slice();
}

/** Where the bytes of `actual` first differ from the expected output file, or null. */
function mismatch(actual: ArrayBufferView, tile: SyntheticTile, output: OutputName): string | null {
  const got = new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength);
  const want = readExpectationBytes(tile.outputs[output]);
  if (got.length !== want.length) return `${got.length} bytes, not ${want.length}`;
  const at = got.findIndex((byte, k) => byte !== want[k]);
  return at < 0 ? null : `byte ${at} is ${got[at]}, not ${want[at]}`;
}

function outputsOf(decoded: DecodedWst): [OutputName, ArrayBufferView][] {
  return [
    ['height0', decoded.heightMips[0]],
    ['height1', decoded.heightMips[1]],
    ['height2', decoded.heightMips[2]],
    ['channel0', decoded.channelMips[0]],
    ['channel1', decoded.channelMips[1]],
    ['channel2', decoded.channelMips[2]],
    ['edges', decoded.edges],
    ['grid', decoded.grid],
  ];
}

describe('the synthetic tiles', () => {
  it('cover both flags, both offset limits and x and y past one byte', () => {
    const headers = tiles.map((tile) => tile.header);
    expect(headers.some((h) => h.flags & FLAG_INLAND_WATER)).toBe(true);
    expect(headers.some((h) => h.flags & FLAG_ALL_SEA)).toBe(true);
    expect(headers.some((h) => h.codeMax - h.codeMid === 2048)).toBe(true);
    expect(headers.some((h) => h.codeMid - h.codeMin === 2048)).toBe(true);
    expect(headers.some((h) => h.x > 255 && h.y > 255)).toBe(true);
  });
});

describe.each(tiles)('decoding the synthetic tile $name', (tile) => {
  const expected = parseTileKey(tile.key);

  it('restores the planes the encoder was given', async () => {
    const { planes } = decodePlanes(await payload(tile), expected);
    const off = (['codes', 'shore', 'water'] as const).map((name) => [
      name,
      mismatch(planes[name], tile, name),
    ]);
    expect(off).toEqual([
      ['codes', null],
      ['shore', null],
      ['water', null],
    ]);
  });

  it('reads the header the encoder wrote', async () => {
    const decoded = await decodeWst(stored(tile), expected);
    expect(decoded.header).toEqual(tile.header);
  });

  it('builds the mips, RG8 channels, edges and grid bit for bit', async () => {
    const decoded = await decodeWst(stored(tile), expected);
    const off = outputsOf(decoded)
      .map(([name, values]) => [name, mismatch(values, tile, name)])
      .filter(([, problem]) => problem !== null);
    expect(off).toEqual([]);
  });

  it('gives the meter bounds the encoder gives', async () => {
    const decoded = await decodeWst(stored(tile), expected);
    expect(decoded.boundsM).toEqual(tile.boundsM);
  });

  it('hands back the stored bytes it was given', async () => {
    const buf = stored(tile);
    const decoded = await decodeWst(buf, expected);
    expect(decoded.compressed).toBe(buf);
    expect(buf.byteLength).toBeGreaterThan(0);
  });
});

describe('the decoder refuses', () => {
  const tile = syntheticTile('extremes');
  const expected = parseTileKey(tile.key);
  const { codeMid, codeMin, codeMax } = tile.header;

  async function refusal(change: (raw: Uint8Array, view: DataView) => Uint8Array | void) {
    const raw = await payload(tile);
    const changed = change(raw, new DataView(raw.buffer)) ?? raw;
    return () => decodePlanes(changed, expected);
  }

  it('a short or long payload', async () => {
    expect(await refusal((raw) => raw.subarray(0, PAYLOAD_BYTES - 1))).toThrow(/bytes/);
    expect(
      await refusal((raw) => {
        const longer = new Uint8Array(raw.length + 1);
        longer.set(raw);
        return longer;
      }),
    ).toThrow(/bytes/);
  });

  it('a wrong magic', async () => {
    expect(await refusal((_, view) => view.setUint8(3, 0x32))).toThrow(/magic/);
  });

  it('a wrong version', async () => {
    expect(await refusal((_, view) => view.setUint8(4, 2))).toThrow(/version/);
  });

  it('another tile', async () => {
    const raw = await payload(tile);
    const neighbor = { ...expected, y: expected.y + 1 };
    expect(() => decodePlanes(raw, neighbor)).toThrow(/tile is 7\/4\/127\/0, not 7\/4\/127\/1/);
  });

  it('the same x and y on another face', async () => {
    const raw = await payload(tile);
    const across = { ...expected, face: 3 };
    expect(() => decodePlanes(raw, across)).toThrow(/tile is 7\/4\/127\/0, not 7\/3\/127\/0/);
  });

  it('the same x and y on another level', async () => {
    const raw = await payload(tile);
    const finer = { ...expected, level: 8 };
    expect(() => decodePlanes(raw, finer)).toThrow(/tile is 7\/4\/127\/0, not 8\/4\/127\/0/);
  });

  it('a qDeep other than 4·qLand', async () => {
    expect(await refusal((_, view) => view.setFloat32(16, 7, true))).toThrow(/qDeep/);
  });

  // qDeep stays 4·qLand, so only the positive and finite terms can refuse these.
  it.each([0, -2, Infinity])('a qLand of %s', async (q) => {
    expect(
      await refusal((_, view) => {
        view.setFloat32(12, q, true);
        view.setFloat32(16, 4 * q, true);
      }),
    ).toThrow(/positive/);
  });

  it.each([1, -1])(
    'a codeMid moved by %i, which leaves a code more than 2048 away',
    async (shift) => {
      expect(await refusal((_, view) => view.setInt16(20, codeMid + shift, true))).toThrow(
        /codeMid/,
      );
    },
  );

  it('an edge code more than 2048 above codeMid', async () => {
    expect(await refusal((_, view) => view.setInt16(EDGE_N100, codeMid + 2049, true))).toThrow(
      /reach past codeMid/,
    );
  });

  it('a codeMin or codeMax that misses the planes', async () => {
    expect(await refusal((_, view) => view.setInt16(22, codeMin - 1, true))).toThrow(
      /header codes/,
    );
    expect(await refusal((_, view) => view.setInt16(24, codeMax - 1, true))).toThrow(
      /header codes/,
    );
  });

  it('bytes that are not gzip', async () => {
    const raw = await payload(tile);
    await expect(decodeWst(raw.slice().buffer, expected)).rejects.toThrow();
  });
});

describe('the decoder counts the edge profiles in the code bounds', () => {
  const tile = syntheticTile('random');
  const expected = parseTileKey(tile.key);
  const below = tile.header.codeMin - 1;

  async function withLowEdge(): Promise<{ raw: Uint8Array; view: DataView }> {
    const raw = await payload(tile);
    const view = new DataView(raw.buffer);
    view.setInt16(EDGE_N100, below, true);
    return { raw, view };
  }

  it('so it takes a codeMin that only an edge code reaches', async () => {
    const { raw, view } = await withLowEdge();
    view.setInt16(22, below, true);
    expect(decodePlanes(raw, expected).header.codeMin).toBe(below);
  });

  it('so it refuses a codeMin above an edge code', async () => {
    const { raw } = await withLowEdge();
    expect(() => decodePlanes(raw, expected)).toThrow(/header codes/);
  });
});
