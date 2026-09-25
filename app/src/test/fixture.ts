// Reads the fixture build (streaming.md 7.3): its test sidecars, stage records and the surface
// layer's files, but only after checking that build/fixture exists and its stamp matches the
// current pipeline code, constants and excerpts. A missing or stale fixture fails the suite
// loudly; no test is skipped.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTileKey } from '../surface/cube';
import {
  PAYLOAD_BYTES,
  decodePlanes,
  decodeWst,
  inflate,
  type DecodedWst,
  type WstPlanes,
} from '../surface/wst';
import { treeSha } from './stamp';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const STALE_FIXTURE = 'build/fixture is missing or stale: run `npm run fixture`';

const FIXTURE_STAGES = join(REPO_ROOT, 'build', 'stages', 'fixture');
const FIXTURE_OUT = join(REPO_ROOT, 'build', 'fixture');

/** The surface stage's record (streaming.md 7.2). */
export interface SurfaceRecord {
  ver: string;
  maxLevel: number;
  /** Base64, one bit per node (streaming.md 3.0 item 8). */
  avail: string;
  /** `surf/<ver8>/bounds.bin`. */
  bounds: string;
}

/** A fixture tile as the decoder hands it to the GPU, and the planes it decoded them from. */
export interface FixtureTile {
  decoded: DecodedWst;
  planes: WstPlanes;
}

interface Stamp {
  inputs: string;
  paths: string[];
}

/** Throws STALE_FIXTURE unless build/fixture exists and its stamp matches the files it hashed. */
export function assertFixtureFresh(repo: string = REPO_ROOT): void {
  const stamp = readStamp(join(repo, 'build', 'stages', 'fixture', 'stamp.json'));
  const fresh =
    stamp !== null &&
    existsSync(join(repo, 'build', 'fixture')) &&
    treeSha(stamp.paths, repo) === stamp.inputs;
  if (!fresh) throw new Error(STALE_FIXTURE);
}

/** A sidecar from build/stages/fixture/expect/, once the fixture is known to be fresh. */
export function readExpectation<T>(name: string): T {
  checkFreshOnce();
  return JSON.parse(readFileSync(join(FIXTURE_STAGES, 'expect', name), 'utf8')) as T;
}

/** A binary sidecar from build/stages/fixture/expect/, in a buffer of its own. */
export function readExpectationBytes(name: string): Uint8Array<ArrayBuffer> {
  checkFreshOnce();
  return new Uint8Array(readFileSync(join(FIXTURE_STAGES, 'expect', name)));
}

/** A stage record from build/stages/fixture/. */
export function readStageRecord<T>(stage: string): T {
  checkFreshOnce();
  return JSON.parse(readFileSync(join(FIXTURE_STAGES, `${stage}.json`), 'utf8')) as T;
}

/** A file under the fixture's output root, build/fixture/, in a buffer of its own. */
export function readFixtureFile(path: string): Uint8Array<ArrayBuffer> {
  checkFreshOnce();
  return new Uint8Array(readFileSync(join(FIXTURE_OUT, path)));
}

export function readSurfaceRecord(): SurfaceRecord {
  return readStageRecord<SurfaceRecord>('surface');
}

/** The record's availability bitmap. */
export function surfaceAvailability(record: SurfaceRecord): Uint8Array {
  return new Uint8Array(Buffer.from(record.avail, 'base64'));
}

/** Whether the surface layer holds `<key>.wst`. */
export function hasSurfaceTile(record: SurfaceRecord, key: string): boolean {
  checkFreshOnce();
  return existsSync(join(FIXTURE_OUT, 'surf', record.ver, `${key}.wst`));
}

/** Decode a tile of the fixture's surface layer, as the decode worker does. */
export async function loadSurfaceTile(record: SurfaceRecord, key: string): Promise<FixtureTile> {
  const stored = readFixtureFile(`surf/${record.ver}/${key}.wst`).buffer;
  const tile = parseTileKey(key);
  const { planes } = decodePlanes(await inflate(stored, PAYLOAD_BYTES), tile);
  return { decoded: await decodeWst(stored, tile), planes };
}

let freshChecked = false;

// The inputs cannot change while a test file runs, so one check per file is enough.
function checkFreshOnce(): void {
  if (freshChecked) return;
  assertFixtureFresh();
  freshChecked = true;
}

function readStamp(path: string): Stamp | null {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { inputs, paths } = value as Partial<Stamp>;
  if (typeof inputs !== 'string' || !Array.isArray(paths)) return null;
  if (!paths.every((path) => typeof path === 'string')) return null;
  return { inputs, paths };
}
