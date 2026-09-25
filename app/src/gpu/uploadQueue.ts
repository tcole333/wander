// GPU uploads, admitted by bytes per frame (streaming.md 5.4). A job is one tile's parts, each one
// pool write; jobs run in the order they were queued (the caller queues roots, then the view
// coarsest first), and a tile is published only once every part has landed. A frame's run stops
// before a part that would pass the byte budget, after `stopMs` of measured time, or after any
// single write over `slowCallMs`, since no timer can bound one synchronous driver call.

export interface UploadPart {
  bytes: number;
  write(): void;
}

export interface UploadJob {
  key: string;
  parts: UploadPart[];
  /** Called once the last part has landed: the caller publishes the tile (5.5, Slot safety). */
  onDone(): void;
}

export interface UploadQueueOptions {
  /** `uploadStopMs`. */
  stopMs: number;
  /** `uploadSlowCall`. */
  slowCallMs: number;
  now?: () => number;
}

export type StopReason = 'empty' | 'budget' | 'time' | 'slow';

export interface UploadRun {
  bytes: number;
  parts: number;
  ms: number;
  /** Tiles whose last part landed in this run. */
  published: string[];
  stoppedBy: StopReason;
  /** Each write in the order made: its tile, its size and its own time in milliseconds. */
  writes: { key: string; bytes: number; ms: number }[];
}

interface Queued {
  job: UploadJob;
  next: number;
}

export class UploadQueue {
  readonly #options: Required<UploadQueueOptions>;
  #queue: Queued[] = [];

  constructor(options: UploadQueueOptions) {
    this.#options = { now: () => performance.now(), ...options };
  }

  /** Tiles with parts still to write. */
  get length(): number {
    return this.#queue.length;
  }

  /** Bytes still to write. */
  get pendingBytes(): number {
    let bytes = 0;
    for (const { job, next } of this.#queue) {
      for (const part of job.parts.slice(next)) bytes += part.bytes;
    }
    return bytes;
  }

  enqueue(job: UploadJob): void {
    if (job.parts.length === 0) throw new Error(`${job.key} has no parts to upload`);
    this.#queue.push({ job, next: 0 });
  }

  /** Drops a tile's remaining parts; the caller frees its slot. */
  cancel(key: string): void {
    this.#queue = this.#queue.filter(({ job }) => job.key !== key);
  }

  /**
   * One frame's uploads: parts in order while they fit `budgetBytes` (`uploadAnimated` or
   * `uploadIdle`). A part larger than the whole budget still goes when it is the frame's first, so
   * nothing waits forever.
   */
  run(budgetBytes: number): UploadRun {
    const { now, stopMs, slowCallMs } = this.#options;
    const start = now();
    const run: UploadRun = {
      bytes: 0,
      parts: 0,
      ms: 0,
      published: [],
      stoppedBy: 'empty',
      writes: [],
    };
    while (this.#queue.length > 0) {
      const head = this.#queue[0];
      const part = head?.job.parts[head.next];
      if (!head || !part) break;
      if (run.parts > 0 && run.bytes + part.bytes > budgetBytes) {
        run.stoppedBy = 'budget';
        break;
      }
      const before = now();
      part.write();
      const after = now();
      run.writes.push({ key: head.job.key, bytes: part.bytes, ms: after - before });
      run.bytes += part.bytes;
      run.parts += 1;
      head.next += 1;
      if (head.next === head.job.parts.length) {
        this.#queue.shift();
        run.published.push(head.job.key);
        head.job.onDone();
      }
      if (after - before > slowCallMs) {
        run.stoppedBy = 'slow';
        break;
      }
      if (after - start > stopMs) {
        run.stoppedBy = 'time';
        break;
      }
    }
    run.ms = now() - start;
    return run;
  }
}
