import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StaleRegionBake, readRegionBake, type StageInputs } from './region';
import { treeSha } from './stamp';

const CODE_PATHS = [
  'pipeline/src',
  'pipeline/config',
  'pipeline/pyproject.toml',
  'pipeline/uv.lock',
  'shared/constants.json',
];
const GEBCO_SHA = 'a'.repeat(64);
const LAND_SHA = 'b'.repeat(64);
const VER = '085efb54';
const AVAIL = '/w==';

let repo: string;

function write(path: string, text: string): void {
  mkdirSync(join(repo, path, '..'), { recursive: true });
  writeFileSync(join(repo, path), text);
}

/** The inputs a bake of the working tree as it stands reads. */
function currentInputs(): StageInputs {
  return {
    gebco: GEBCO_SHA,
    ne: { land: LAND_SHA },
    configs: {},
    code: treeSha(CODE_PATHS, repo),
  };
}

function writeRecords(coverage: StageInputs, surface: StageInputs | undefined): void {
  const common = { avail: AVAIL };
  write(
    'build/stages/region/coverage.json',
    JSON.stringify({ ...common, qLand: [], c200: [], counts: [], inputs: coverage }),
  );
  write(
    'build/stages/region/surface.json',
    JSON.stringify({
      ...common,
      ver: VER,
      maxLevel: 7,
      bounds: `surf/${VER}/bounds.bin`,
      inputs: surface,
    }),
  );
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'wander-region-'));
  write('pipeline/src/prebuild/surface.py', 'STAGE = "surface"\n');
  write('pipeline/sources.toml', `sha256 = "${GEBCO_SHA}"\nsha256 = "${LAND_SHA}"\n`);
  mkdirSync(join(repo, 'build', 'region', 'surf', VER), { recursive: true });
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('the region bake check', () => {
  it('reads a bake built from the working tree', () => {
    writeRecords(currentInputs(), currentInputs());
    expect(readRegionBake(repo).layer).toBe(join(repo, 'build', 'region', 'surf', VER));
  });

  it('fails a bake built from other prebuild code', () => {
    writeRecords(currentInputs(), currentInputs());
    write('pipeline/src/prebuild/surface.py', 'STAGE = "surf"\n');
    expect(() => readRegionBake(repo)).toThrow(StaleRegionBake);
  });

  it('fails a surface layer older than a coverage rerun on changed code', () => {
    const before = currentInputs();
    write('pipeline/src/prebuild/surface.py', 'STAGE = "surf"\n');
    writeRecords(currentInputs(), before);
    expect(() => readRegionBake(repo)).toThrow(StaleRegionBake);
  });

  it('fails a surface record that does not name its inputs', () => {
    writeRecords(currentInputs(), undefined);
    expect(() => readRegionBake(repo)).toThrow(StaleRegionBake);
  });
});
