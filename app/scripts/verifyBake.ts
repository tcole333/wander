// `npm run verify:bake -- [region|global]`; keep the profile out of Vitest's file filters.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [profile = 'region', ...extra] = process.argv.slice(2);
if ((profile !== 'region' && profile !== 'global') || extra.length) {
  console.error('Usage: npm run verify:bake -- [region|global] (default: region)');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)),
    'run',
    '--config',
    'vitest.bake.config.ts',
  ],
  { stdio: 'inherit', env: { ...process.env, WANDER_BAKE_PROFILE: profile } },
);
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
