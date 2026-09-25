// Reads the fixture build's test sidecars (streaming.md 7.3), but only after checking that
// build/fixture exists and its stamp matches the current pipeline code, constants and excerpts.
// A missing or stale fixture fails the suite loudly; no test is skipped.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeSha } from './stamp';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const STALE_FIXTURE = 'build/fixture is missing or stale: run `npm run fixture`';

const FIXTURE_STAGES = join(REPO_ROOT, 'build', 'stages', 'fixture');

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
