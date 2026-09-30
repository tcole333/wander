import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parse } from 'yaml';
import { E2E_SHARDS } from '../e2e/shards';

// CI names the e2e shards in three places a shard added to e2e/shards.ts alone would miss: its
// specs would leave 'rest' and run in no CI job, with every check green.
interface Workflow {
  jobs: {
    e2e: { strategy: { matrix: { shard: string[] } }; outputs: Record<string, string> };
    'tested-build': { steps: { env?: Record<string, string> }[] };
  };
}

const ci = parse(
  readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'),
) as Workflow;
const shards = E2E_SHARDS.toSorted();

it('runs an e2e job for every shard', () => {
  expect(ci.jobs.e2e.strategy.matrix.shard.toSorted()).toEqual(shards);
});

it("keeps an output for every shard's tested build", () => {
  expect(Object.keys(ci.jobs.e2e.outputs).toSorted()).toEqual(shards);
});

it("checks that every shard tested the checks job's build", () => {
  const listed = ci.jobs['tested-build'].steps.flatMap((step) => step.env?.SHARDS ?? []);
  expect(listed.flatMap((list) => list.split(' ')).toSorted()).toEqual(shards);
});
