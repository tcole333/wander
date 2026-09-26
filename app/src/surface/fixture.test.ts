// The fixture's surface layer (streaming.md 7.3), baked by the Python pipeline from the committed
// excerpts and decoded here as the app decodes it: availability and node order, every tile's
// planes against the encoder's hashes, bounds.bin against the decoded bounds, and known places.
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  hasSurfaceTile,
  loadSurfaceTile,
  readExpectation,
  readFixtureFile,
  readSurfaceRecord,
  surfaceAvailability,
  type FixtureTile,
} from '../test/fixture';
import { TAMBORA_GEBCO_MAX, TAMBORA_TEXEL_M } from '../test/places';
import { parseSurfaceBounds } from './bounds';
import { codeToMeters } from './codes';
import {
  BORDER,
  availGet,
  faceOf,
  faceSt,
  lonLatToDir,
  nodeCount,
  nodeFromIndex,
  nodeIndex,
  parseTileKey,
  texelOf,
  tileKey,
  tileOf,
} from './cube';
import { SIZE, inflate, type WstHeader } from './wst';

type Plane = 'codes' | 'shore' | 'water' | 'edges' | 'grid';

interface ExpectedTile {
  node: number;
  header: WstHeader;
  boundsM: [number, number];
  sha256: Record<Plane, string>;
}

interface ExpectedPoint {
  name: string;
  lon: number;
  lat: number;
  key: string;
  i: number;
  j: number;
  /** The clamped height before quantization. */
  meters: number;
  shoreSign: number;
  waterSign: number;
}

const FIXTURE_TILES = 55;
const SHELF_M = -200;

const record = readSurfaceRecord();
const avail = surfaceAvailability(record);
const expected = readExpectation<Record<string, ExpectedTile>>('tiles.json');
const points = readExpectation<ExpectedPoint[]>('points.json');
const keys = Object.keys(expected);
const tiles = new Map<string, FixtureTile>();

beforeAll(async () => {
  for (const key of keys) tiles.set(key, await loadSurfaceTile(record, key));
});

function tile(key: string): FixtureTile {
  const found = tiles.get(key);
  if (!found) throw new Error(`the fixture has no tile ${key}`);
  return found;
}

function sha256(values: ArrayBufferView): string {
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  return createHash('sha256').update(bytes).digest('hex');
}

/** The stored texel (row, column) index of tile-local texel (i, j). */
function at(i: number, j: number): number {
  return (j + BORDER) * SIZE + (i + BORDER);
}

describe('the fixture surface layer', () => {
  it('makes exactly the tiles of tiles.json available, in node order', () => {
    const available: string[] = [];
    for (let k = 0; k < nodeCount(record.maxLevel); k += 1) {
      if (availGet(avail, k)) available.push(tileKey(nodeFromIndex(k)));
    }
    expect(available).toEqual(keys);
    expect(keys).toHaveLength(FIXTURE_TILES);
  });

  it('indexes each tile at the node the pipeline gave it', () => {
    const nodes = keys.map((key) => nodeIndex(parseTileKey(key)));
    expect(nodes).toEqual(keys.map((key) => expected[key]?.node));
  });

  it('holds a file for every available tile', () => {
    expect(keys.filter((key) => !hasSurfaceTile(record, key))).toEqual([]);
    expect(record.bounds).toBe(`surf/${record.ver}/bounds.bin`);
  });
});

describe('decoding the fixture tiles', () => {
  it('decodes each tile to the planes, edge texture and grid the pipeline decodes', () => {
    const off = keys.flatMap((key) => {
      const { decoded, planes } = tile(key);
      const got: Record<Plane, string> = {
        codes: sha256(planes.codes),
        shore: sha256(planes.shore),
        water: sha256(planes.water),
        edges: sha256(decoded.edges),
        grid: sha256(decoded.grid),
      };
      const want = expected[key]?.sha256;
      return (Object.keys(got) as Plane[])
        .filter((plane) => got[plane] !== want?.[plane])
        .map((plane) => `${key} ${plane}`);
    });
    expect(off).toEqual([]);
  });

  it('reads the headers and gives the meter bounds the pipeline gives', () => {
    for (const key of keys) {
      const { decoded } = tile(key);
      expect(decoded.header, key).toEqual(expected[key]?.header);
      expect(decoded.boundsM, key).toEqual(expected[key]?.boundsM);
    }
  });
});

describe('bounds.bin', () => {
  it('holds each available node the bounds its decoded tile gives', async () => {
    const raw = await inflate(readFixtureFile(record.bounds).buffer, 1 << 20);
    const bounds = parseSurfaceBounds(raw.slice().buffer, avail);
    expect(bounds.size).toBe(keys.length);
    const off = keys.filter((key) => {
      const entry = bounds.get(nodeIndex(parseTileKey(key)));
      const want = tile(key).decoded.boundsM;
      return entry?.[0] !== want[0] || entry[1] !== want[1];
    });
    expect(off).toEqual([]);
  });
});

describe('known places', () => {
  function point(name: string): ExpectedPoint {
    const found = points.find((p) => p.name === name);
    if (!found) throw new Error(`points.json has no ${name}`);
    return found;
  }

  function byte(p: ExpectedPoint, plane: 'shore' | 'water', di = 0, dj = 0): number {
    return tile(p.key).planes[plane][at(p.i + di, p.j + dj)] ?? NaN;
  }

  it.each(points.map((p) => [p.name, p] as const))(
    '%s lies in the tile and texel the pipeline found',
    (_, p) => {
      const dir = lonLatToDir(p.lon, p.lat);
      const face = faceOf(dir);
      const [s, t] = faceSt(face, dir);
      const { level } = parseTileKey(p.key);
      const x = tileOf(s, level);
      const y = tileOf(t, level);
      expect(tileKey({ face, level, x, y })).toBe(p.key);
      expect([texelOf(s, level, x), texelOf(t, level, y)]).toEqual([p.i, p.j]);
    },
  );

  it.each(points.map((p) => [p.name, p] as const))(
    '%s decodes to its height within half a code step',
    (_, p) => {
      const { planes, decoded } = tile(p.key);
      const q = decoded.header.qLand;
      const meters = codeToMeters(planes.codes[at(p.i, p.j)] ?? NaN, q);
      const halfStep = p.meters < SHELF_M ? 2 * q : q / 2;
      expect(Math.abs(meters - p.meters)).toBeLessThanOrEqual(halfStep);
    },
  );

  it("puts Tambora's summit on its tile's highest texel", () => {
    const { planes, decoded } = tile(point('tambora-summit').key);
    const q = decoded.header.qLand;
    const highest = codeToMeters(
      planes.codes.reduce((a, b) => Math.max(a, b), -Infinity),
      q,
    );
    expect(highest).toBeGreaterThanOrEqual(TAMBORA_TEXEL_M - q / 2);
    expect(highest).toBeLessThanOrEqual(TAMBORA_GEBCO_MAX.meters);
  });

  it('marks the land points as land and the Flores Sea as sea', () => {
    const land = ['tambora-summit', 'tambora-caldera', 'sanggar'].map(point);
    expect(land.map((p) => byte(p, 'shore'))).toEqual([255, 255, 255]);
    expect(land.map((p) => p.shoreSign)).toEqual([1, 1, 1]);
    expect(byte(point('flores-sea'), 'shore')).toBe(0);
  });

  it('marks Lake Urmia and the Tigris as water', () => {
    expect(byte(point('lake-urmia'), 'water')).toBe(0);
    const tigris = point('tigris');
    const around = [-1, 0, 1].flatMap((dj) =>
      [-1, 0, 1].map((di) => byte(tigris, 'water', di, dj)),
    );
    expect(Math.min(...around)).toBeLessThan(128);
  });
});
