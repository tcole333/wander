import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STALE_FIXTURE, assertFixtureFresh } from './fixture';
import { treeSha } from './stamp';

const PATHS = ['pipeline/src', 'pipeline/uv.lock', 'shared/constants.json', 'pipeline/tests/data'];

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

let repo: string;

function write(path: string, text: string): void {
  mkdirSync(join(repo, path, '..'), { recursive: true });
  writeFileSync(join(repo, path), text);
}

function writeStamp(inputs: string): void {
  write('build/stages/fixture/stamp.json', JSON.stringify({ inputs, paths: PATHS }));
  mkdirSync(join(repo, 'build', 'fixture'), { recursive: true });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'wander-stamp-'));
  write('pipeline/src/prebuild/cube.py', 'TILE = 256\n');
  write('pipeline/uv.lock', 'version = 1\n');
  write('shared/constants.json', '{}\n');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('the tree hash', () => {
  it('hashes sorted "<path> <sha256>" lines, as hashing.py does', () => {
    const lines = [
      `pipeline/src/prebuild/cube.py ${sha('TILE = 256\n')}\n`,
      `pipeline/uv.lock ${sha('version = 1\n')}\n`,
      `shared/constants.json ${sha('{}\n')}\n`,
    ];
    expect(treeSha(PATHS, repo)).toBe(sha(lines.join('')));
  });

  it('ignores caches, Finder files and symlinks', () => {
    const before = treeSha(PATHS, repo);
    write('pipeline/src/prebuild/__pycache__/cube.cpython-314.pyc', '\0');
    write('pipeline/src/.DS_Store', '\0');
    symlinkSync(join(repo, 'pipeline/uv.lock'), join(repo, 'pipeline/src/link.py'));
    expect(treeSha(PATHS, repo)).toBe(before);
  });

  it('changes when a file changes', () => {
    const before = treeSha(PATHS, repo);
    write('pipeline/src/prebuild/cube.py', 'TILE = 128\n');
    expect(treeSha(PATHS, repo)).not.toBe(before);
  });
});

describe('the fixture check', () => {
  it('passes a fresh fixture', () => {
    writeStamp(treeSha(PATHS, repo));
    expect(() => assertFixtureFresh(repo)).not.toThrow();
  });

  it('fails a missing fixture, naming the command', () => {
    expect(() => assertFixtureFresh(repo)).toThrow(STALE_FIXTURE);
  });

  it('fails a stale fixture, naming the command', () => {
    writeStamp(treeSha(PATHS, repo));
    write('pipeline/src/prebuild/cube.py', 'TILE = 128\n');
    expect(() => assertFixtureFresh(repo)).toThrow(STALE_FIXTURE);
  });

  it('fails when the output root is gone', () => {
    writeStamp(treeSha(PATHS, repo));
    rmSync(join(repo, 'build', 'fixture'), { recursive: true });
    expect(() => assertFixtureFresh(repo)).toThrow(STALE_FIXTURE);
  });
});
