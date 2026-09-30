// The release (streaming.md 3.8), merged from the stage records (7.2) of a profile's build as
// `npm run publish-data` publishes it: the surface section from the coverage and surface records,
// the modera section as its record has it, the borderSteps and borders sections from the borders
// record, when the build has run those stages,
// the events section from the event-files record less its `inputs`, once they show its overview
// holds the committed openings (3.4), and the media section, every key the stories' committed
// locks name (3.9). The local data server (dataServer.ts) serves a release of this shape for a
// profile's build, so lab and dev pages read what a published release will give them; both find
// the build with profileBuild. Plain Node, so it runs outside Vite.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  BorderStepsRelease,
  BordersRelease,
  EventsRelease,
  FxRelease,
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

/**
 * The borders stage's record (7.2): the steps' release section, the step each story's border beats
 * draw and what the history pass still owes, and milestone 1's 1815 field as its `borders` section.
 * The region profile bakes only the 1815 field and the fixture only the steps.
 */
export interface BordersRecord extends Partial<BordersRelease> {
  steps?: BorderStepsRelease;
  beats?: Record<string, Record<string, number>>;
  /** Overlap pairs past duplicateShare that no `overlap` correction acknowledges. */
  unacknowledged?: { polities: string[]; steps: number[] }[];
  /** Composites and vassalage relations hierarchy.yaml does not class. */
  unclassified?: { composites: string[]; relations: string[] };
  inputs?: { code: string; cliopatria: string };
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

/** Explore's openings, whose events event-files forces into the overview (streaming.md 3.4). */
export const OPENINGS_LOCK = join(REPO_ROOT, 'explore', 'openings.lock.json');

interface EventFilesRecord extends EventsRelease {
  /** The sha256 of the openings lock whose events the overview holds. */
  inputs?: { openings?: string };
}

/**
 * The events section: the event-files record without its `inputs`, which name what built it and
 * no key, once they show its overview holds the openings `lock` lists now. `stages` is
 * build/stages/<profile>/, which names the command that rebuilds it.
 */
export function eventsRelease(
  record: EventFilesRecord,
  stages: string,
  lock = OPENINGS_LOCK,
): EventsRelease {
  const { inputs, ...events } = record;
  const current = createHash('sha256').update(readFileSync(lock)).digest('hex');
  if (inputs?.openings !== current) {
    const profile = basename(stages);
    const rebuild =
      profile === 'fixture'
        ? REBUILD.fixture
        : `run \`uv run prebuild --profile ${profile} event-files\` in pipeline/`;
    throw new ReleaseError(
      `the event-files record was built from another explore/openings.lock.json: ${rebuild}`,
    );
  }
  return events;
}

/** The borders stage's record in `stages`, when the build has one. */
export function readBordersRecord(stages: string): BordersRecord | undefined {
  return existsSync(join(stages, 'borders.json'))
    ? readRecord<BordersRecord>(stages, 'borders')
    : undefined;
}

/** The 1815 field's `borders` section, when the record holds one. */
export function snapshotRelease(record: BordersRecord): BordersRelease | undefined {
  const { ver, stems, years, files } = record;
  if (ver === undefined || stems === undefined || years === undefined || files === undefined) {
    return undefined;
  }
  return { ver, stems, years, files };
}

/**
 * What the borders record still owes the history pass (streaming.md 3.3), which publish-data
 * refuses to upload: each overlap pair no `overlap` correction acknowledges, and each composite or
 * vassalage relation hierarchy.yaml does not class. Empty when it owes nothing.
 */
export function historyOwed(record: BordersRecord): string[] {
  const pairs = (record.unacknowledged ?? []).map(
    ({ polities, steps }) => `overlap of ${polities.join(' and ')} (${steps.join(', ')})`,
  );
  const { composites = [], relations = [] } = record.unclassified ?? {};
  const unclassed = [...composites, ...relations].map((name) => `unclassified ${name}`);
  return [...pairs, ...unclassed];
}

/**
 * The release for the build whose stage records are in `stages`, served from `dataHost`. Its id
 * follows 3.8, the first 16 hex digits of the sha256 of its JSON without the id, and `built` is
 * when the surface record was written, so the same build and locks always give the same release.
 * The modera record is 3.8's section as is (7.2), so it goes in unchanged when the build has one;
 * the borders record gives the borderSteps section as its `steps` and the borders section as the
 * 1815 field's fields; the event-files record goes in without its `inputs` (`eventsRelease`).
 */
export function localRelease(stages: string, dataHost: string, lock = OPENINGS_LOCK): Release {
  const coverage = readRecord<CoverageRecord>(stages, 'coverage');
  const surface = readRecord<SurfaceRecord>(stages, 'surface');
  const built = statSync(join(stages, 'surface.json')).mtime.toISOString();
  const optional = <T>(stage: string): T | undefined =>
    existsSync(join(stages, `${stage}.json`)) ? readRecord<T>(stages, stage) : undefined;
  const eventFiles = optional<EventFilesRecord>('event-files');
  const borders = readBordersRecord(stages);
  const body = {
    built,
    dataHost,
    surface: surfaceRelease(coverage, surface),
    modera: optional<ModeraRelease>('modera'),
    borders: borders && snapshotRelease(borders),
    borderSteps: borders?.steps,
    fx: optional<FxRelease>('fx'),
    events: eventFiles ? eventsRelease(eventFiles, stages, lock) : undefined,
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
