import { describe, expect, test, vi } from 'vitest';
import { DESCRIPTION_ROWS, EventClient, type EventWorker } from './client';
import type { EventDescription } from './describe';
import { type EventReply, type EventRequest } from './runtime';
import { pageOf, releaseOf, viewOf } from '../test/events';

class FakeWorker implements EventWorker {
  onmessage: EventWorker['onmessage'] = null;
  onerror: EventWorker['onerror'] = null;
  sent: EventRequest[] = [];
  transfers: Transferable[][] = [];
  terminate = vi.fn();
  postMessage(message: EventRequest, transfer: Transferable[]) {
    this.sent.push(message);
    this.transfers.push(transfer);
  }
  reply(reply: EventReply) {
    this.onmessage?.({ data: reply } as MessageEvent<EventReply>);
  }
}
const query = { t0: 1, t1: 10, tier: 'lite' as const, view: viewOf() };
const result = { markers: [], labels: [], outlines: [], missingFocal: [] };
const plan = { needs: [], resident: [], bytes: 0, complete: true };

test('messages only enter a ready queue, and a reply becomes visible on drain', () => {
  const worker = new FakeWorker();
  const client = new EventClient(worker, releaseOf([pageOf([])]), 'https://example.invalid');
  const wake = vi.fn();
  client.onready = wake;
  client.query(query);
  const generation = 1;
  client.drain(0);
  worker.reply({ type: 'result', generation, result, plan });
  expect(wake).toHaveBeenCalled();
  expect(client.drain(10)).toEqual([{ type: 'result', generation, result, plan }]);
  expect(client.drain(20)).toEqual([]);
  client.dispose();
});

test('older or duplicate replies cannot replace a delivered result or clear a newer query', () => {
  const worker = new FakeWorker();
  const client = new EventClient(worker, releaseOf([pageOf([])]), 'https://example.invalid');
  client.query(query);
  client.drain(0);
  worker.reply({ type: 'result', generation: 1, result, plan });
  expect(client.drain(10)).toHaveLength(1);
  client.query({ ...query, t1: 20 });
  client.drain(40);
  worker.reply({ type: 'result', generation: 1, result, plan });
  client.query({ ...query, t1: 30 });
  expect(client.drain(80)).toEqual([]);
  expect(worker.sent.filter((r) => r.type === 'query')).toHaveLength(2);
  worker.reply({ type: 'result', generation: 2, result, plan });
  expect(client.drain(100)).toEqual([{ type: 'result', generation: 2, result, plan }]);
  expect(worker.sent.at(-1)).toMatchObject({ type: 'query', generation: 3, query: { t1: 30 } });
  client.dispose();
});

test.each([0, 98765.4321])(
  'continuous 60 Hz queries deliver one-frame replies (offset %s)',
  (offset) => {
    vi.useFakeTimers();
    const sent: Extract<EventRequest, { type: 'query' }>[] = [];
    let pending: EventReply | undefined;
    const worker: EventWorker = {
      onmessage: null,
      onerror: null,
      terminate() {},
      postMessage(message) {
        if (message.type !== 'query') return;
        expect(pending).toBeUndefined();
        sent.push(message);
        pending = {
          type: 'result',
          generation: message.generation,
          result: { markers: [], labels: [], outlines: [], missingFocal: [] },
          plan: { needs: [], resident: [], bytes: 0, complete: true },
        };
      },
    };
    const client = new EventClient(worker, releaseOf([pageOf([])]), 'https://example.invalid');
    const delivered: number[] = [];
    try {
      for (let frame = 0; frame < 120; frame++) {
        if (pending) {
          worker.onmessage?.({ data: pending } as MessageEvent<EventReply>);
          pending = undefined;
        }
        client.query({ t0: 0, t1: frame, tier: 'lite', view: viewOf() });
        for (const reply of client.drain(offset + frame * (1000 / 60))) {
          if (reply.type === 'result') delivered.push(reply.generation);
        }
      }
      expect(delivered).toHaveLength(60);
      expect(sent).toHaveLength(60);
      expect(delivered).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
      expect(sent.map((q) => q.query.t1)).toEqual(Array.from({ length: 60 }, (_, i) => i * 2));
    } finally {
      client.dispose();
      vi.useRealTimers();
    }
  },
);

test('main thread fetches the overview first, transfers its buffer, then loads the rest', async () => {
  const worker = new FakeWorker();
  const release = releaseOf([pageOf([{ row: 0 }]), pageOf([{ row: 1 }])]);
  const fetched: string[] = [];
  const bytes = new ArrayBuffer(10);
  const client = new EventClient(worker, release, 'https://example.invalid', {
    fetchBytes: (url) => {
      fetched.push(url);
      return Promise.resolve(bytes);
    },
  });
  try {
    worker.reply({
      type: 'state',
      plan: { ...plan, complete: false, needs: release.files.map((f) => f.key) },
      classes: [],
    });
    client.drain(0);
    await Promise.resolve();
    expect(fetched).toEqual([`https://example.invalid/${release.overview}`]);
    expect(worker.sent.filter((m) => m.type === 'load')).toEqual([]);
    client.drain(1);
    expect(worker.sent.at(-1)).toEqual({ type: 'load', key: release.overview, buf: bytes });
    expect(worker.transfers.at(-1)).toEqual([bytes]);
    worker.reply({
      type: 'state',
      loaded: release.overview,
      classes: ['battle'],
      plan: { ...plan, needs: [release.files[1]!.key], resident: [release.overview] },
    });
    client.drain(2);
    await Promise.resolve();
    expect(fetched).toHaveLength(2);
  } finally {
    client.dispose();
  }
});

test('fetch and worker errors surface through drain; disposal drops late arrivals', async () => {
  const worker = new FakeWorker();
  const release = releaseOf([pageOf([{ row: 0 }])]);
  const client = new EventClient(worker, release, 'https://example.invalid', {
    fetchBytes: () => Promise.reject(new Error('offline')),
  });
  worker.reply({ type: 'state', plan: { ...plan, needs: [release.overview] }, classes: [] });
  client.drain(0);
  await Promise.resolve();
  expect(client.drain(1)).toEqual([
    { type: 'error', key: release.overview, message: 'Error: offline' },
  ]);
  worker.onerror?.({ message: 'worker stopped' } as ErrorEvent);
  expect(client.drain(2)).toEqual([{ type: 'error', message: 'worker stopped' }]);
  expect(worker.terminate).toHaveBeenCalled();
  client.dispose();
  expect(worker.onmessage).toBeNull();
  expect(client.drain(10)).toEqual([]);
});

const host = 'https://example.invalid';
const sentOf = <T extends EventRequest['type']>(worker: FakeWorker, type: T) =>
  worker.sent.filter((m): m is Extract<EventRequest, { type: T }> => m.type === type);
const described = (row: number): EventDescription => ({
  row,
  qid: row + 1,
  label: `Event ${row}`,
  t0: 1,
  t1: 1,
  prec: 11,
});

describe('descriptions', () => {
  test('are asked in one batch, one request at a time, then answered from the cache', () => {
    const worker = new FakeWorker();
    const client = new EventClient(worker, releaseOf([pageOf([])]), host);
    const wake = vi.fn();
    client.onready = wake;
    expect(client.description(5)).toBeUndefined();
    expect(client.description(6)).toBeUndefined();
    expect(client.description(5)).toBeUndefined();
    expect(wake).toHaveBeenCalledTimes(2);
    client.drain(0);
    expect(client.description(7)).toBeUndefined();
    client.drain(10);
    expect(sentOf(worker, 'describe')).toEqual([{ type: 'describe', rows: [5, 6] }]);
    const reply: EventReply = { type: 'described', events: [described(5)], missing: [6] };
    worker.reply(reply);
    expect(client.drain(20)).toEqual([reply]);
    expect(sentOf(worker, 'describe').at(-1)).toEqual({ type: 'describe', rows: [7] });
    expect(client.description(5)).toEqual(described(5));
    client.dispose();
  });

  test('a row no resident page holds is asked again only after a page loads', () => {
    const worker = new FakeWorker();
    const release = releaseOf([pageOf([])]);
    const client = new EventClient(worker, release, host);
    client.description(6);
    client.drain(0);
    worker.reply({ type: 'described', events: [], missing: [6] });
    client.drain(10);
    client.description(6);
    client.drain(20);
    expect(sentOf(worker, 'describe')).toHaveLength(1);
    worker.reply({ type: 'state', loaded: release.overview, classes: [], plan });
    client.drain(30);
    client.description(6);
    client.drain(40);
    expect(sentOf(worker, 'describe')).toEqual([
      { type: 'describe', rows: [6] },
      { type: 'describe', rows: [6] },
    ]);
    client.dispose();
  });

  test(`the cache keeps the ${DESCRIPTION_ROWS} most recently used rows`, () => {
    const worker = new FakeWorker();
    const client = new EventClient(worker, releaseOf([pageOf([])]), host);
    const rows = Array.from({ length: DESCRIPTION_ROWS }, (_, row) => row);
    worker.reply({ type: 'described', events: rows.map(described), missing: [] });
    client.drain(0);
    expect(client.description(0)).toEqual(described(0));
    worker.reply({ type: 'described', events: [described(DESCRIPTION_ROWS)], missing: [] });
    client.drain(10);
    expect(client.description(0)).toEqual(described(0));
    expect(client.description(DESCRIPTION_ROWS)).toEqual(described(DESCRIPTION_ROWS));
    expect(client.description(1)).toBeUndefined();
    client.dispose();
    expect(client.description(0)).toBeUndefined();
  });
});

test('a failed description frees its slot and leaves the worker running', () => {
  const worker = new FakeWorker();
  const client = new EventClient(worker, releaseOf([pageOf([])]), host);
  client.description(5);
  client.drain(0);
  const failure: EventReply = { type: 'error', message: 'bad', request: 'describe' };
  worker.reply(failure);
  expect(client.drain(10)).toEqual([failure]);
  expect(worker.terminate).not.toHaveBeenCalled();
  client.description(5);
  client.drain(20);
  expect(sentOf(worker, 'describe')).toHaveLength(2);
  client.dispose();
});
