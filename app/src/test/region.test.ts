import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CODE_PATHS } from './bakeInputs';
import {
  StaleRegionBake,
  readBake,
  readRegionBake,
  type BakeProfile,
  type StageInputs,
} from './region';
import { treeSha } from './stamp';

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
function currentInputs(profile: BakeProfile = 'region'): StageInputs {
  return {
    gebco: GEBCO_SHA,
    ne: { land: LAND_SHA },
    configs: Object.fromEntries(
      ['l7.yaml', 'water.yaml', ...(profile === 'region' ? ['regions-milestone1.yaml'] : [])].map(
        (name) => [
          name,
          createHash('sha256')
            .update(readFileSync(join(repo, 'pipeline', 'config', name)))
            .digest('hex'),
        ],
      ),
    ),
    code: treeSha(CODE_PATHS, repo),
  };
}

function writeRecords(
  coverage: StageInputs,
  surface: StageInputs | undefined,
  profile: BakeProfile = 'region',
): void {
  const common = { avail: AVAIL };
  write(
    `build/stages/${profile}/coverage.json`,
    JSON.stringify({ ...common, qLand: [], c200: [], counts: [], inputs: coverage }),
  );
  write(
    `build/stages/${profile}/surface.json`,
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
  for (const name of ['l7.yaml', 'water.yaml', 'regions-milestone1.yaml']) {
    write(`pipeline/config/${name}`, `${name}\n`);
  }
  write('pipeline/sources.toml', `sha256 = "${GEBCO_SHA}"\nsha256 = "${LAND_SHA}"\n`);
  mkdirSync(join(repo, 'build', 'region', 'surf', VER), { recursive: true });
  mkdirSync(join(repo, 'build', 'out', 'surf', VER), { recursive: true });
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

it('keeps the lab reader on the region profile', () => {
  writeRecords(currentInputs(), currentInputs());
  expect(readRegionBake(repo).profile).toBe('region');
});

describe.each(['region', 'global'] as const)('the %s bake check', (profile) => {
  const read = () => readBake(profile, repo);
  const inputs = () => currentInputs(profile);
  const records = (coverage: StageInputs, surface: StageInputs | undefined) =>
    writeRecords(coverage, surface, profile);

  it('reads a bake built from the working tree', () => {
    records(inputs(), inputs());
    expect(read().layer).toBe(
      join(repo, 'build', profile === 'global' ? 'out' : 'region', 'surf', VER),
    );
  });

  it.each([
    'pipeline/src/prebuild/surface.py',
    'pipeline/config/water.yaml',
    'pipeline/config/l7.yaml',
    'shared/constants.json',
    'pipeline/uv.lock',
    'pipeline/pyproject.toml',
  ])('fails changed surface input %s', (path) => {
    records(inputs(), inputs());
    write(path, 'changed\n');
    expect(read).toThrow(StaleRegionBake);
  });

  it('fails a surface layer older than a coverage rerun on changed code', () => {
    const before = inputs();
    write('pipeline/src/prebuild/surface.py', 'STAGE = "surf"\n');
    records(inputs(), before);
    expect(read).toThrow(StaleRegionBake);
  });

  it('fails a surface record that does not name its inputs', () => {
    records(inputs(), undefined);
    expect(read).toThrow(StaleRegionBake);
  });

  it('fails configs that do not match this profile even when the code hash matches', () => {
    const wrong = {
      ...inputs(),
      configs: currentInputs(profile === 'global' ? 'region' : 'global').configs,
    };
    records(wrong, wrong);
    expect(read).toThrow('surface configs');
  });

  it.each(['gebco', 'land'])('fails a changed %s pin', (source) => {
    records(inputs(), inputs());
    write('pipeline/sources.toml', `sha256 = "${source === 'gebco' ? LAND_SHA : GEBCO_SHA}"\n`);
    expect(read).toThrow('other sources');
  });

  it('names the selected profile when records are missing', () => {
    expect(read).toThrow(`uv run prebuild --profile ${profile}`);
  });
});
