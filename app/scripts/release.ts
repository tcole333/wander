// The release (streaming.md 3.8), merged from the stage records (7.2) of a profile's build as
// `npm run publish-data` publishes it: the surface section from the coverage and surface records,
// the modera section as its record has it, the borderSteps section from the borders record, when
// the build has run that stage, the events section from the event-files record less its `inputs`,
// once they show its overview holds the committed openings (3.4), and the media section, every key
// the stories' committed locks name (3.9). The local data server (dataServer.ts) serves a release
// of this shape for a profile's build, so lab and dev pages read what a published release will
// give them; both find the build with profileBuild. Plain Node, so it runs outside Vite.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  BorderStepsRelease,
  EventsRelease,
  FxRelease,
  MediaRelease,
  ModeraRelease,
  NamesRelease,
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
 * A stateless place the history pass owes a cited verdict: its id, which
 * pipeline/config/borders/acknowledged.yaml names it by, where, how large and when, and the
 * owner's acknowledgment of it as a known gap when that file lists it.
 */
export interface OwedPlace {
  id: string;
  at: [number, number];
  km2: number;
  years: [number, number];
  acknowledged?: { verdict: 'known gap'; decided: string; why: string };
}

/**
 * The borders stage's record (7.2): the steps' release section, the step each story's border beats
 * draw and what the history pass still owes. The global and fixture profiles bake it; the region
 * profile bakes no borders.
 */
export interface BordersRecord {
  steps?: BorderStepsRelease;
  beats?: Record<string, Record<string, number>>;
  /** Overlap pairs past duplicateShare that no `overlap` correction acknowledges. */
  unacknowledged?: { polities: string[]; steps: number[] }[];
  /** Composites and vassalage relations hierarchy.yaml does not class. */
  unclassified?: { composites: string[]; relations: string[] };
  /**
   * Stateless holes of 10,000 km² or more no correction cites, with the states around them, and
   * gaps of that size: land held on both sides of a stateless run of at most 25 years that the
   * carry-through leaves stateless, since two polities hold it there (3.3); and `lapsed`, the ids
   * acknowledged.yaml lists that the steps no longer owe.
   */
  owed?: {
    holes: (OwedPlace & { states: string[] })[];
    gaps: OwedPlace[];
    lapsed?: string[];
  };
  inputs?: { code: string; cliopatria: string };
}

/**
 * The names stage's record (7.2): the release's names section, each polity a step draws but names
 * nowhere with why, and the names still long after the short-name rule, for the owner.
 */
export interface NamesRecord {
  names: NamesRelease;
  unnamed?: { polity: string; reason: string; years: number[][] }[];
  longNames?: { name: string; full: string; length: number; years: number[][] }[];
  inputs?: { code: string; steps: string };
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

/**
 * What the borders record still owes the history pass (streaming.md 3.3), which publish-data
 * refuses to upload: each overlap pair no `overlap` correction acknowledges, each composite or
 * vassalage relation hierarchy.yaml does not class, and each stateless hole and gap no correction
 * gives a verdict (owner decision 38) and acknowledged.yaml does not list as a known gap, named by
 * its id. Empty when it owes nothing.
 */
export function historyOwed(record: BordersRecord): string[] {
  const pairs = (record.unacknowledged ?? []).map(
    ({ polities, steps }) => `overlap of ${polities.join(' and ')} (${steps.join(', ')})`,
  );
  const { composites = [], relations = [] } = record.unclassified ?? {};
  const unclassed = [...composites, ...relations].map((name) => `unclassified ${name}`);
  const place = ({ at, km2, years }: OwedPlace) =>
    `${km2.toLocaleString('en')} km² at ${at[0]}, ${at[1]} in ${years[0]}-${years[1]}`;
  const holes = (record.owed?.holes ?? [])
    .filter((hole) => !hole.acknowledged)
    .map((hole) => `stateless hole of ${place(hole)} (${hole.states.join(', ')}), '${hole.id}'`);
  const gaps = (record.owed?.gaps ?? [])
    .filter((gap) => !gap.acknowledged)
    .map((gap) => `stateless gap of ${place(gap)}, '${gap.id}'`);
  return [...pairs, ...unclassed, ...holes, ...gaps];
}

/** The owed places acknowledged.yaml lists as known gaps, which publish-data accepts (3.3). */
export function knownGaps(record: BordersRecord): OwedPlace[] {
  const { holes = [], gaps = [] } = record.owed ?? {};
  return [...holes, ...gaps].filter((place) => place.acknowledged);
}

/**
 * The names section, once the names record was placed on the border steps the release names; a
 * release without them names none. `stages` is build/stages/<profile>/, which names the command.
 */
export function namesRelease(
  record: NamesRecord | undefined,
  steps: BorderStepsRelease | undefined,
  stages: string,
): NamesRelease | undefined {
  if (!record || !steps) return undefined;
  if (record.names.steps !== steps.ver) {
    const profile = basename(stages);
    const rebuild =
      profile === 'fixture'
        ? REBUILD.fixture
        : `run \`uv run prebuild --profile ${profile} names\` in pipeline/`;
    throw new ReleaseError(`the names were placed on other border steps: ${rebuild}`);
  }
  return record.names;
}

/**
 * The release for the build whose stage records are in `stages`, served from `dataHost`. Its id
 * follows 3.8, the first 16 hex digits of the sha256 of its JSON without the id, and `built` is
 * when the surface record was written, so the same build and locks always give the same release.
 * The modera record is 3.8's section as is (7.2), so it goes in unchanged when the build has one;
 * the borders record gives the borderSteps section as its `steps`, and the names record the names
 * section placed on them (`namesRelease`); the event-files record goes in without its `inputs`
 * (`eventsRelease`).
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
    borderSteps: borders?.steps,
    names: namesRelease(optional<NamesRecord>('names'), borders?.steps, stages),
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
