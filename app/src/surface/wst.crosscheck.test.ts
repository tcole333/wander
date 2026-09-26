// The decoder against the Python encoder: the fixture build writes synthetic .wst tiles with the
// planes and GPU outputs each must decode to (streaming.md 3.1), and every one must match bit for
// bit.
import { describe, expect, it } from 'vitest';
import { readExpectation, readExpectationBytes } from '../test/fixture';
import { faceEdgeSides, parseTileKey } from './cube';
import {
  FLAG_ALL_SEA,
  FLAG_INLAND_WATER,
  MAX_PAYLOAD_BYTES,
  MIP_START,
  PROFILE_ENTRIES,
  decodePlanes,
  decodeWst,
  inflate,
  payloadBytes,
  type DecodedWst,
  type WstHeader,
} from './wst';

type PlaneName = 'codes' | 'shore' | 'water';
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
const PROFILES_AT = 26;
/** Payload offset of the code of entry k of the first stored side's profile. */
const firstSideCode = (k: number) => PROFILES_AT + 2 * k;

function syntheticTile(name: string): SyntheticTile {
  const tile = tiles.find((t) => t.name === name);
  if (!tile) throw new Error(`synthetic.json has no ${name} tile`);
  return tile;
}

function stored(tile: SyntheticTile): ArrayBuffer {
  return readExpectationBytes(tile.wst).buffer;
}

async function payload(tile: SyntheticTile): Promise<Uint8Array> {
  return (await inflate(stored(tile), MAX_PAYLOAD_BYTES)).slice();
}

function storedSides(tile: SyntheticTile): number {
  return faceEdgeSides(parseTileKey(tile.key)).length;
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

  it('store edge profiles on 0, 1, 2 and 4 sides', () => {
    expect(tiles.map(storedSides).sort()).toEqual([0, 1, 2, 4]);
  });

  it('pad the payload with a zero byte after an odd number of stored sides', async () => {
    const odd = tiles.filter((tile) => storedSides(tile) % 2 === 1);
    expect(odd).not.toHaveLength(0);
    for (const tile of odd) {
      const raw = await payload(tile);
      const pad = PROFILES_AT + 3 * PROFILE_ENTRIES * storedSides(tile);
      expect(raw.length, tile.name).toBe(pad + 1 + 4 * 264 * 264);
      expect(raw[pad], tile.name).toBe(0);
    }
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

  it('builds the mips, RG8 channels, edge texture and grid bit for bit', async () => {
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
  // The face-4 Kirkuk corner tile at L7, which stores E and then S; S's last entry and E's first
  // share the tile's SE corner.
  const tile = syntheticTile('extremes');
  const expected = parseTileKey(tile.key);
  const { codeMid, codeMin, codeMax } = tile.header;

  async function refusal(change: (raw: Uint8Array, view: DataView) => Uint8Array | void) {
    const raw = await payload(tile);
    const changed = change(raw, new DataView(raw.buffer)) ?? raw;
    return () => decodePlanes(changed, expected);
  }

  it('a short or long payload', async () => {
    expect(await refusal((raw) => raw.subarray(0, raw.length - 1))).toThrow(/bytes/);
    expect(
      await refusal((raw) => {
        const longer = new Uint8Array(raw.length + 1);
        longer.set(raw);
        return longer;
      }),
    ).toThrow(/bytes/);
  });

  it('a payload shorter than its header', async () => {
    expect(await refusal((raw) => raw.subarray(0, PROFILES_AT - 1))).toThrow(/header/);
  });

  it('a payload that leaves out the pad byte after one stored side', async () => {
    const random = syntheticTile('random');
    const raw = await payload(random);
    const pad = PROFILES_AT + 3 * PROFILE_ENTRIES;
    const unpadded = new Uint8Array(raw.length - 1);
    unpadded.set(raw.subarray(0, pad));
    unpadded.set(raw.subarray(pad + 1), pad);
    expect(() => decodePlanes(unpadded, parseTileKey(random.key))).toThrow(
      `payload is ${payloadBytes(1) - 1} bytes, not ${payloadBytes(1)} for 1 stored sides`,
    );
  });

  it('a wrong magic', async () => {
    expect(await refusal((_, view) => view.setUint8(3, 0x32))).toThrow(/magic/);
  });

  it('the previous version', async () => {
    expect(await refusal((_, view) => view.setUint8(4, 1))).toThrow(/version is 1, not 2/);
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

  it('a profile code more than 2048 above codeMid', async () => {
    expect(
      await refusal((_, view) => view.setInt16(firstSideCode(100), codeMid + 2049, true)),
    ).toThrow(/reach past codeMid/);
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

describe('the decoder refuses stored sides that disagree at a tile corner', () => {
  // The L0 face-2 tile, which stores all four sides in N, E, S, W order. Each case moves side b's
  // corner entry to the other extreme of side a's (which keeps the code range) or its shore byte to
  // the other end, so only that corner disagrees. The corners are written out here rather than
  // read from the decoder, so a row it drops still fails.
  const tile = syntheticTile('root');
  const expected = parseTileKey(tile.key);
  const { codeMin, codeMax } = tile.header;
  const SIDES = 'NESW';
  const CORNERS = [
    ['NW', 0, 0, 3, -1],
    ['NE', 0, -1, 1, -1],
    ['SW', 2, 0, 3, 0],
    ['SE', 2, -1, 1, 0],
  ] as const;
  const cases = CORNERS.flatMap((corner) =>
    [0, 1, 2].flatMap((mip) => [
      [...corner, mip, 'code'] as const,
      [...corner, mip, 'shore byte'] as const,
    ]),
  );

  it.each(cases)(
    'at %s: %s and %s disagree at mip %i, in the %s',
    async (_, a, atA, b, atB, mip, what) => {
      const index = (at: number) => (MIP_START[mip] ?? NaN) + (at < 0 ? 256 >> mip : 0);
      const codeAt = (side: number, at: number) =>
        PROFILES_AT + 2 * (PROFILE_ENTRIES * side + index(at));
      const shoreAt = (side: number, at: number) =>
        PROFILES_AT + 2 * PROFILE_ENTRIES * 4 + PROFILE_ENTRIES * side + index(at);
      const raw = await payload(tile);
      const view = new DataView(raw.buffer);
      if (what === 'code') {
        view.setInt16(
          codeAt(b, atB),
          codeMin + codeMax - view.getInt16(codeAt(a, atA), true),
          true,
        );
      } else {
        raw[shoreAt(b, atB)] = 255 - (raw[shoreAt(a, atA)] ?? NaN);
      }
      expect(() => decodePlanes(raw, expected)).toThrow(
        `edge profiles ${SIDES[a]} and ${SIDES[b]} disagree at a tile corner at mip ${mip}`,
      );
    },
  );
});

describe('the decoder counts the stored profile entries in the code bounds', () => {
  // The face-5 tile along its face's N edge, which stores N alone.
  const tile = syntheticTile('random');
  const expected = parseTileKey(tile.key);
  const below = tile.header.codeMin - 1;
  const entries = [
    ['mip 0 entry 100', 100],
    ['mip 2 entry 10', (MIP_START[2] ?? NaN) + 10],
  ] as const;

  async function withLowEntry(k: number): Promise<{ raw: Uint8Array; view: DataView }> {
    const raw = await payload(tile);
    const view = new DataView(raw.buffer);
    view.setInt16(firstSideCode(k), below, true);
    return { raw, view };
  }

  it.each(entries)('so it takes a codeMin that only N %s reaches', async (_, k) => {
    const { raw, view } = await withLowEntry(k);
    view.setInt16(22, below, true);
    expect(decodePlanes(raw, expected).header.codeMin).toBe(below);
  });

  it.each(entries)('so it refuses a codeMin above N %s', async (_, k) => {
    const { raw } = await withLowEntry(k);
    expect(() => decodePlanes(raw, expected)).toThrow(/header codes/);
  });
});
