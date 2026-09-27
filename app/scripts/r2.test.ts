// The R2 credentials file (r2.ts): a mistake in it is named by file and key, before any request.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { R2Error, readR2Env } from './r2';

const folder = mkdtempSync(join(tmpdir(), 'wander-r2-'));

afterAll(() => rmSync(folder, { recursive: true, force: true }));

test('an endpoint without https:// is refused, naming the key but never its value', () => {
  const path = join(folder, 'r2.env');
  const keys = 'R2_ACCESS_KEY_ID=id\nR2_SECRET_ACCESS_KEY=secret\n';
  writeFileSync(path, `${keys}R2_ENDPOINT=acct123.r2.cloudflarestorage.com\n`);
  expect(() => readR2Env(path)).toThrow(new R2Error(`${path}: R2_ENDPOINT is not an https:// URL`));
});
