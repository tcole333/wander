// npm run check's selection: which checks a set of changed paths calls for.
import { describe, expect, test } from 'vitest';
import { planChecks, type CheckPlan } from './check.ts';

const NONE: CheckPlan = {
  prettier: [],
  eslint: [],
  typecheck: false,
  vitest: false,
  ruff: [],
  pytest: [],
};
const EXISTING = new Set([
  'app/src/globe/cube.ts',
  'app/index.html',
  'pipeline/src/prebuild/surface.py',
  'pipeline/src/prebuild/paths.py',
  'pipeline/tests/test_surface.py',
  'pipeline/tests/test_cli.py',
  'pipeline/tests/test_constants.py',
]);
const plan = (...changed: string[]) => planChecks(changed, (path) => EXISTING.has(path));

describe('npm run check', () => {
  test('lints, typechecks and runs affected Vitest tests for an app file', () => {
    expect(plan('app/src/globe/cube.ts')).toEqual({
      ...NONE,
      prettier: ['src/globe/cube.ts'],
      eslint: ['src/globe/cube.ts'],
      typecheck: true,
      vitest: 'changed',
    });
  });

  test('checks the formatting of an app file ESLint does not read', () => {
    expect(plan('app/index.html')).toMatchObject({ prettier: ['index.html'], eslint: [] });
  });

  test('leaves a deleted file to the checks that import it', () => {
    expect(plan('app/src/globe/gone.ts')).toEqual({
      ...NONE,
      typecheck: true,
      vitest: 'changed',
    });
  });

  test('runs a pipeline module’s own tests in one process, and all of Vitest over the fixture', () => {
    expect(plan('pipeline/src/prebuild/surface.py')).toEqual({
      ...NONE,
      vitest: 'all',
      ruff: ['src/prebuild/surface.py'],
      pytest: ['tests/test_surface.py'],
    });
  });

  test('runs no pytest for a module without a test file of its own', () => {
    expect(plan('pipeline/src/prebuild/paths.py').pytest).toEqual([]);
  });

  test('runs a changed Python test alone, without Vitest', () => {
    expect(plan('pipeline/tests/test_cli.py')).toEqual({
      ...NONE,
      ruff: ['tests/test_cli.py'],
      pytest: ['tests/test_cli.py'],
    });
  });

  test('runs all of pytest, and no Vitest, for pytest’s conftest', () => {
    expect(plan('pipeline/tests/conftest.py')).toEqual({ ...NONE, pytest: 'all' });
  });

  test.each([
    'pipeline/uv.lock',
    'pipeline/sources.toml',
    'pipeline/config/fixture.yaml',
    'pipeline/tests/data/media/quadrants.jpg',
    'shared/constants.json',
    'stories/tambora/story.md',
    'explore/openings.lock.json',
  ])('runs all of pytest and Vitest for %s, which tests read from disk', (path) => {
    expect(plan(path)).toMatchObject({ pytest: 'all', vitest: 'all' });
  });

  test.each(['app/package.json', 'app/vite.config.ts', 'app/credits.html'])(
    'runs all of Vitest for %s, which no test imports',
    (path) => {
      expect(plan(path).vitest).toBe('all');
    },
  );

  test('runs the design doc’s readers and nothing for other docs', () => {
    expect(plan('docs/design/streaming.md')).toEqual({
      ...NONE,
      vitest: 'all',
      pytest: ['tests/test_constants.py'],
    });
    expect(plan('docs/PRD.md', 'CLAUDE.md', 'LICENSE')).toEqual(NONE);
  });
});
