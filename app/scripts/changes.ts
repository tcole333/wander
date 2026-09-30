// What a branch changes against origin/main, for npm run check and npm run gate: the merge base,
// the paths changed since it, and which of them no test reads.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** The checkout's root, with a trailing slash. */
export const REPO = fileURLToPath(new URL('../../', import.meta.url));

export function git(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
}

/** Where this branch left origin/main. */
export function mergeBase(): string {
  return git(['merge-base', 'HEAD', 'origin/main']);
}

/** Repo-relative paths changed since `base`: committed, staged, unstaged and untracked alike. */
export function changedSince(base: string): string[] {
  const tracked = git(['diff', '--name-only', base]).split('\n');
  const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n');
  return [...new Set([...tracked, ...untracked].filter(Boolean))].sort();
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
