// Upload admission (streaming.md 5.4) with a fake clock: bytes per frame, the early stops, and
// publishing only once every part of a tile has landed.
import { describe, expect, test } from 'vitest';
import { tunables } from '../config/tunables';
import { UploadQueue, type UploadJob } from './uploadQueue';

/** A clock the writes advance, so each write takes the time the test gives it. */
function clock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

/** A surface tile's seven parts at their real sizes: height mips, shore and water mips, edges. */
const SURFACE_PARTS = [139_392, 34_848, 8_712, 139_392, 34_848, 8_712, 2_056];

function job(
  key: string,
  sizes: number[],
  written: string[],
  ms = 0.01,
  time = clock(),
): UploadJob {
  return {
    key,
    parts: sizes.map((bytes, i) => ({
      bytes,
      write: () => {
        written.push(`${key}#${i}`);
        time.advance(ms);
      },
    })),
    onDone: () => undefined,
  };
}

const options = { stopMs: tunables.uploadStopMs, slowCallMs: tunables.uploadSlowCall };

describe('a surface tile at the lite animated budget', () => {
  test('takes two frames, height first', () => {
    const time = clock();
    const queue = new UploadQueue({ ...options, now: time.now });
    const written: string[] = [];
    queue.enqueue(job('7/1/103/50', SURFACE_PARTS, written, 0.01, time));
    const first = queue.run(tunables.uploadAnimated.lite);
    expect(first).toMatchObject({ parts: 3, bytes: 182_952, stoppedBy: 'budget', published: [] });
    const second = queue.run(tunables.uploadAnimated.lite);
    expect(second).toMatchObject({
      parts: 4,
      bytes: 185_008,
      stoppedBy: 'empty',
      published: ['7/1/103/50'],
    });
  });
});

test('publishes a tile only when its last part lands', () => {
  const queue = new UploadQueue(options);
  const published: string[] = [];
  queue.enqueue({
    key: 'a',
    parts: [
      { bytes: 10, write: () => undefined },
      { bytes: 10, write: () => undefined },
    ],
    onDone: () => published.push('a'),
  });
  queue.run(10);
  expect(published).toEqual([]);
  queue.run(10);
  expect(published).toEqual(['a']);
});

test('runs tiles in the order they were queued', () => {
  const queue = new UploadQueue(options);
  const written: string[] = [];
  queue.enqueue(job('a', [5, 5], written));
  queue.enqueue(job('b', [5], written));
  queue.run(1000);
  expect(written).toEqual(['a#0', 'a#1', 'b#0']);
});

test('sends a part larger than the whole budget when it is the first of the frame', () => {
  const queue = new UploadQueue(options);
  queue.enqueue(job('a', [300_000, 10], []));
  expect(queue.run(256_000)).toMatchObject({ parts: 1, bytes: 300_000, stoppedBy: 'budget' });
});

test('stops after the measured time passes stopMs', () => {
  const time = clock();
  const queue = new UploadQueue({ ...options, now: time.now });
  queue.enqueue(job('a', [1, 1, 1, 1, 1], [], 0.4, time));
  expect(queue.run(1_000_000)).toMatchObject({ parts: 3, stoppedBy: 'time' });
});

test('stops after any single write over slowCallMs', () => {
  const time = clock();
  const queue = new UploadQueue({ ...options, now: time.now });
  queue.enqueue(job('a', [1], [], 0.6, time));
  queue.enqueue(job('b', [1], [], 0.01, time));
  const run = queue.run(1_000_000);
  expect(run).toMatchObject({ parts: 1, stoppedBy: 'slow', published: ['a'] });
  expect(run.writes).toEqual([{ key: 'a', bytes: 1, ms: 0.6 }]);
});

test('cancel drops the rest of a tile', () => {
  const queue = new UploadQueue(options);
  const written: string[] = [];
  queue.enqueue(job('a', [10, 10], written));
  queue.run(10);
  queue.cancel('a');
  expect(queue.run(1000).stoppedBy).toBe('empty');
  expect(written).toEqual(['a#0']);
  expect(queue.pendingBytes).toBe(0);
});
