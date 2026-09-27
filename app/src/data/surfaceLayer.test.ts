// fetchData on a public network, with fetch stubbed and the clock faked: failures retry with
// backoff, stalls abort and retry, a slow body that keeps arriving is left alone, and a 404 is
// final.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { tunables } from '../config/tunables';
import { DataError, fetchData, MissingError } from './surfaceLayer';

const TILE = 'https://data.test/surf/00000000/3/0/1/2.wst';

/** A 200 whose body sends `chunks` one-byte chunks, `every` ms apart, then ends or stops. */
function body(chunks: number, every: number, then: 'ends' | 'stops' = 'ends'): Response {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (sent === chunks) {
        if (then === 'ends') controller.close();
        else await new Promise(() => {});
        return;
      }
      await new Promise((wake) => setTimeout(wake, every));
      sent += 1;
      controller.enqueue(new Uint8Array([sent]));
    },
  });
  return new Response(stream);
}

/** Stubs fetch with one answer per call, in order; the last answers every call after it. */
function network(...answers: ((init: RequestInit) => Promise<Response>)[]) {
  let calls = 0;
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>((_url, init) => {
    const answer = answers[Math.min(calls, answers.length - 1)];
    calls += 1;
    if (!answer) throw new Error('no answer');
    return answer(init);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const status = (code: number) => () => Promise.resolve(new Response(null, { status: code }));
const lost = () => Promise.reject(new TypeError('Failed to fetch'));
/** Never answers, and rejects when aborted, as a browser's fetch does. */
const silent = ({ signal }: RequestInit) =>
  new Promise<Response>((_, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason as Error));
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('fetchData', () => {
  test('retries a failure after a backoff and returns the bytes that finally arrive', async () => {
    const fetch = network(status(503), lost, () => Promise.resolve(body(3, 10)));
    const bytes = fetchData(TILE);
    await vi.runAllTimersAsync();
    expect([...new Uint8Array(await bytes)]).toEqual([1, 2, 3]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  test('gives up with a DataError after three retries', async () => {
    const fetch = network(status(500));
    const failure = expect(fetchData(TILE)).rejects.toThrow(DataError);
    await vi.runAllTimersAsync();
    await failure;
    expect(fetch).toHaveBeenCalledTimes(1 + tunables.retryDelays.length);
  });

  test('does not retry a 404', async () => {
    const fetch = network(status(404));
    const failure = expect(fetchData(TILE)).rejects.toThrow(MissingError);
    await vi.runAllTimersAsync();
    await failure;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('aborts a request with no headers, then one whose body stops, and retries', async () => {
    const fetch = network(
      silent,
      () => Promise.resolve(body(1, 10, 'stops')),
      () => Promise.resolve(body(2, 10)),
    );
    const bytes = fetchData(TILE);
    await vi.advanceTimersByTimeAsync(tunables.stallHeaders - 1);
    const first = fetch.mock.calls[0]?.[1].signal;
    expect(first?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(first?.aborted).toBe(true);
    await vi.runAllTimersAsync();
    expect([...new Uint8Array(await bytes)]).toEqual([1, 2]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  test('names the stall, not the abort, when every attempt stalls', async () => {
    network(silent);
    const failure = expect(fetchData(TILE)).rejects.toThrow(
      `${TILE}: no response for ${tunables.stallHeaders / 1000} s`,
    );
    await vi.runAllTimersAsync();
    await failure;
  });

  test('never aborts a slow body that keeps arriving', async () => {
    const every = tunables.stallBytes * 0.8;
    const fetch = network(() => Promise.resolve(body(5, every)));
    const bytes = fetchData(TILE);
    await vi.runAllTimersAsync();
    expect([...new Uint8Array(await bytes)]).toEqual([1, 2, 3, 4, 5]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
