import { expect, test } from 'vitest';
import type { EventsRelease } from '../data/release';
import { readFixtureFile, readStageRecord } from '../test/fixture';
import { viewOf } from '../test/events';
import { EventRuntime } from './runtime';

const query = { t0: 1, t1: 10, tier: 'lite' as const, view: viewOf() };

test('the real handler decodes the fixture and returns queries with generation and residency', async () => {
  const release = readStageRecord<EventsRelease>('event-files');
  const runtime = new EventRuntime();
  const init = await runtime.handle({ type: 'init', release, tier: 'lite' });
  expect(init.type).toBe('state');
  const f = release.files.find((f) => f.key === release.overview)!;
  const loaded = await runtime.handle({
    type: 'load',
    key: f.key,
    buf: readFixtureFile(f.key).buffer,
  });
  expect(loaded).toMatchObject({
    type: 'state',
    loaded: f.key,
    plan: { bytes: f.decoded, complete: true },
  });
  const reply = await runtime.handle({
    type: 'query',
    generation: 7,
    query: { ...query, t0: 600000, t1: 800000 },
    now: 0,
  });
  expect(reply).toMatchObject({ type: 'result', generation: 7, plan: { complete: true } });
  if (reply.type === 'result') expect(reply.result.markers.length).toBeGreaterThan(0);
  const bad = await runtime.handle({ type: 'load', key: f.key, buf: new ArrayBuffer(1) });
  expect(bad).toMatchObject({ type: 'error', key: f.key });
});

test('a query can use current residency while another page awaits inflation', async () => {
  const release = readStageRecord<EventsRelease>('event-files');
  const runtime = new EventRuntime();
  await runtime.handle({ type: 'init', release, tier: 'lite' });
  const loading = runtime.handle({
    type: 'load',
    key: release.overview,
    buf: readFixtureFile(release.overview).buffer,
  });
  const early = await runtime.handle({ type: 'query', generation: 1, query, now: 0 });
  expect(early).toMatchObject({ type: 'result', plan: { complete: false } });
  expect(await loading).toMatchObject({ type: 'state', plan: { complete: true } });
});

test('the handler describes rows, naming those it cannot find', async () => {
  const release = readStageRecord<EventsRelease>('event-files');
  const runtime = new EventRuntime();
  await runtime.handle({ type: 'init', release, tier: 'full' });
  for (const f of release.files)
    await runtime.handle({ type: 'load', key: f.key, buf: readFixtureFile(f.key).buffer });
  const described = await runtime.handle({ type: 'describe', rows: [0, 2 ** 31 - 1] });
  expect(described).toMatchObject({ type: 'described', missing: [2 ** 31 - 1] });
  if (described.type === 'described')
    expect(described.events).toEqual([expect.objectContaining({ row: 0, qid: 78994 })]);
});

test('a failed description names its request and leaves the worker running', async () => {
  const runtime = new EventRuntime();
  const early = await runtime.handle({ type: 'describe', rows: [1] });
  expect(early).toMatchObject({ type: 'error', request: 'describe' });
  const release = readStageRecord<EventsRelease>('event-files');
  await runtime.handle({ type: 'init', release, tier: 'lite' });
  expect(await runtime.handle({ type: 'query', generation: 10, query, now: 0 })).toMatchObject({
    type: 'result',
    generation: 10,
  });
});
