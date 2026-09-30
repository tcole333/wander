// npm run gate's scope, its tree hash of a commit, and the pre-push hook that checks its records.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, test } from 'vitest';
import { assertFixtureFresh, REPO_ROOT } from '../src/test/fixture';
import { treeSha } from '../src/test/stamp.ts';
import { changedSince, diffPaths } from './changes.ts';
import { planGate, sameFixture, treeShaAt } from './gate.ts';

const HOOK = fileURLToPath(new URL('../../.githooks/pre-push', import.meta.url));
const FULL = ['fixture', 'lint', 'typecheck', 'vitest', 'ruff', 'pytest', 'e2e:gpu'];

describe('the gate’s scope', () => {
  test('runs nothing for docs', () => {
    expect(planGate(['docs/PRD.md', 'CLAUDE.md', 'LICENSE'])).toEqual({
      steps: [],
      e2eUnlessFixtureSame: false,
    });
  });

  test('runs the app’s checks and e2e on the GPU for an app change', () => {
    expect(planGate(['app/src/main.ts'])).toEqual({
      steps: ['fixture', 'lint', 'typecheck', 'vitest', 'e2e:gpu'],
      e2eUnlessFixtureSame: false,
    });
  });

  test('adds SwiftShader when asked', () => {
    expect(planGate(['app/src/main.ts'], true).steps.slice(-2)).toEqual(['e2e:gpu', 'e2e']);
  });

  test('runs the pipeline’s checks, Vitest and e2e unless the fixture is unchanged', () => {
    expect(planGate(['pipeline/src/prebuild/surface.py'])).toEqual({
      steps: ['fixture', 'vitest', 'ruff', 'pytest', 'e2e:gpu'],
      e2eUnlessFixtureSame: true,
    });
  });

  test.each(['pipeline/tests/data/media/quadrants.jpg', 'stories/tambora/story.md', 'shared/x'])(
    'runs everything, e2e included, for %s, which both sides read',
    (path) => {
      expect(planGate([path])).toEqual({ steps: FULL, e2eUnlessFixtureSame: false });
    },
  );

  test('runs everything for a path no rule names', () => {
    expect(planGate(['.github/workflows/ci.yml'])).toEqual({
      steps: FULL,
      e2eUnlessFixtureSame: false,
    });
  });

  test('runs Vitest and pytest, which read it, for the design doc', () => {
    expect(planGate(['docs/design/streaming.md']).steps).toEqual(['fixture', 'vitest', 'pytest']);
  });
});

function repository(): { root: string; run: (...args: string[]) => string } {
  const root = mkdtempSync(join(tmpdir(), 'wander-gate-'));
  const run = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
  run('init', '-q', '-b', 'main');
  return { root, run };
}

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

describe('a move', () => {
  const moved = () => {
    const { root, run } = repository();
    write(root, 'app/x.ts', 'x');
    write(root, 'docs/a.md', 'a');
    run('add', '-A');
    run('commit', '-q', '-m', 'base');
    const base = run('rev-parse', 'HEAD');
    run('mv', 'app/x.ts', 'docs/x.md');
    return { root, run, base };
  };

  test('counts as a committed change at both its ends', () => {
    const { root, run, base } = moved();
    run('commit', '-q', '-m', 'move');
    expect(diffPaths(base, 'HEAD', root)).toEqual(['app/x.ts', 'docs/x.md']);
  });

  test('counts as a change in the working tree at both its ends', () => {
    const { root, base } = moved();
    expect(changedSince(base, root)).toEqual(['app/x.ts', 'docs/x.md']);
  });
});

test('treeShaAt hashes a commit’s files as the stamp hashes the working tree', () => {
  const { root, run } = repository();
  write(root, 'pipeline/src/a.py', 'a = 1\n');
  write(root, 'pipeline/tests/data/b.bin', 'b');
  write(root, 'stories/c.md', 'c');
  symlinkSync('a.py', join(root, 'pipeline/src/link.py'));
  run('add', '-A');
  run('commit', '-q', '-m', 'files');
  const paths = ['pipeline/src', 'pipeline/tests/data', 'stories', 'missing'];
  expect(treeShaAt(root, 'HEAD', paths)).toBe(treeSha(paths, root));
});

describe('the pre-push hook', () => {
  let root: string;
  let run: (...args: string[]) => string;
  beforeEach(() => {
    ({ root, run } = repository());
    write(root, 'docs/a.md', 'a');
    write(root, 'app/x.ts', 'x');
    run('add', '-A');
    run('commit', '-q', '-m', 'base');
    run('update-ref', 'refs/remotes/origin/main', 'HEAD');
  });

  const commit = (path: string) => {
    write(root, path, 'changed');
    run('add', '-A');
    run('commit', '-q', '-m', path);
    return run('rev-parse', 'HEAD');
  };
  const push = (sha: string) =>
    spawnSync('sh', [HOOK], {
      cwd: root,
      input: `refs/heads/x ${sha} refs/heads/x ${'0'.repeat(40)}\n`,
      encoding: 'utf8',
    });

  test('lets a docs-only commit through', () => {
    expect(push(commit('docs/a.md')).status).toBe(0);
  });

  test.each(['app/x.ts', 'docs/design/streaming.md'])(
    'refuses %s without a gate record',
    (path) => {
      const pushed = push(commit(path));
      expect(pushed.status).toBe(1);
      expect(pushed.stderr).toContain('has not passed npm run gate');
    },
  );

  test('refuses moving an app file into docs/ without a gate record', () => {
    run('mv', 'app/x.ts', 'docs/x.md');
    run('commit', '-q', '-m', 'move');
    expect(push(run('rev-parse', 'HEAD')).status).toBe(1);
  });

  test('lets a commit through once the gate recorded its tree', () => {
    const sha = commit('app/x.ts');
    write(root, `build/gate/${run('rev-parse', `${sha}^{tree}`)}`, '{}');
    expect(push(sha).status).toBe(0);
  });

  test('lets a branch deletion through', () => {
    expect(push('0'.repeat(40)).status).toBe(0);
  });
});

describe('a pipeline change’s fixture against the base’s', () => {
  const fixture = () => {
    assertFixtureFresh();
    const copy = mkdtempSync(join(tmpdir(), 'wander-fixture-'));
    cpSync(join(REPO_ROOT, 'build', 'fixture'), join(copy, 'out'), { recursive: true });
    cpSync(join(REPO_ROOT, 'build', 'stages', 'fixture'), join(copy, 'stages'), {
      recursive: true,
    });
    return { out: join(copy, 'out'), stages: join(copy, 'stages') };
  };

  test('is the same when its files and release are', () => {
    expect(sameFixture(fixture(), fixture())).toBe(true);
  });

  test('differs by one byte of one file', () => {
    const changed = fixture();
    const record = JSON.parse(readFileSync(join(changed.stages, 'surface.json'), 'utf8')) as {
      bounds: string;
    };
    const bounds = join(changed.out, record.bounds);
    const bytes = readFileSync(bounds);
    bytes.writeUInt8(bytes.readUInt8(bytes.length - 1) ^ 1, bytes.length - 1);
    writeFileSync(bounds, bytes);
    expect(sameFixture(fixture(), changed)).toBe(false);
  });

  test('differs by the release its records give', () => {
    const changed = fixture();
    const path = join(changed.stages, 'coverage.json');
    const coverage = JSON.parse(readFileSync(path, 'utf8')) as { qLand: number[] };
    coverage.qLand[0] = (coverage.qLand[0] ?? 0) + 1;
    writeFileSync(path, JSON.stringify(coverage));
    expect(sameFixture(fixture(), changed)).toBe(false);
  });
});
