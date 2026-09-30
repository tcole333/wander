// GPU uploads, admitted by bytes per frame (streaming.md 5.4). A job is one tile's parts, each one
// pool write; jobs run in the order they were queued (the caller queues roots, then the view
// coarsest first), and a tile is published only once every part has landed. Jobs queued behind
// (the border steps' bands and preview cells, 3.3) run only once no tile has a part left, within
// the same frame's budget. A frame's run stops before a part that would pass the byte budget,
// after `stopMs` of measured time, or after any single write over `slowCallMs`, since no timer can
// bound one synchronous driver call.

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
  #behind: Queued[] = [];

  constructor(options: UploadQueueOptions) {
    this.#options = { now: () => performance.now(), ...options };
  }

  /** Jobs with parts still to write, those behind included. */
  get length(): number {
    return this.#queue.length + this.#behind.length;
  }

  /**
   * Bytes the queued tiles hold, parts already written included, until each job's last part
   * lands. Jobs behind are their owners' to count.
   */
  get retainedBytes(): number {
    return this.#queue.reduce(
      (sum, { job }) => sum + job.parts.reduce((n, part) => n + part.bytes, 0),
      0,
    );
  }

  /** Bytes still to write, those behind included. */
  get pendingBytes(): number {
    let bytes = 0;
    for (const { job, next } of [...this.#queue, ...this.#behind]) {
      for (const part of job.parts.slice(next)) bytes += part.bytes;
    }
    return bytes;
  }

  /** Queues a job; `behind` runs only once no job queued without it has a part left. */
  enqueue(job: UploadJob, behind = false): void {
    if (job.parts.length === 0) throw new Error(`${job.key} has no parts to upload`);
    (behind ? this.#behind : this.#queue).push({ job, next: 0 });
  }

  /** Drops a job's remaining parts; the caller frees its slot. */
  cancel(key: string): void {
    this.#queue = this.#queue.filter(({ job }) => job.key !== key);
    this.#behind = this.#behind.filter(({ job }) => job.key !== key);
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
    for (;;) {
      const lane = this.#queue.length > 0 ? this.#queue : this.#behind;
      const head = lane[0];
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
        lane.shift();
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
