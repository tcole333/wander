// The decode workers (streaming.md 5.1) behind one queue. The main thread submits a tile's fetched
// bytes with its key; each goes, transferred, to the worker with the fewest outstanding requests.
// Replies only land in a ready queue that the caller drains (the frame loop, in the runtime), and
// a generation counter drops results submitted before the last invalidate() (5.2, Cancellation).
import type { DecodeReply, DecodeRequest } from '../surface/decodeProtocol';
import type { DecodedWst } from '../surface/wst';

/** The two decode workers of 5.1. */
export const DECODE_WORKERS = 2;

/** The part of a Worker the pool uses, so tests can stand in for one. */
export interface DecodeWorker {
  postMessage(message: DecodeRequest, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<DecodeReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate(): void;
}

export type Decoded =
  | { key: string; tile: DecodedWst; /** Time spent decoding in the worker. */ ms: number }
  | { key: string; error: string };

interface Pending {
  key: string;
  generation: number;
  worker: Slot;
}

interface Slot {
  worker: DecodeWorker;
  outstanding: number;
}

export class DecodePool {
  readonly #slots: Slot[];
  readonly #pending = new Map<number, Pending>();
  #ready: Decoded[] = [];
  #nextId = 1;
  #generation = 0;
  /** Results that arrived after an invalidate() and were dropped. */
  dropped = 0;
  /**
   * Called when a result lands in the ready queue, so the caller can schedule a drain: the runtime
   * wakes its frame loop (5.8, every stream completion calls invalidate()).
   */
  onready: (() => void) | null = null;

  constructor(workers: DecodeWorker[]) {
    if (workers.length === 0) throw new Error('a decode pool needs a worker');
    this.#slots = workers.map((worker) => ({ worker, outstanding: 0 }));
    for (const slot of this.#slots) {
      slot.worker.onmessage = (event) => this.#receive(event.data);
      slot.worker.onerror = (event) => this.#fail(slot, event.message || 'decode worker failed');
    }
  }

  /** A pool of real module workers running decode.worker.ts. */
  static create(size = DECODE_WORKERS): DecodePool {
    const workers = Array.from(
      { length: size },
      () =>
        new Worker(new URL('./decode.worker.ts', import.meta.url), {
          type: 'module',
        }) as DecodeWorker,
    );
    return new DecodePool(workers);
  }

  /** Requests sent and not yet answered. */
  get pending(): number {
    return this.#pending.size;
  }

  /** Transfers `buf` (so it is detached here) to the least busy worker. */
  submit(key: string, buf: ArrayBuffer): void {
    const slot = this.#slots.reduce((best, next) =>
      next.outstanding < best.outstanding ? next : best,
    );
    const id = this.#nextId++;
    this.#pending.set(id, { key, generation: this.#generation, worker: slot });
    slot.outstanding += 1;
    slot.worker.postMessage({ type: 'decode', id, key, buf }, [buf]);
  }

  /** Results of everything submitted so far will be dropped when they arrive. */
  invalidate(): void {
    this.#generation += 1;
  }

  /** The results that have arrived since the last drain, in arrival order. */
  drain(): Decoded[] {
    const ready = this.#ready;
    this.#ready = [];
    return ready;
  }

  dispose(): void {
    for (const { worker } of this.#slots) worker.terminate();
    this.#pending.clear();
    this.#ready = [];
  }

  #receive(reply: DecodeReply): void {
    const pending = this.#settle(reply.id);
    if (!pending) return;
    if (pending.generation !== this.#generation) {
      this.dropped += 1;
      return;
    }
    this.#ready.push(
      reply.type === 'decoded'
        ? { key: pending.key, tile: reply.tile, ms: reply.ms }
        : { key: pending.key, error: reply.message },
    );
    this.onready?.();
  }

  /** A worker that fails outright answers everything it holds with the error. */
  #fail(slot: Slot, message: string): void {
    let landed = false;
    for (const [id, pending] of this.#pending) {
      if (pending.worker !== slot) continue;
      this.#settle(id);
      if (pending.generation !== this.#generation) continue;
      this.#ready.push({ key: pending.key, error: message });
      landed = true;
    }
    if (landed) this.onready?.();
  }

  #settle(id: number): Pending | undefined {
    const pending = this.#pending.get(id);
    if (!pending) return undefined;
    this.#pending.delete(id);
    pending.worker.outstanding -= 1;
    return pending;
  }
}
