// The release (streaming.md 3.8), merged from the stage records (7.2) of a profile's build as
// `npm run publish-data` publishes it: the surface section from the coverage and surface records,
// the modera and borders sections as their records have them, when the build has run those stages,
// and the media section, every key the stories' committed locks name (3.9). The local data server
// (dataServer.ts) serves a release of this shape for a profile's build, so lab and dev pages read
// what a published release will give them; both find the build with profileBuild. Plain Node, so
// it runs outside Vite.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  BordersRelease,
  MediaRelease,
  ModeraRelease,
  Release,
  SurfaceRelease,
} from '../src/data/release.ts';
import type { StoryLock } from '../src/story/lock.ts';

export type Profile = 'fixture' | 'region' | 'global';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Each profile's output root under build/ (streaming.md 7.1): the global profile writes build/out/. */
export const OUTPUT_DIR: Record<Profile, string> = {
  fixture: 'fixture',
  region: 'region',
  global: 'out',
};

/** The command that makes each profile's build, for the error when it is missing. */
const REBUILD: Record<Profile, string> = {
  fixture: 'run `npm run fixture` in app/',
  region: 'run `uv run prebuild --profile region` in pipeline/',
  global: 'run `uv run prebuild` in pipeline/',
};

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

/**
 * A profile's output root and stage records under `repo`'s build/; throws, naming the command that
 * makes them, when the build is missing.
 */
export function profileBuild(profile: Profile, repo = REPO_ROOT): { root: string; stages: string } {
  const root = resolve(repo, 'build', OUTPUT_DIR[profile]);
  const stages = resolve(repo, 'build', 'stages', profile);
  for (const required of [root, join(stages, 'coverage.json'), join(stages, 'surface.json')]) {
    if (!existsSync(required)) {
      throw new ReleaseError(`${required} is missing: ${REBUILD[profile]}`);
    }
  }
  return { root, stages };
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
 * The media section: every file of every image in the stories' locks, which the media stage
 * (`uv run prebuild media --story <id>`) writes beside each story.md. Keys name their bytes, so a
 * key two stories share is listed once.
 */
export function mediaRelease(stories = join(REPO_ROOT, 'stories')): MediaRelease {
  const keys = readdirSync(stories).flatMap((story) => {
    const path = join(stories, story, 'story.lock.json');
    if (!existsSync(path)) return [];
    const lock = JSON.parse(readFileSync(path, 'utf8')) as StoryLock;
    return lock.images.flatMap((image) => image.files.map((file) => file.key));
  });
  return { images: [...new Set(keys)].sort() };
}

/**
 * The release for the build whose stage records are in `stages`, served from `dataHost`. Its id
 * follows 3.8, the first 16 hex digits of the sha256 of its JSON without the id, and `built` is
 * when the surface record was written, so the same build and locks always give the same release.
 * The modera and borders records are 3.8's sections as is (7.2), so each goes in unchanged when the
 * build has one.
 */
export function localRelease(stages: string, dataHost: string): Release {
  const coverage = readRecord<CoverageRecord>(stages, 'coverage');
  const surface = readRecord<SurfaceRecord>(stages, 'surface');
  const built = statSync(join(stages, 'surface.json')).mtime.toISOString();
  const optional = <T>(stage: string): T | undefined =>
    existsSync(join(stages, `${stage}.json`)) ? readRecord<T>(stages, stage) : undefined;
  const body = {
    built,
    dataHost,
    surface: surfaceRelease(coverage, surface),
    modera: optional<ModeraRelease>('modera'),
    borders: optional<BordersRelease>('borders'),
    media: mediaRelease(),
  };
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
