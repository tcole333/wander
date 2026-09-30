// `npm run verify:bake -- [region|global] [surface|borders]`: every bake check, or one part's;
// keep the profile out of Vitest's file filters.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** The checks of each part of a bake (streaming.md 7.3): the surface tiles and the border steps. */
const PARTS: Record<string, string> = {
  surface: 'src/surface/bake.verify.ts',
  borders: 'src/data/borderSteps.verify.ts',
};

const [profile = 'region', part, ...extra] = process.argv.slice(2);
if (
  (profile !== 'region' && profile !== 'global') ||
  (part !== undefined && !(part in PARTS)) ||
  extra.length
) {
  console.error(
    'Usage: npm run verify:bake -- [region|global] [surface|borders] (default: region, both)',
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)),
    'run',
    '--config',
    'vitest.bake.config.ts',
    ...(part === undefined ? [] : [PARTS[part]!]),
  ],
  { stdio: 'inherit', env: { ...process.env, WANDER_BAKE_PROFILE: profile } },
);
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
