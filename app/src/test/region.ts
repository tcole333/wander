// Reads the region bake (streaming.md 7.3, Bake check): the stage records in
// build/stages/region/ and the surface layer in build/region/, but only after checking that the
// bake is complete and was built from the prebuild code, configs and pinned sources the working
// tree holds. A missing or stale bake fails loudly, naming the command that rebuilds it.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { tileKey, type Tile } from '../surface/cube';
import { decodeWst, type DecodedWst } from '../surface/wst';
import { REPO_ROOT, type SurfaceRecord } from './fixture';
import { treeSha } from './stamp';

// The paths CODE_PATHS names in pipeline/src/prebuild/hashing.py, whose tree hash the coverage
// record keeps as inputs.code.
const CODE_PATHS = [
  'pipeline/src',
  'pipeline/config',
  'pipeline/pyproject.toml',
  'pipeline/uv.lock',
  'shared/constants.json',
];
const REBUILD = 'run `uv run prebuild --profile region` in pipeline/';

/** The coverage stage's record (streaming.md 7.2). */
export interface CoverageRecord {
  qLand: number[];
  c200: number[];
  counts: number[];
  avail: string;
  /** What the stage read, as sha256s; the records of older prebuilds lack it. */
  inputs?: {
    gebco: string;
    ne: Record<string, string>;
    configs: Record<string, string>;
    code: string;
  };
}

export interface RegionBake {
  coverage: CoverageRecord;
  surface: SurfaceRecord;
  /** The surface layer's folder, build/region/surf/<ver8>/. */
  layer: string;
}

export class StaleRegionBake extends Error {
  override name = 'StaleRegionBake';
}

/**
 * The region bake's records, once its surface layer exists, its surface record comes from its
 * coverage record, and that record's code hash and source hashes match the working tree. Throws a
 * StaleRegionBake naming the command to run otherwise.
 */
export function readRegionBake(repo: string = REPO_ROOT): RegionBake {
  const stages = join(repo, 'build', 'stages', 'region');
  const coverage = readJson<CoverageRecord>(join(stages, 'coverage.json'));
  const surface = readJson<SurfaceRecord>(join(stages, 'surface.json'));
  if (coverage === null || surface === null) throw stale('it has no coverage or surface record');
  const layer = join(repo, 'build', 'region', 'surf', surface.ver);
  if (!existsSync(layer)) throw stale(`build/region/surf/${surface.ver}/ is missing`);
  if (surface.avail !== coverage.avail) {
    throw stale('the surface record was built from another coverage record');
  }
  const { inputs } = coverage;
  if (inputs?.code !== treeSha(CODE_PATHS, repo)) {
    throw stale('it was built from other prebuild code, configs or shared constants');
  }
  const pinned = readFileSync(join(repo, 'pipeline', 'sources.toml'), 'utf8');
  const read = [inputs.gebco, ...Object.values(inputs.ne)];
  if (!read.every((sha256) => pinned.includes(`"${sha256}"`))) {
    throw stale('it read other sources than pipeline/sources.toml pins');
  }
  return { coverage, surface, layer };
}

/** Keys (`L/f/x/y`) of the .wst files in the layer, and its other files, by layer-relative path. */
export function layerFiles(bake: RegionBake): { tiles: string[]; others: string[] } {
  const files = readdirSync(bake.layer, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(bake.layer, join(entry.parentPath, entry.name)).split(sep).join('/'));
  return {
    tiles: files.filter((path) => path.endsWith('.wst')).map((path) => path.slice(0, -4)),
    others: files.filter((path) => !path.endsWith('.wst')),
  };
}

/** The version the layer's files hash to (pipeline/src/prebuild/hashing.py `ver8`). */
export function layerVersion(bake: RegionBake): string {
  return treeSha(readdirSync(bake.layer), bake.layer).slice(0, 8);
}

/** A file of the layer, such as `bounds.bin`, in a buffer of its own. */
export function readLayerFile(bake: RegionBake, path: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(readFileSync(join(bake.layer, path)));
}

/** Decode a tile of the layer, as the decode worker does. */
export function loadRegionTile(bake: RegionBake, t: Tile): Promise<DecodedWst> {
  return decodeWst(readLayerFile(bake, `${tileKey(t)}.wst`).buffer, t);
}

function stale(reason: string): StaleRegionBake {
  return new StaleRegionBake(`build/region is missing or stale (${reason}): ${REBUILD}`);
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}
