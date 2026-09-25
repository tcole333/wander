// Runs a lab page in a browser Playwright does not drive here: the installed Safari and Firefox,
// opened with `open -a` (macOS). The page posts its report to the dev server (src/lab/labReport.ts),
// and this waits for build/lab/<what>-<browser>.json. Playwright's own WebKit and Firefox builds are
// not the shipping browsers and are not installed.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { promisify } from 'node:util';
import type { LabReport } from '../../src/lab/labReport';
import { DEV_URL } from '../servers';
import { labReportPath } from './reports';

export interface ExternalBrowser {
  name: 'safari' | 'firefox';
  /** The application `open -a` launches. */
  app: string;
  /** The renderer WebGL reports there; both browsers mask the real GPU name. */
  renderer: RegExp;
}

export const EXTERNAL_BROWSERS: ExternalBrowser[] = [
  { name: 'safari', app: 'Safari', renderer: /^Apple GPU$/ },
  { name: 'firefox', app: 'Firefox', renderer: /^Apple M\d/ },
];

const POLL_MS = 250;

/**
 * Opens `page` (a path on the dev server, such as `e2e/gpu-pool.html`) in `browser` and resolves
 * with the report it posts as `what`. Throws with the page's error if it posted one.
 */
export async function runInBrowser<T>(
  browser: ExternalBrowser,
  page: string,
  what: string,
  timeoutMs: number,
  query: Record<string, string> = {},
): Promise<T> {
  if (process.platform !== 'darwin') throw new Error('lab runs in external browsers need macOS');
  const params = new URLSearchParams({ ...query, report: browser.name });
  const url = `${DEV_URL}/${page}?${params}`;
  const file = labReportPath(`${what}-${browser.name}`);
  rmSync(file, { force: true });
  await promisify(execFile)('open', ['-a', browser.app, url]);
  return waitForReport<T>(file, `${browser.app} at ${url}`, timeoutMs);
}

/** Resolves with the report in `file` once the page has posted it. */
export async function waitForReport<T>(file: string, source: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(file)) {
    if (Date.now() > deadline) throw new Error(`no report from ${source} after ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  const posted = JSON.parse(readFileSync(file, 'utf8')) as LabReport<T>;
  if (posted.error !== undefined) throw new Error(`${source} failed: ${posted.error}`);
  if (posted.report === undefined) throw new Error(`${source} posted no report`);
  return posted.report;
}
