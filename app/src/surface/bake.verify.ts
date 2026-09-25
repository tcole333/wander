// The region bake (streaming.md 7.3, Bake check), after `uv run prebuild --profile region`:
// `npm run verify:bake` decodes every tile of build/region as the app decodes it and checks seams
// within faces and across face edges with the fixture's checks (../test/seams.ts), each header
// against its planes, bounds.bin and availability against the tiles, and known places. It covers
// what the fixture never exercises: the GEBCO overviews, global reads with the longitude wrap and
// pole clamp, full Natural Earth data, and owner-frame rasters on real face edges. It runs only
// locally, since the bake reads the raw data; a missing or stale bake fails, naming the command.
import { beforeAll, describe, expect, it } from 'vitest';
import { surfaceAvailability } from '../test/fixture';
import { DATELINE_GEBCO, TAMBORA_GEBCO_MAX, TAMBORA_TEXEL_M } from '../test/places';
import {
  layerFiles,
  layerVersion,
  loadRegionTile,
  readLayerFile,
  readRegionBake,
} from '../test/region';
import {
  REGION_CROSS_FACE,
  codeAt,
  crossFaceMisses,
  edgeCodes,
  edgeProfileMatches,
  mipCodes,
  withinFaceMismatches,
} from '../test/seams';
import { parseSurfaceBounds } from './bounds';
import { codeToMeters } from './codes';
import {
  BORDER,
  EDGES,
  availGet,
  faceOf,
  faceSt,
  lonLatToDir,
  neighbor,
  nodeCount,
  nodeFromIndex,
  nodeIndex,
  texelOf,
  tileKey,
  tileOf,
  type Tile,
} from './cube';
import { SIZE, inflate, type DecodedWst } from './wst';

const EVERY_TILE_BELOW = 5; // L0-L4 bake every tile (streaming.md 7.1)
const CACHE_TILES = 256; // decoded tiles kept while the sweep walks node order
const WATER_BYTE = 128; // water bytes below it lie inside lakes or rivers
const BOUNDS_BYTES = 1 << 20;
const SHOWN = 20; // failures listed per check; the count covers the rest
// Georgian Bay lies inside NE's Lake Huron polygon, so it stays water only because the lakes are
// unioned before the even-odd fill (streaming.md 3.1). This point is about 40 km from its shore,
// and about 780 km from the New England region's center, so its tiles are baked at L0-L6.
const GEORGIAN_BAY = { lon: -81.1, lat: 45.58, deepestLevel: 6 };
// Lake Huron's main body: every point within 30 km of this one, about 73 km from the shore.
const LAKE_HURON = { lon: -82.35, lat: 44.73, radiusKm: 30 };
const EARTH_RADIUS_KM = 6371.0088;
const GRID_DEG = 0.1;
const GRID_KM = 11.1; // 0.1° of latitude

const bake = readRegionBake();
const avail = surfaceAvailability(bake.surface);
const available: Tile[] = [];
for (let k = 0; k < nodeCount(bake.surface.maxLevel); k += 1) {
  if (availGet(avail, k)) available.push(nodeFromIndex(k));
}
const availableNodes = new Set(available.map(nodeIndex));
const levels = [...Array(bake.surface.maxLevel + 1).keys()];
const everywhere = levels.slice(0, EVERY_TILE_BELOW);
const cache = new Map<number, Promise<DecodedWst>>();

interface Findings {
  undecoded: string[];
  headers: string[];
  bounds: string[];
  withinFace: string[];
  edgeProfiles: string[];
  crossFace: string[];
  /** Per level, the within-face pairs checked, each once from its west or south tile. */
  withinFacePairs: number[];
  /** Per level, the (tile, edge) checked on a face edge, so each edge once from either side. */
  faceEdges: number[];
}

let bounds: Map<number, [number, number]>;
let findings: Findings;

beforeAll(async () => {
  const raw = await inflate(readLayerFile(bake, 'bounds.bin').buffer, BOUNDS_BYTES);
  bounds = parseSurfaceBounds(raw.slice().buffer, avail);
  findings = await sweep();
});

/** A decoded tile of the bake, kept among the CACHE_TILES most recently asked for. */
function decoded(t: Tile): Promise<DecodedWst> {
  const node = nodeIndex(t);
  const cached = cache.get(node);
  cache.delete(node);
  const found = cached ?? loadRegionTile(bake, t);
  cache.set(node, found);
  const oldest = cache.keys().next();
  if (cache.size > CACHE_TILES && !oldest.done) cache.delete(oldest.value);
  return found;
}

/** Every available tile in node order: its header and bounds, and each available neighbor. */
async function sweep(): Promise<Findings> {
  const found: Findings = {
    undecoded: [],
    headers: [],
    bounds: [],
    withinFace: [],
    edgeProfiles: [],
    crossFace: [],
    withinFacePairs: levels.map(() => 0),
    faceEdges: levels.map(() => 0),
  };
  for (const t of available) {
    const key = tileKey(t);
    let mine: DecodedWst;
    try {
      mine = await decoded(t);
    } catch (error) {
      found.undecoded.push(`${key}: ${String(error)}`);
      continue;
    }
    const { codeMin, codeMax } = mine.header;
    const [low, high] = codeRange(mine);
    if (low !== codeMin || high !== codeMax) {
      found.headers.push(`${key}: header ${codeMin}..${codeMax}, planes and edges ${low}..${high}`);
    }
    const entry = bounds.get(nodeIndex(t));
    if (entry?.[0] !== mine.boundsM[0] || entry[1] !== mine.boundsM[1]) {
      found.bounds.push(`${key}: bounds.bin ${String(entry)}, decoded ${String(mine.boundsM)}`);
    }
    for (const edge of EDGES) {
      const other = neighbor(t, edge);
      const withinFace = other.tile.face === t.face;
      // Within a face each pair is checked once, from its west or south tile.
      if (withinFace && (edge === 'W' || edge === 'S')) continue;
      if (!availableNodes.has(nodeIndex(other.tile))) continue;
      const theirs = await decoded(other.tile).catch(() => null);
      if (theirs === null) continue; // reported as undecoded in its own turn
      const pair = `${key} ${edge}`;
      if (!edgeProfileMatches(t, edge, mine, theirs)) found.edgeProfiles.push(pair);
      if (withinFace) {
        found.withinFacePairs[t.level] = (found.withinFacePairs[t.level] ?? 0) + 1;
        const off = withinFaceMismatches(mine, theirs, edge);
        found.withinFace.push(...off.map((what) => `${pair}: ${what}`));
      } else {
        found.faceEdges[t.level] = (found.faceEdges[t.level] ?? 0) + 1;
        found.crossFace.push(...crossFaceMisses(t, edge, mine, theirs, REGION_CROSS_FACE));
      }
    }
  }
  return found;
}

/** The lowest and highest code of the stored heights and the edge profiles. */
function codeRange(tile: DecodedWst): [number, number] {
  let low = Infinity;
  let high = -Infinity;
  for (const values of [mipCodes(tile, 0), ...EDGES.map((edge) => edgeCodes(tile, edge))]) {
    for (const code of values) {
      low = Math.min(low, code);
      high = Math.max(high, code);
    }
  }
  return [low, high];
}

/** How many of a check's failures there are, and the first few. */
function failures(list: string[]): { count: number; first: string[] } {
  return { count: list.length, first: list.slice(0, SHOWN) };
}

const NONE = { count: 0, first: [] };

/** The tile at `level` holding (lon, lat), and the stored index of the texel there. */
function locate(lon: number, lat: number, level: number): { tile: Tile; at: number } {
  const dir = lonLatToDir(lon, lat);
  const face = faceOf(dir);
  const [s, t] = faceSt(face, dir);
  const tile = { face, level, x: tileOf(s, level), y: tileOf(t, level) };
  const i = texelOf(s, level, tile.x);
  const j = texelOf(t, level, tile.y);
  return { tile, at: (j + BORDER) * SIZE + (i + BORDER) };
}

/** Half the wider gap from a code's meters to a neighbor's: the most rounding moves a height. */
function halfStep(code: number, q: number): number {
  const meters = codeToMeters(code, q);
  return Math.max(codeToMeters(code + 1, q) - meters, meters - codeToMeters(code - 1, q)) / 2;
}

function waterByte(tile: DecodedWst, at: number): number {
  return tile.channelMips[0][2 * at + 1] ?? NaN;
}

/** Levels at which the tile holding (lon, lat) is baked. */
function bakedLevels(lon: number, lat: number): number[] {
  return levels.filter((level) => availableNodes.has(nodeIndex(locate(lon, lat, level).tile)));
}

/** Points on a 0.1° grid within `radiusKm` of (lon, lat). */
function disc(lon: number, lat: number, radiusKm: number): [number, number][] {
  const steps = Math.ceil(radiusKm / GRID_KM / Math.cos((lat * Math.PI) / 180));
  const points: [number, number][] = [];
  for (let b = -steps; b <= steps; b += 1) {
    for (let a = -steps; a <= steps; a += 1) {
      const p: [number, number] = [lon + a * GRID_DEG, lat + b * GRID_DEG];
      if (greatCircleKm(p, [lon, lat]) <= radiusKm) points.push(p);
    }
  }
  return points;
}

function greatCircleKm([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

describe('the region bake', () => {
  it('decodes every available tile', () => {
    expect(failures(findings.undecoded)).toEqual(NONE);
  });

  it('holds a file for exactly the available tiles, hashing to the layer version', () => {
    const { tiles, others } = layerFiles(bake);
    expect(tiles.sort()).toEqual(available.map(tileKey).sort());
    expect(others).toEqual(['bounds.bin']);
    expect(bake.surface.bounds).toBe(`surf/${bake.surface.ver}/bounds.bin`);
    expect(layerVersion(bake)).toBe(bake.surface.ver);
  });

  it('bakes every tile at L0-L4, and per level the counts coverage recorded', () => {
    const counts = levels.map((level) => available.filter((t) => t.level === level).length);
    expect(counts).toEqual(bake.coverage.counts);
    expect(counts.slice(0, EVERY_TILE_BELOW)).toEqual(everywhere.map((level) => 6 * 4 ** level));
  });

  it('gives each header the code range of its planes and edge profiles', () => {
    expect(failures(findings.headers)).toEqual(NONE);
  });

  it("holds in bounds.bin each tile's decoded meter bounds", () => {
    expect(bounds.size).toBe(available.length);
    expect(failures(findings.bounds)).toEqual(NONE);
  });
});

describe('seams', () => {
  it('within a face, neighbors share their border texels at mips 0-2', () => {
    expect(failures(findings.withinFace)).toEqual(NONE);
    const pairs = everywhere.map((level) => 2 * 6 * 2 ** level * (2 ** level - 1));
    expect(findings.withinFacePairs.slice(0, EVERY_TILE_BELOW)).toEqual(pairs);
  });

  it('neighbors share their edge profiles, within a face and across face edges', () => {
    expect(failures(findings.edgeProfiles)).toEqual(NONE);
  });

  it('across a face edge, border texels map into neighbor column k, near the codes there', () => {
    expect(failures(findings.crossFace)).toEqual(NONE);
    const edges = everywhere.map((level) => 6 * 4 * 2 ** level);
    expect(findings.faceEdges.slice(0, EVERY_TILE_BELOW)).toEqual(edges);
  });
});

describe('known places', () => {
  it('Georgian Bay is water at every level its tile is baked', async () => {
    const baked = bakedLevels(GEORGIAN_BAY.lon, GEORGIAN_BAY.lat);
    expect(baked).toEqual(levels.filter((level) => level <= GEORGIAN_BAY.deepestLevel));
    for (const level of baked) {
      const { tile, at } = locate(GEORGIAN_BAY.lon, GEORGIAN_BAY.lat, level);
      expect(waterByte(await decoded(tile), at), `L${level}`).toBeLessThan(WATER_BYTE);
    }
  });

  it("Lake Huron's main body is water at every level its tiles are baked", async () => {
    const off: string[] = [];
    const points = disc(LAKE_HURON.lon, LAKE_HURON.lat, LAKE_HURON.radiusKm);
    for (const [lon, lat] of points) {
      for (const level of bakedLevels(lon, lat)) {
        const { tile, at } = locate(lon, lat, level);
        const water = waterByte(await decoded(tile), at);
        if (!(water < WATER_BYTE))
          off.push(`L${level} ${lon.toFixed(2)}, ${lat.toFixed(2)}: ${water}`);
      }
    }
    expect(points).not.toHaveLength(0);
    expect(off).toEqual([]);
  });

  it.each(
    DATELINE_GEBCO.flatMap(({ face, lat, meters }) =>
      meters.map(([lowest, highest], level) => [face, level, lat, lowest, highest] as const),
    ),
  )(
    "the dateline texel on face %i at L%i and its neighbors along s hold GEBCO's heights there",
    async (face, level, lat, lowest, highest) => {
      const { tile, at } = locate(180, lat, level);
      expect(tile.face).toBe(face);
      const found = await decoded(tile);
      const q = found.header.qLand;
      for (const k of [at - 1, at, at + 1]) {
        const code = codeAt(found, 0, k);
        const meters = codeToMeters(code, q);
        expect(meters).toBeGreaterThanOrEqual(lowest - halfStep(code, q));
        expect(meters).toBeLessThanOrEqual(highest + halfStep(code, q));
      }
    },
  );

  it("decodes Tambora's L7 summit between its texel mean less q/2 and GEBCO's peak", async () => {
    const { tile } = locate(TAMBORA_GEBCO_MAX.lon, TAMBORA_GEBCO_MAX.lat, 7);
    expect(availableNodes.has(nodeIndex(tile))).toBe(true);
    const summit = await decoded(tile);
    const q = summit.header.qLand;
    const highest = codeToMeters(
      mipCodes(summit, 0).reduce((a, b) => Math.max(a, b), -Infinity),
      q,
    );
    expect(highest).toBeGreaterThanOrEqual(TAMBORA_TEXEL_M - q / 2);
    expect(highest).toBeLessThanOrEqual(TAMBORA_GEBCO_MAX.meters);
  });
});
