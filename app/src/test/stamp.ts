// The tree hash of pipeline/src/prebuild/hashing.py's tree_sha: SHA-256 over one line
// "<path> <sha256>\n" per regular file under the given repo paths, sorted bytewise. Missing
// paths, symlinks, __pycache__ and .DS_Store are left out.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, type Stats } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

const SKIPPED_NAMES = new Set(['__pycache__', '.DS_Store']);

export function treeSha(paths: readonly string[], root: string): string {
  const digests = new Map<string, string>();
  for (const path of paths) collect(join(root, path), root, digests);
  const lines = [...digests].map(([path, digest]) => Buffer.from(`${path} ${digest}\n`));
  lines.sort((a, b) => Buffer.compare(a, b));
  return createHash('sha256').update(Buffer.concat(lines)).digest('hex');
}

function collect(path: string, root: string, digests: Map<string, string>): void {
  if (SKIPPED_NAMES.has(basename(path))) return;
  const stats = statOrNull(path);
  if (!stats || stats.isSymbolicLink()) return;
  if (stats.isFile()) {
    const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
    digests.set(relative(root, path).split(sep).join('/'), digest);
  } else if (stats.isDirectory()) {
    for (const name of readdirSync(path)) collect(join(path, name), root, digests);
  }
}

function statOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
