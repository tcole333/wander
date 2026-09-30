// What a branch changes against origin/main, for npm run check and npm run gate: the merge base,
// the paths changed since it, and which of them no test reads.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** The checkout's root, with a trailing slash. */
export const REPO = fileURLToPath(new URL('../../', import.meta.url));

export function git(args: string[], cwd = REPO): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** Where this branch left origin/main. */
export function mergeBase(): string {
  return git(['merge-base', 'HEAD', 'origin/main']);
}

/**
 * Repo-relative paths that differ between `base` and `head`, or the working tree when there is no
 * `head`. A move counts at both its ends, so moving a file out of app/ into docs/ still counts as
 * an app change.
 */
export function diffPaths(base: string, head?: string, cwd = REPO): string[] {
  const args = ['diff', '--name-only', '--no-renames', base, ...(head ? [head] : [])];
  return git(args, cwd).split('\n').filter(Boolean);
}

/** Repo-relative paths changed since `base`: committed, staged, unstaged and untracked alike. */
export function changedSince(base: string, cwd = REPO): string[] {
  const untracked = git(['ls-files', '--others', '--exclude-standard'], cwd).split('\n');
  return [...new Set([...diffPaths(base, undefined, cwd), ...untracked].filter(Boolean))].sort();
}

/**
 * A path no test, build or page reads: the docs, root Markdown and the license. Vitest and pytest
 * read docs/design/streaming.md, so it is not one. .githooks/pre-push says the same in shell.
 */
export function inert(path: string): boolean {
  if (path === 'docs/design/streaming.md') return false;
  return path.startsWith('docs/') || /^[^/]+\.md$/.test(path) || path === 'LICENSE';
}

/** Whether `path` lies under any of `folders`, each given with its trailing slash. */
export function under(path: string, folders: readonly string[]): boolean {
  return folders.some((folder) => path.startsWith(folder));
}
