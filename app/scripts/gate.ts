// npm run gate [-- --swiftshader]: the check before a push. On a clean tree it runs what the
// branch's changes since it left origin/main call for, then records the tree it passed in
// build/gate/<tree sha>, which .githooks/pre-push looks for:
//
// - docs only: nothing
// - app/, stories/, explore/, shared/, pipeline/tests/data/media/ (which the specs read), or a
//   path no rule names: the fixture, npm run lint, the typecheck, all of Vitest and
//   npm run e2e:gpu; with --swiftshader, npm run e2e as well
// - pipeline/, shared/, stories/, explore/: ruff and all of pytest, with the fixture and Vitest,
//   which checks the fixture; e2e too, unless the fixture came out the same as the base's, file
//   for file and in the release the data server derives from it
// - docs/design/streaming.md, which Vitest and pytest read: the fixture, Vitest and pytest
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { git, inert, mergeBase, REPO, under } from './changes.ts';
import { localRelease } from './release.ts';

export type Step =
  'fixture' | 'lint' | 'typecheck' | 'vitest' | 'ruff' | 'pytest' | 'e2e:gpu' | 'e2e';

export interface GatePlan {
  steps: Step[];
  /** Whether e2e may be skipped when the fixture comes out the same as the base's. */
  e2eUnlessFixtureSame: boolean;
}

const APP_INPUTS = ['app/', 'stories/', 'explore/', 'shared/', 'pipeline/tests/data/media/'];
const PIPELINE_INPUTS = ['pipeline/', 'shared/', 'stories/', 'explore/'];
const DESIGN_DOC = 'docs/design/streaming.md';

/** The steps `changed` (repo-relative paths) calls for, in the order the gate runs them. */
export function planGate(changed: readonly string[], swiftshader = false): GatePlan {
  const unknown = changed.some(
    (p) => !inert(p) && p !== DESIGN_DOC && !under(p, [...APP_INPUTS, ...PIPELINE_INPUTS]),
  );
  const app = unknown || changed.some((p) => under(p, APP_INPUTS));
  const pipeline = unknown || changed.some((p) => under(p, PIPELINE_INPUTS));
  const doc = changed.includes(DESIGN_DOC);
  const steps: Step[] = [];
  if (app || pipeline || doc) steps.push('fixture');
  if (app) steps.push('lint', 'typecheck');
  if (app || pipeline || doc) steps.push('vitest');
  if (pipeline) steps.push('ruff');
  if (pipeline || doc) steps.push('pytest');
  if (app || pipeline) steps.push('e2e:gpu', ...(swiftshader ? (['e2e'] as const) : []));
  return { steps, e2eUnlessFixtureSame: pipeline && !app };
}

const COMMANDS: Record<Step, [cwd: 'app' | 'pipeline', command: string[]][]> = {
  fixture: [['app', ['npm', 'run', 'fixture']]],
  lint: [['app', ['npm', 'run', 'lint']]],
  typecheck: [['app', ['npm', 'run', 'typecheck']]],
  vitest: [['app', ['npm', 'test']]],
  ruff: [
    ['pipeline', ['uv', 'run', 'ruff', 'check', '.']],
    ['pipeline', ['uv', 'run', 'ruff', 'format', '--check', '.']],
  ],
  pytest: [['pipeline', ['uv', 'run', 'pytest']]],
  'e2e:gpu': [['app', ['npm', 'run', 'e2e:gpu']]],
  e2e: [['app', ['npm', 'run', 'e2e']]],
};

/** pipeline/src/prebuild/hashing.py's tree_sha over the files `paths` hold at commit `rev`. */
export function treeShaAt(repo: string, rev: string, paths: readonly string[]): string {
  const listing = execFileSync('git', ['ls-tree', '-r', '-z', rev, '--', ...paths], { cwd: repo })
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const [meta = '', path = ''] = entry.split('\t');
      const [mode, type, blob] = meta.split(' ');
      return { mode, type, blob, path };
    })
    .filter(({ mode, type, path }) => type === 'blob' && mode !== '120000' && !skipped(path));
  const lines = listing.map(({ blob = '', path }) => {
    const bytes = execFileSync('git', ['cat-file', 'blob', blob], { cwd: repo });
    return Buffer.from(`${path} ${createHash('sha256').update(bytes).digest('hex')}\n`);
  });
  lines.sort((a, b) => Buffer.compare(a, b));
  return createHash('sha256').update(Buffer.concat(lines)).digest('hex');
}

function skipped(path: string): boolean {
  return path.split('/').some((part) => part === '__pycache__' || part === '.DS_Store');
}

/** A fixture build: its output root and its stage folder. */
export interface FixtureBuild {
  out: string;
  stages: string;
}

/**
 * Whether two fixture builds hold the same thing: the same files, byte for byte, and the same
 * release apart from its build time and id. Their stage records differ after any pipeline code
 * change, since they hash the code, so they are compared through the release alone.
 */
export function sameFixture(a: FixtureBuild, b: FixtureBuild): boolean {
  const release = ({ stages }: FixtureBuild) =>
    JSON.stringify({ ...localRelease(stages, 'http://data'), built: '', id: '' });
  return sameFiles(a.out, b.out) && release(a) === release(b);
}

/** Whether the fixture now built is the base's, as the fixture store holds it. */
function fixtureSameAsBase(base: string): boolean {
  const stages = join(REPO, 'build', 'stages', 'fixture');
  const stamp = JSON.parse(readFileSync(join(stages, 'stamp.json'), 'utf8')) as { paths: string[] };
  const cache = process.env.WANDER_CACHE || join(homedir(), '.cache', 'wander');
  const entry = join(cache, 'fixture', treeShaAt(REPO, base, stamp.paths));
  if (!existsSync(entry)) return false;
  const built = { out: join(REPO, 'build', 'fixture'), stages };
  return sameFixture(built, { out: join(entry, 'out'), stages: join(entry, 'stages') });
}

function sameFiles(a: string, b: string): boolean {
  const listed = (root: string): string[] =>
    readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((path) => statSync(join(root, path)).isFile())
      .sort();
  const files = listed(a);
  if (JSON.stringify(files) !== JSON.stringify(listed(b))) return false;
  return files.every((path) => readFileSync(join(a, path)).equals(readFileSync(join(b, path))));
}

interface Ran {
  step: Step;
  seconds: number;
  passed: boolean;
}

function main(): number {
  const { values } = parseArgs({ options: { swiftshader: { type: 'boolean', default: false } } });
  const dirty = git(['status', '--porcelain']);
  if (dirty) {
    console.error('gate: the tree has uncommitted changes; commit or stash them first:\n' + dirty);
    return 1;
  }
  const tree = git(['rev-parse', 'HEAD^{tree}']);
  const base = mergeBase();
  const changed = git(['diff', '--name-only', base, 'HEAD']).split('\n').filter(Boolean);
  const plan = planGate(changed, values.swiftshader);
  console.log(`gate: ${changed.length} paths changed since ${base.slice(0, 12)}`);
  const ran: Ran[] = [];
  const skipped: string[] = [];
  for (const step of plan.steps) {
    const e2e = step === 'e2e' || step === 'e2e:gpu';
    if (e2e && ran.some((r) => !r.passed)) {
      skipped.push(`${step}: an earlier step failed`);
      continue;
    }
    if (e2e && plan.e2eUnlessFixtureSame && fixtureSameAsBase(base)) {
      skipped.push(`${step}: the fixture and its release are the same as the base's`);
      continue;
    }
    console.log(`\ngate: ${step}`);
    const started = performance.now();
    const passed = COMMANDS[step].every(([cwd, [command = '', ...args]]) => {
      return spawnSync(command, args, { cwd: join(REPO, cwd), stdio: 'inherit' }).status === 0;
    });
    ran.push({ step, seconds: Math.round((performance.now() - started) / 100) / 10, passed });
  }
  for (const reason of skipped) console.log(`gate: skipped ${reason}`);
  for (const { step, seconds, passed } of ran) {
    console.log(`gate: ${passed ? 'passed' : 'FAILED'} ${step} in ${seconds} s`);
  }
  if (ran.some((r) => !r.passed)) {
    console.log('gate: failed; no record written');
    return 1;
  }
  if (git(['status', '--porcelain']) || git(['rev-parse', 'HEAD^{tree}']) !== tree) {
    console.log('gate: the tree changed while the gate ran; no record written');
    return 1;
  }
  const record = join(REPO, 'build', 'gate', tree);
  mkdirSync(join(REPO, 'build', 'gate'), { recursive: true });
  const head = git(['rev-parse', 'HEAD']);
  const when = new Date().toISOString();
  writeFileSync(record, JSON.stringify({ tree, head, base, when, ran, skipped }, null, 2) + '\n');
  console.log(`gate: passed; recorded ${relative(REPO, record)}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
