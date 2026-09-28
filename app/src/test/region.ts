// Reads either real surface bake (streaming.md 7.3), after checking its records, pipeline code,
// configs and pinned sources. A missing or stale bake names the command that rebuilds it.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { tileKey, type Tile } from '../surface/cube';
import { decodeWst, type DecodedWst } from '../surface/wst';
import { REPO_ROOT, type SurfaceRecord } from './fixture';
import { treeSha } from './stamp';

// pipeline/src/prebuild/hashing.py CODE_PATHS, whose exact tree hash is inputs.code.
export const CODE_PATHS = [
  'pipeline/src',
  'pipeline/config',
  'pipeline/pyproject.toml',
  'pipeline/uv.lock',
  'shared/constants.json',
];

export type BakeProfile = 'region' | 'global';
const OUTPUT = { region: 'region', global: 'out' };
// pipeline/src/prebuild/coverage.py CONFIGS: the global bake never reads the region cutouts.
const CONFIGS = {
  region: ['l7.yaml', 'regions-milestone1.yaml', 'water.yaml'],
  global: ['l7.yaml', 'water.yaml'],
};

/** What the coverage stage read, as sha256s (streaming.md 7.2). */
export interface StageInputs {
  gebco: string;
  ne: Record<string, string>;
  configs: Record<string, string>;
  code: string;
}

/** The coverage stage's record (streaming.md 7.2). */
export interface CoverageRecord {
  qLand: number[];
  c200: number[];
  counts: number[];
  avail: string;
  /** The records of older prebuilds lack it. */
  inputs?: StageInputs;
}

/** The surface stage's record (streaming.md 7.2). */
export interface RegionSurfaceRecord extends SurfaceRecord {
  /** The coverage inputs its layer was built from; the records of older prebuilds lack them. */
  inputs?: StageInputs;
}

export interface RegionBake {
  profile: BakeProfile;
  coverage: CoverageRecord;
  surface: RegionSurfaceRecord;
  /** The surface layer's folder under this profile's output root. */
  layer: string;
}

export class StaleRegionBake extends Error {
  override name = 'StaleRegionBake';
}

/**
 * The region bake's records, once its surface layer exists, its surface record was built from the
 * inputs its coverage record holds, and those inputs' code hash and source hashes match the working
 * tree. Throws a StaleRegionBake naming the command to run otherwise.
 */
export function readRegionBake(repo: string = REPO_ROOT): RegionBake {
  return readBake('region', repo);
}

/** A real bake, with region remaining the default for the lab's existing readers. */
export function readBake(profile: BakeProfile = 'region', repo: string = REPO_ROOT): RegionBake {
  const stale = (reason: string) =>
    new StaleRegionBake(
      `build/${OUTPUT[profile]} is missing or stale (${reason}): ` +
        `run \`uv run prebuild --profile ${profile} coverage surface\` in pipeline/`,
    );
  const stages = join(repo, 'build', 'stages', profile);
  const coverage = readJson<CoverageRecord>(join(stages, 'coverage.json'));
  const surface = readJson<RegionSurfaceRecord>(join(stages, 'surface.json'));
  if (coverage === null || surface === null) throw stale('it has no coverage or surface record');
  const layer = join(repo, 'build', OUTPUT[profile], 'surf', surface.ver);
  if (!existsSync(layer)) throw stale(`build/${OUTPUT[profile]}/surf/${surface.ver}/ is missing`);
  if (surface.avail !== coverage.avail) {
    throw stale('the surface record was built from another coverage record');
  }
  if (!isDeepStrictEqual(surface.inputs, coverage.inputs)) {
    throw stale('the surface layer was built from other inputs than the coverage record holds');
  }
  const { inputs } = coverage;
  if (inputs?.code !== treeSha(CODE_PATHS, repo)) {
    throw stale('it was built from other pipeline code, configs or shared constants');
  }
  const configs = Object.fromEntries(
    CONFIGS[profile].map((name) => {
      const path = join(repo, 'pipeline', 'config', name);
      return [
        name,
        existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null,
      ];
    }),
  );
  if (!isDeepStrictEqual(inputs.configs, configs)) {
    throw stale('its surface configs differ from this profile’s current configs');
  }
  const pinned = readFileSync(join(repo, 'pipeline', 'sources.toml'), 'utf8');
  const read = [inputs.gebco, ...Object.values(inputs.ne)];
  if (!read.every((sha256) => pinned.includes(`"${sha256}"`))) {
    throw stale('it read other sources than pipeline/sources.toml pins');
  }
  return { profile, coverage, surface, layer };
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

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}
