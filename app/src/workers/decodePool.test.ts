// The decode pool's routing, ready queue and generations, with stand-in workers that answer when
// the test says. e2e/decode.spec.ts runs it with real workers on real tiles.
import { describe, expect, test } from 'vitest';
import type { DecodeReply, DecodeRequest } from '../surface/decodeProtocol';
import type { DecodedWst } from '../surface/wst';
import { DecodePool, type DecodeWorker } from './decodePool';

class StandIn implements DecodeWorker {
  onmessage: ((event: MessageEvent<DecodeReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  received: { message: DecodeRequest; transfer: Transferable[] }[] = [];
  terminated = false;

  postMessage(message: DecodeRequest, transfer: Transferable[]): void {
    this.received.push({ message, transfer });
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Answers the nth request it received. */
  answer(n: number, reply: 'decoded' | 'error' = 'decoded'): void {
    const request = this.received[n]?.message;
    if (!request) throw new Error(`no request ${n}`);
    const data: DecodeReply =
      reply === 'decoded'
        ? { type: 'decoded', id: request.id, tile: { header: {} } as DecodedWst, ms: 3 }
        : { type: 'error', id: request.id, message: 'not a tile' };
    this.onmessage?.({ data } as MessageEvent<DecodeReply>);
  }

  crash(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

function pool(size = 2): { pool: DecodePool; workers: StandIn[] } {
  const workers = Array.from({ length: size }, () => new StandIn());
  return { pool: new DecodePool(workers), workers };
}

const bytes = () => new ArrayBuffer(8);

describe('submit', () => {
  test('transfers the bytes with the request', () => {
    const { pool: decode, workers } = pool(1);
    const buf = bytes();
    decode.submit('7/1/103/50', buf);
    expect(workers[0]?.received[0]).toEqual({
      message: { type: 'decode', id: 1, key: '7/1/103/50', buf },
      transfer: [buf],
    });
  });

  test('sends each request to the worker with the fewest outstanding', () => {
    const { pool: decode, workers } = pool(2);
    const [a, b] = workers as [StandIn, StandIn];
    decode.submit('0/0/0/0', bytes());
    decode.submit('0/1/0/0', bytes());
    decode.submit('0/2/0/0', bytes());
    expect([a.received.length, b.received.length]).toEqual([2, 1]);
    a.answer(0);
    a.answer(1);
    decode.submit('0/3/0/0', bytes());
    expect([a.received.length, b.received.length]).toEqual([3, 1]);
  });
});

describe('drain', () => {
  test('holds nothing until a worker answers', () => {
    const { pool: decode } = pool();
    decode.submit('0/0/0/0', bytes());
    expect(decode.drain()).toEqual([]);
    expect(decode.pending).toBe(1);
  });

  test('gives each answer once, under the key it was submitted with', () => {
    const { pool: decode, workers } = pool(1);
    decode.submit('0/0/0/0', bytes());
    decode.submit('0/1/0/0', bytes());
    workers[0]?.answer(1);
    workers[0]?.answer(0, 'error');
    expect(decode.drain()).toEqual([
      { key: '0/1/0/0', tile: { header: {} }, ms: 3 },
      { key: '0/0/0/0', error: 'not a tile' },
    ]);
    expect(decode.drain()).toEqual([]);
    expect(decode.pending).toBe(0);
  });
});

test('onready fires when a result lands, not when one is dropped', () => {
  const { pool: decode, workers } = pool(1);
  let calls = 0;
  decode.onready = () => (calls += 1);
  decode.submit('0/0/0/0', bytes());
  decode.submit('0/1/0/0', bytes());
  workers[0]?.answer(0);
  expect(calls).toBe(1);
  decode.invalidate();
  workers[0]?.answer(1);
  expect(calls).toBe(1);
});

describe('invalidate', () => {
  test('drops what was submitted before it and counts it', () => {
    const { pool: decode, workers } = pool(1);
    decode.submit('0/0/0/0', bytes());
    decode.invalidate();
    decode.submit('0/1/0/0', bytes());
    workers[0]?.answer(0);
    workers[0]?.answer(1);
    expect(decode.drain().map((result) => result.key)).toEqual(['0/1/0/0']);
    expect(decode.dropped).toBe(1);
  });
});

describe('a worker that fails', () => {
  test('answers everything it held with the error and nothing the others hold', () => {
    const { pool: decode, workers } = pool(2);
    const [a] = workers as [StandIn, StandIn];
    decode.submit('0/0/0/0', bytes());
    decode.submit('0/1/0/0', bytes());
    decode.submit('0/2/0/0', bytes());
    a.crash('script failed to load');
    expect(decode.drain()).toEqual([
      { key: '0/0/0/0', error: 'script failed to load' },
      { key: '0/2/0/0', error: 'script failed to load' },
    ]);
    expect(decode.pending).toBe(1);
  });

  test('is terminated and gets no more requests', () => {
    const { pool: decode, workers } = pool(2);
    const [a, b] = workers as [StandIn, StandIn];
    decode.submit('0/0/0/0', bytes());
    decode.submit('0/1/0/0', bytes());
    a.crash('script failed to load');
    decode.submit('0/2/0/0', bytes());
    decode.submit('0/3/0/0', bytes());
    expect(a.terminated).toBe(true);
    expect(a.received).toHaveLength(1);
    expect(b.received.map(({ message }) => message.key)).toEqual(['0/1/0/0', '0/2/0/0', '0/3/0/0']);
  });

  test('when it was the last, a submit comes straight back with its error', () => {
    const { pool: decode, workers } = pool(1);
    decode.drain();
    workers[0]?.crash('script failed to load');
    let ready = 0;
    decode.onready = () => (ready += 1);
    decode.submit('0/0/0/0', bytes());
    expect(decode.drain()).toEqual([{ key: '0/0/0/0', error: 'script failed to load' }]);
    expect(decode.pending).toBe(0);
    expect(ready).toBe(1);
    expect(workers[0]?.received).toEqual([]);
  });
});

test('dispose terminates every worker', () => {
  const { pool: decode, workers } = pool(2);
  decode.dispose();
  expect(workers.map((worker) => worker.terminated)).toEqual([true, true]);
});
