// The state names at run time (clockNames.ts), on synthetic chunks with the time and the fetches in
// the test's hands: the chunks of the steps the borders want come first and a walk keeps the last
// few it used, never a wanted one; Explore's dive fetches them all, nearest first, two at a time; a
// chunk the host lacks never comes back, one that drops comes back after degradeFor; and end()
// drops them all.
import { gzipSync } from 'node:zlib';
import { describe, expect, test, vi } from 'vitest';
import { tunables } from '../config/tunables';
import { NAMES_FIELDS } from '../data/names';
import type { NamesRelease } from '../data/release';
import { MissingError } from '../data/surfaceLayer';
import { MemoryAccount } from '../perf/memory';
import { ClockNames, WALK_CHUNKS } from './clockNames';

const HOST = 'https://data.test';
const PER = 4;
const CHUNKS = 6;

const SECTION: NamesRelease = {
  ver: 'beadfeed',
  steps: 'f00dcafe',
  per: PER,
  keys: Array.from({ length: CHUNKS }, (_, i) => `fd/names/${i}.wsn`),
  bytes: Array.from({ length: CHUNKS }, () => 1),
  placements: CHUNKS,
  faces: { outer: 'Cormorant Garamond 700', inner: 'Cormorant SC 700' },
  glyphs: { outer: 'ABC', inner: 'Abc' },
};

/** A chunk of PER steps holding one name over all of them: `State <chunk>`. */
function chunkFile(chunk: number): ArrayBuffer {
  const doc = {
    version: 1,
    first: chunk * PER,
    years: Array.from({ length: PER }, (_, k) => 1800 + chunk * PER + k),
    fields: [...NAMES_FIELDS],
    names: [[`State ${chunk}`, `State ${chunk}`]],
    place: [0, 0, PER - 1, 1000, 4500, 0, 4000, 9000, 100000, 0, 0],
  };
  const out = gzipSync(JSON.stringify(doc));
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

function harness() {
  let t = 0;
  const missing = new Set<string>();
  const flaky = new Set<string>();
  const held = new Map<string, () => void>();
  /** Held fetches not yet let go. */
  let waiting = 0;
  const fetched: string[] = [];
  const load = vi.fn((url: string, signal: AbortSignal) => {
    fetched.push(url.slice(HOST.length + 1));
    const key = url.slice(HOST.length + 1);
    if (missing.has(key)) return Promise.reject(new MissingError(`${url}: 404`));
    if (flaky.has(key)) {
      flaky.delete(key);
      return Promise.reject(new TypeError('Failed to fetch'));
    }
    const bytes = chunkFile(Number(/(\d+)\.wsn$/.exec(key)?.[1]));
    if (!held.has(key)) return Promise.resolve(bytes);
    waiting += 1;
    return new Promise<ArrayBuffer>((resolve, reject) => {
      let done = false;
      const settle = () => {
        if (!done) waiting -= 1;
        done = true;
      };
      held.set(key, () => {
        settle();
        resolve(bytes);
      });
      signal.addEventListener('abort', () => {
        settle();
        reject(signal.reason as Error);
      });
    });
  });
  const names = new ClockNames({ section: SECTION, dataHost: HOST, load, now: () => t });
  const h = {
    names,
    fetched,
    missing,
    flaky,
    held,
    advance: (ms: number) => (t += ms),
    /**
     * Lets every fetch and inflate in flight settle: Node inflates on its thread pool, taking as
     * long as the machine's load makes it, so this waits on the loads, not on a count of turns. A
     * held fetch never settles, and is left in flight.
     */
    async settle() {
      do await new Promise((wake) => setImmediate(wake));
      while (names.inFlight > waiting);
    },
  };
  return h;
}

describe('the state names', () => {
  test('come with the chunk of a step the borders want, and say so', async () => {
    const h = harness();
    expect(h.names.holds(5)).toBe(false);
    h.names.follow([5]);
    await h.settle();
    expect(h.fetched).toEqual(['fd/names/1.wsn']);
    expect(h.names.holds(5)).toBe(true);
    const at = h.names.at(6);
    expect(at?.number).toBe(1);
    expect(at?.index).toBe(2);
    expect(at?.chunk.full).toEqual(['State 1']);
  });

  test('a walk keeps the chunks it used last, never one wanted', async () => {
    const h = harness();
    for (const step of [0, 4, 8, 12, 16]) {
      h.names.follow([step]);
      await h.settle();
    }
    const held = [0, 1, 2, 3, 4].filter((chunk) => h.names.at(chunk * PER) !== null);
    expect(held).toEqual([2, 3, 4].slice(-WALK_CHUNKS));
    h.names.follow([0, 4, 8]);
    await h.settle();
    expect([0, 1, 2].every((chunk) => h.names.at(chunk * PER) !== null)).toBe(true);
  });

  test('Explore’s dive fetches every chunk, nearest the wanted first, two at a time', async () => {
    const h = harness();
    for (const key of SECTION.keys) h.held.set(key, () => {});
    h.names.follow([13]);
    h.names.loadAll();
    expect(h.fetched).toEqual(['fd/names/3.wsn', 'fd/names/2.wsn']);
    for (let n = 0; n < CHUNKS; n++) {
      for (const key of SECTION.keys) h.held.get(key)?.();
      await h.settle();
    }
    expect(h.fetched).toEqual(['3', '2', '4', '1', '5', '0'].map((c) => `fd/names/${c}.wsn`));
    expect(Array.from({ length: CHUNKS }, (_, c) => h.names.at(c * PER) !== null)).toEqual(
      Array.from({ length: CHUNKS }, () => true),
    );
  });

  test('a chunk the host lacks never comes back; one that drops does, after degradeFor', async () => {
    const h = harness();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.missing.add('fd/names/0.wsn');
    h.flaky.add('fd/names/1.wsn');
    h.names.follow([0, 4]);
    await h.settle();
    expect(h.names.holds(0)).toBe(true);
    expect(h.names.at(0)).toBeNull();
    expect(h.names.holds(4)).toBe(true);
    h.names.follow([0, 4]);
    await h.settle();
    expect(h.fetched).toEqual(['fd/names/0.wsn', 'fd/names/1.wsn']);
    h.advance(tunables.degradeFor);
    h.names.follow([0, 4]);
    await h.settle();
    expect(h.fetched).toEqual(['fd/names/0.wsn', 'fd/names/1.wsn', 'fd/names/1.wsn']);
    expect(h.names.at(4)?.chunk.full).toEqual(['State 1']);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  test('end() stops the fetches and leaves nothing behind', async () => {
    const h = harness();
    h.names.follow([0]);
    await h.settle();
    h.held.set('fd/names/1.wsn', () => {});
    h.names.follow([4]);
    const account = () => {
      const memory = new MemoryAccount();
      h.names.inspectMemory(memory);
      return memory.owners['names.cpu']?.arrayBuffers ?? 0;
    };
    expect(account()).toBeGreaterThan(0);
    h.names.end();
    await h.settle();
    expect(account()).toBe(0);
    expect(h.names.at(0)).toBeNull();
    expect(h.names.holds(0)).toBe(false);
  });
});
