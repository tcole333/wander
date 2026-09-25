// The release's surface section (streaming.md 3.8), merged from the coverage and surface stage
// records (7.2) as `npm run publish-data` will merge them. The local data server (dataServer.ts)
// serves a release of this shape for a profile's build, so lab and dev pages read what a published
// release will give them. Plain Node, so it runs outside Vite.
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** release.json's `surface`: what the runtime needs to find, place and bound the surface tiles. */
export interface SurfaceRelease {
  ver: string;
  maxLevel: number;
  /** Meters per height code, by level. */
  qLand: number[];
  /** The code for −200 m, by level. */
  c200: number[];
  /** Base64 availability bitmap, one bit per node in node order (3.0 item 8). */
  avail: string;
  /** The key of the layer's bounds.bin. */
  bounds: string;
}

/** The part of release.json this far along: every stage adds its section. */
export interface Release {
  id: string;
  built: string;
  dataHost: string;
  surface: SurfaceRelease;
}

interface CoverageRecord {
  qLand: number[];
  c200: number[];
  avail: string;
}

interface SurfaceRecord {
  ver: string;
  maxLevel: number;
  avail: string;
  bounds: string;
}

export class ReleaseError extends Error {
  override name = 'ReleaseError';
}

/** The surface section, once both records describe the same availability. */
export function surfaceRelease(coverage: CoverageRecord, surface: SurfaceRecord): SurfaceRelease {
  if (coverage.avail !== surface.avail) {
    throw new ReleaseError('the surface record was built from another coverage record');
  }
  const { ver, maxLevel, avail, bounds } = surface;
  const { qLand, c200 } = coverage;
  if (qLand.length !== maxLevel + 1 || c200.length !== maxLevel + 1) {
    throw new ReleaseError(`qLand and c200 need one entry per level 0-${maxLevel}`);
  }
  return { ver, maxLevel, qLand, c200, avail, bounds };
}

/**
 * The release for the build whose stage records are in `stages`, served from `dataHost`. Its id
 * follows 3.8, the first 16 hex digits of the sha256 of its JSON without the id, and `built` is
 * when the surface record was written, so the same build always gives the same release.
 */
export function localRelease(stages: string, dataHost: string): Release {
  const coverage = readRecord<CoverageRecord>(stages, 'coverage');
  const surface = readRecord<SurfaceRecord>(stages, 'surface');
  const built = statSync(join(stages, 'surface.json')).mtime.toISOString();
  const body = { built, dataHost, surface: surfaceRelease(coverage, surface) };
  const id = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16);
  return { id, ...body };
}

function readRecord<T>(stages: string, stage: string): T {
  const path = join(stages, `${stage}.json`);
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (error) {
    throw new ReleaseError(`cannot read the ${stage} record ${path}: ${String(error)}`);
  }
}
