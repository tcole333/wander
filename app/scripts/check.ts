// npm run check [-- --base <rev>]: the inner loop, scoped to what this branch changes since it
// left origin/main (or since <rev>), untracked files included. Prettier and ESLint (both cached)
// on the changed app files, the incremental typecheck, Vitest on the tests the change affects
// (the whole suite when it touches Vitest's config or an input tests read from disk,
// scripts/diskInputs.ts), ruff on the changed Python files and pytest, in one process, on the
// tests of the changed pipeline modules. A stale fixture is restored from the store, or built,
// first. It can miss a type-aware lint finding in an unchanged file and a test input that is
// neither imported nor listed, so npm run gate, the full suites, stays the check before a push.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { configDefaults } from 'vitest/config';
import { treeSha } from '../src/test/stamp.ts';
import { changedSince, git, inert, mergeBase, REPO, under } from './changes.ts';
import { DISK_INPUTS } from './diskInputs.ts';

export interface CheckPlan {
  /** Changed app files, relative to app/, for Prettier; the scripts among them for ESLint. */
  prettier: string[];
  eslint: string[];
  typecheck: boolean;
  /** All of Vitest, the tests that import what changed, or none. */
  vitest: 'all' | 'changed' | false;
  /** Changed Python files, relative to pipeline/, for ruff. */
  ruff: string[];
  /** Test files, relative to pipeline/, for pytest; 'all' for the whole suite. */
  pytest: string[] | 'all';
}

// Inputs any pipeline test may read: a change to one runs all of pytest.
const PYTEST_WIDE = new Set([
  'pipeline/tests/conftest.py',
  'pipeline/pyproject.toml',
  'pipeline/uv.lock',
  'pipeline/sources.toml',
  'pipeline/.python-version',
  'shared/constants.json',
]);
const PYTEST_WIDE_FOLDERS = ['pipeline/config/', 'pipeline/tests/data/', 'stories/', 'explore/'];
// Files outside the pipeline that one pytest file reads, and that file.
const PYTEST_READS = new Map([
  ['docs/design/streaming.md', 'tests/test_constants.py'],
  ['app/scripts/slot.sh', 'tests/test_slots.py'],
]);
// Changes that call for all of Vitest, matched against repo-relative paths: Vitest's own triggers
// (package.json, its config) and the inputs tests read from disk.
const WHOLE_VITEST = [...configDefaults.forceRerunTriggers, ...DISK_INPUTS];

/** The checks for `changed` (repo-relative paths); `exists` says which still exist. */
export function planChecks(
  changed: readonly string[],
  exists: (path: string) => boolean,
): CheckPlan {
  const app = changed.filter((p) => p.startsWith('app/') && exists(p)).map((p) => p.slice(4));
  const tests = new Set<string>();
  for (const path of changed) {
    const module = /^pipeline\/src\/prebuild\/(\w+)\.py$/.exec(path)?.[1];
    const own = `pipeline/tests/test_${module}.py`;
    if (module && exists(own)) tests.add(own.slice(9));
    if (/^pipeline\/tests\/test_\w+\.py$/.test(path) && exists(path)) tests.add(path.slice(9));
    const reader = PYTEST_READS.get(path);
    if (reader) tests.add(reader);
  }
  const wide = changed.some((p) => PYTEST_WIDE.has(p) || under(p, PYTEST_WIDE_FOLDERS));
  const whole = changed.some((p) => WHOLE_VITEST.some((glob) => posix.matchesGlob(p, glob)));
  const some = changed.some((p) => !inert(p) && !/^pipeline\/tests\/[^/]+\.py$/.test(p));
  return {
    prettier: app,
    eslint: app.filter((p) => /\.(ts|js|mjs)$/.test(p)),
    typecheck: changed.some((p) => under(p, ['app/', 'shared/'])),
    vitest: whole ? 'all' : some ? 'changed' : false,
    ruff: changed
      .filter((p) => p.startsWith('pipeline/') && p.endsWith('.py') && exists(p))
      .map((p) => p.slice(9)),
    pytest: wide ? 'all' : [...tests].sort(),
  };
}

/** Whether build/fixture's stamp matches the files it hashed, as Vitest's loader checks it. */
function fixtureFresh(): boolean {
  const stampPath = join(REPO, 'build', 'stages', 'fixture', 'stamp.json');
  if (!existsSync(stampPath) || !existsSync(join(REPO, 'build', 'fixture'))) return false;
  const stamp = JSON.parse(readFileSync(stampPath, 'utf8')) as { inputs: string; paths: string[] };
  return treeSha(stamp.paths, REPO) === stamp.inputs;
}

function main(): number {
  const { values } = parseArgs({ options: { base: { type: 'string' } } });
  const base = values.base ? git(['rev-parse', values.base]) : mergeBase();
  const changed = changedSince(base);
  const plan = planChecks(changed, (path) => existsSync(join(REPO, path)));
  const app = join(REPO, 'app');
  const pipeline = join(REPO, 'pipeline');
  const steps: [label: string, cwd: string, command: string[]][] = [];
  if (plan.prettier.length) {
    steps.push([
      'prettier',
      app,
      ['npx', 'prettier', '--check', '--cache', '--ignore-unknown', ...plan.prettier],
    ]);
  }
  if (plan.eslint.length) {
    const cache = ['--cache', '--cache-location', 'node_modules/.cache/eslint/'];
    steps.push(['eslint', app, ['npx', 'eslint', ...cache, '--no-warn-ignored', ...plan.eslint]]);
  }
  if (plan.typecheck) steps.push(['typecheck', app, ['npx', 'tsc', '-b']]);
  if (plan.vitest && !fixtureFresh()) steps.push(['fixture', app, ['npm', 'run', 'fixture']]);
  if (plan.vitest === 'all') steps.push(['vitest', app, ['npm', 'test']]);
  if (plan.vitest === 'changed') {
    steps.push(['vitest', app, ['npm', 'test', '--', '--changed', base, '--passWithNoTests']]);
  }
  if (plan.ruff.length) {
    steps.push(['ruff', pipeline, ['uv', 'run', 'ruff', 'check', ...plan.ruff]]);
    steps.push(['ruff format', pipeline, ['uv', 'run', 'ruff', 'format', '--check', ...plan.ruff]]);
  }
  if (plan.pytest === 'all') steps.push(['pytest', pipeline, ['uv', 'run', 'pytest']]);
  else if (plan.pytest.length) {
    steps.push(['pytest', pipeline, ['uv', 'run', 'pytest', '-n', '0', ...plan.pytest]]);
  }

  console.log(`check: ${changed.length} paths changed since ${base.slice(0, 12)}`);
  const failed: string[] = [];
  for (const [label, cwd, [command = '', ...args]] of steps) {
    console.log(`\ncheck: ${label}`);
    const { status } = spawnSync(command, args, { cwd, stdio: 'inherit' });
    if (status !== 0) failed.push(label);
  }
  if (!steps.length) console.log('check: nothing to check');
  console.log(failed.length ? `\ncheck: failed: ${failed.join(', ')}` : '\ncheck: passed');
  return failed.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
