// CI runs the browser tests as parallel jobs, one per shard in E2E_SHARDS, so the slowest shard
// sets how long CI takes. Each named shard runs the specs it lists, grouped by their times on CI;
// 'rest' runs every spec no shard names, so a new spec lands there. WANDER_E2E_SHARD picks one;
// unset, as in every local run, every spec runs. ci.yml lists the shards again in its e2e matrix,
// its outputs and the Tested build job, and scripts/ciShards.test.ts holds each list to this one.
import type { Project } from '@playwright/test';

const NAMED_SHARDS = new Map<string, string[]>([
  ['magellan', ['story-selection.spec.ts']],
  ['lobby', ['lobby-round-trip.spec.ts', 'globe-mesh.spec.ts']],
  ['explore', ['explore-entry.spec.ts', 'marks.spec.ts']],
  ['ruler', ['explore-ruler.spec.ts']],
  ['touch', ['explore-ruler-touch.spec.ts']],
  ['borders', ['borders.spec.ts', 'explore-borders.spec.ts']],
  ['memory', ['catalog-round-trips.spec.ts']],
]);

export const E2E_SHARDS = [...NAMED_SHARDS.keys(), 'rest'];

export function shardSpecs(shard: string | undefined): Pick<Project, 'testMatch' | 'testIgnore'> {
  if (!shard) return {};
  if (shard === 'rest') return { testIgnore: [...NAMED_SHARDS.values()].flat() };
  const specs = NAMED_SHARDS.get(shard);
  if (!specs) {
    throw new Error(
      `WANDER_E2E_SHARD=${shard} names no shard; the shards are ${E2E_SHARDS.join(', ')}.`,
    );
  }
  return { testMatch: specs };
}
