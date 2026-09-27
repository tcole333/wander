// npm run publish-data (streaming.md 4.3): uploads a release's data to R2 and writes its
// release.json. The keys are exactly those the release names, found in the profile's output root,
// so older versions left there are never uploaded. R2 is listed first: keys are content-versioned,
// so a key present with another size stops the run before any upload. The canary (bounds.bin and
// the L0 tiles) goes up first and the headers R2 stored with it are checked, because a key is never
// overwritten and the edge keeps whatever it sees for a year; the rest follows. Every PUT carries
// If-None-Match: *, so nothing is overwritten, and a key already there is checked by size. Last
// come the bundled app/src/generated/release.json and its copy rel/<id>.json; CI's
// `npm run check-release` reads the same roots through the data host. The fixture never leaves
// this machine: `npm run data -- --profile fixture` serves it and its release. Plain Node:
//
//   npm run publish-data -- [--profile global|region] [--dry-run]
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { ModeraRelease, Release, SurfaceRelease } from '../src/data/release.ts';
import { objectHeaders } from './objectHeaders.ts';
import { R2Bucket, readR2Env, R2Error } from './r2.ts';
import { localRelease, OUTPUT_DIR, profileBuild, ReleaseError, REPO_ROOT } from './release.ts';

const DATA_HOST = 'https://wander-data.traviscole.xyz';
const GENERATED = join(REPO_ROOT, 'app', 'src', 'generated', 'release.json');
const CONCURRENCY = 24;
const TILE = /\/\d+\/[0-5]\/\d+\/\d+\.wst$/;

export class PublishError extends Error {
  override name = 'PublishError';
}

/** A file the release names, under its R2 key. */
export interface LocalObject {
  key: string;
  path: string;
  size: number;
}

/** A release section's objects, all under one key prefix, which is how R2 is listed. */
export interface Section {
  prefix: string;
  objects: LocalObject[];
}

/**
 * The objects the release names, by section, found in the profile's output root. Each section the
 * release gains (overlays, events, climate years, story media) adds its entry here.
 */
export function releaseSections(release: Release, root: string): Section[] {
  const sections = [surfaceSection(release.surface, root)];
  if (release.modera) sections.push(moderaSection(release.modera, root));
  return sections;
}

/** The canary: bounds.bin and the six L0 tiles, the first objects any page asks for. */
function canaryKeys({ surface }: Release): string[] {
  const l0 = [0, 1, 2, 3, 4, 5].map((face) => `surf/${surface.ver}/0/${face}/0/0.wst`);
  return [surface.bounds, ...l0];
}

/** release.json's bytes, the same bundled and on R2: two-space JSON and a trailing newline. */
function releaseJson(release: Release): string {
  return `${JSON.stringify(release, null, 2)}\n`;
}

/** bounds.bin and every tile under surf/<ver>/, as many tiles as the release makes available. */
function surfaceSection(surface: SurfaceRelease, root: string): Section {
  const prefix = `surf/${surface.ver}/`;
  const tiles = keysUnder(root, prefix).filter((key) => TILE.test(key));
  const available = countBits(surface.avail);
  if (tiles.length !== available) {
    const folder = join(root, prefix);
    throw new PublishError(`${folder} holds ${tiles.length} tiles, not the ${available} available`);
  }
  return { prefix, objects: [surface.bounds, ...tiles].map((key) => localObject(root, key)) };
}

/**
 * Every climate file the modera record lists: the mean and spread years and annual.bin under
 * fd/modera/<ver>/, each the size the record gives it.
 */
function moderaSection(modera: ModeraRelease, root: string): Section {
  const prefix = `fd/modera/${modera.ver}/`;
  const sized: [key: string, bytes: number][] = [
    ...(['mean', 'spread'] as const).flatMap((variable) =>
      Object.entries(modera.bytes[variable]).map(([year, bytes]): [string, number] => [
        `${prefix}${variable}/${year}.bin`,
        bytes,
      ]),
    ),
    [`${prefix}annual.bin`, modera.bytes.annual],
  ];
  const objects = sized.map(([key, bytes]) => {
    const object = localObject(root, key);
    if (object.size !== bytes) {
      throw new PublishError(`${object.path} holds ${object.size} B, not the record's ${bytes} B`);
    }
    return object;
  });
  return { prefix, objects };
}

function keysUnder(root: string, prefix: string): string[] {
  const folder = join(root, prefix);
  if (!existsSync(folder)) throw new PublishError(`${folder} is missing`);
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

function localObject(root: string, key: string): LocalObject {
  const path = join(root, key);
  if (!objectHeaders(key)) throw new PublishError(`${key} has an extension R2 never holds`);
  if (!existsSync(path)) throw new PublishError(`${path} is missing`);
  return { key, path, size: statSync(path).size };
}

function countBits(base64: string): number {
  let count = 0;
  for (let byte of Buffer.from(base64, 'base64')) {
    for (; byte !== 0; byte &= byte - 1) count += 1;
  }
  return count;
}

/** The profiles whose builds go to R2. */
const PUBLISHED = ['global', 'region'] as const;

export interface PublishOptions {
  profile: (typeof PUBLISHED)[number];
  /** List R2 and report what an upload would send, writing nothing. */
  dryRun?: boolean;
}

export async function publish(options: PublishOptions): Promise<void> {
  const { profile, dryRun = false } = options;
  const { root, stages } = profileBuild(profile);
  const release = localRelease(stages, DATA_HOST);
  const json = releaseJson(release);
  const sections = releaseSections(release, root);
  const size = Buffer.byteLength(json);
  const copy: LocalObject = { key: `rel/${release.id}.json`, path: GENERATED, size };

  const bucket = new R2Bucket(readR2Env());
  const plans = await plan(bucket, [...sections, { prefix: copy.key, objects: [copy] }]);
  console.log(`release ${release.id}, from build/${OUTPUT_DIR[profile]}/:`);
  for (const { prefix, objects, missing } of plans) {
    console.log(
      `  ${prefix}: ${missing.length} of ${objects.length} keys to upload, ${sizeOf(missing)}`,
    );
  }
  const missing = plans.flatMap((p) => p.missing);
  if (dryRun) {
    console.log(`dry run: ${missing.length} keys to upload, ${sizeOf(missing)}; nothing written`);
    return;
  }

  const canary = new Set(canaryKeys(release));
  const inCanary = (object: LocalObject) => canary.has(object.key);
  const canaryObjects = sections.flatMap((section) => section.objects).filter(inCanary);
  await uploadAll(bucket, 'canary', missing.filter(inCanary));
  for (const object of canaryObjects) await checkOrigin(bucket, object);
  console.log('canary: R2 stored its headers');

  const rest = missing.filter((object) => object !== copy && !inCanary(object));
  await uploadAll(bucket, 'upload', rest);
  mkdirSync(dirname(GENERATED), { recursive: true });
  writeFileSync(GENERATED, json);
  if (missing.includes(copy)) await uploadAll(bucket, 'release', [copy]);
  console.log(`release ${release.id} is on R2: commit ${relative(REPO_ROOT, GENERATED)}`);
}

/** Each section with what R2 lacks of it; a key R2 holds at another size stops the run. */
export async function plan(bucket: Pick<R2Bucket, 'list'>, sections: Section[]) {
  const plans: (Section & { missing: LocalObject[] })[] = [];
  const conflicts: string[] = [];
  for (const section of sections) {
    const remote = await bucket.list(section.prefix);
    for (const { key, size } of section.objects) {
      const held = remote.get(key);
      if (held !== undefined && held !== size) conflicts.push(`${key} (${held} B, not ${size} B)`);
    }
    plans.push({ ...section, missing: section.objects.filter(({ key }) => !remote.has(key)) });
  }
  if (conflicts.length > 0) {
    const listed = conflicts.slice(0, 5).join(', ');
    throw new PublishError(`R2 holds ${conflicts.length} keys at another size: ${listed}`);
  }
  return plans;
}

/**
 * Uploads with bounded concurrency; the first failure stops it. Progress rewrites one line on a
 * terminal and prints a line every few seconds otherwise.
 */
async function uploadAll(bucket: R2Bucket, label: string, objects: LocalObject[]): Promise<void> {
  if (objects.length === 0) return;
  const total = objects.reduce((sum, object) => sum + object.size, 0);
  const tty = process.stdout.isTTY;
  let next = 0;
  let done = 0;
  let bytes = 0;
  let stopped = false;
  let shown = Date.now();
  const show = (end: boolean) => {
    if (!end && Date.now() - shown < (tty ? 100 : 5000)) return;
    shown = Date.now();
    const line = `${label}: ${done} of ${objects.length} keys, ${scaled(bytes)} of ${scaled(total)}`;
    process.stdout.write(tty ? `\r${line}\x1b[K${end ? '\n' : ''}` : `${line}\n`);
  };
  const worker = async () => {
    while (!stopped && next < objects.length) {
      const object = objects[next++]!;
      try {
        await upload(bucket, object);
      } catch (error) {
        stopped = true;
        throw error;
      }
      done += 1;
      bytes += object.size;
      show(false);
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, objects.length) }, worker));
  } finally {
    show(true);
  }
}

/** One PUT that never overwrites; a key already there must hold as many bytes. */
async function upload(bucket: R2Bucket, object: LocalObject): Promise<void> {
  const body = await readFile(object.path);
  if ((await bucket.put(object.key, body, objectHeaders(object.key)!)) === 'created') return;
  const held = (await bucket.head(object.key))?.get('content-length');
  if (Number(held) !== object.size) {
    throw new PublishError(`${object.key} is on R2 with ${held} B, not ${object.size} B`);
  }
}

/** The headers R2 stored with the object, read over the S3 endpoint. */
async function checkOrigin(bucket: R2Bucket, object: LocalObject): Promise<void> {
  const headers = await bucket.head(object.key);
  if (!headers) throw new PublishError(`${object.key} is not on R2`);
  const { 'Cache-Control': cacheControl, 'Content-Type': contentType } = objectHeaders(object.key)!;
  const expected = {
    'cache-control': cacheControl,
    'content-type': contentType,
    'content-length': String(object.size),
  };
  const wrong = Object.entries(expected).filter(([name, value]) => headers.get(name) !== value);
  if (wrong.length === 0) return;
  const found = wrong.map(([name, value]) => `${name} is ${headers.get(name)}, not ${value}`);
  throw new PublishError(`${object.key} on R2: ${found.join('; ')}`);
}

function sizeOf(objects: LocalObject[]): string {
  const bytes = objects.reduce((sum, object) => sum + object.size, 0);
  return bytes < 1e3 ? `${bytes} B` : `${bytes.toLocaleString('en-US')} B (${scaled(bytes)})`;
}

function scaled(bytes: number): string {
  return bytes < 1e6 ? `${(bytes / 1e3).toFixed(1)} KB` : `${(bytes / 1e6).toFixed(1)} MB`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // npm keeps a flag written before `--` as its own config and runs the script without it, so
  // `npm run publish-data --dry-run` would upload everything: a flag npm kept stops the run.
  const kept = ['dry-run', 'profile'].filter(
    (flag) => process.env[`npm_config_${flag.replace('-', '_')}`] !== undefined,
  );
  if (kept.length > 0) {
    throw new PublishError(`npm kept --${kept.join(' and --')}: put the flags after \`--\``);
  }
  const { values } = parseArgs({
    options: {
      profile: { type: 'string', default: 'global' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  const profile = PUBLISHED.find((name) => name === values.profile);
  if (profile === undefined) {
    const serve = '`npm run data -- --profile fixture` serves the fixture';
    throw new PublishError(`--profile must be global or region; ${serve}`);
  }
  try {
    await publish({ profile, dryRun: values['dry-run'] });
  } catch (error) {
    const known = [PublishError, R2Error, ReleaseError].find((type) => error instanceof type);
    if (!known) throw error;
    console.error(`publish-data: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
