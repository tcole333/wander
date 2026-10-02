// The state names at run time (streaming.md 3.3, Names): the names stage's chunks, one for each
// `per` border steps, fetched as the borders want their steps and decoded once into typed columns
// (data/names.ts), the stored bytes and the JSON then let go. The borders' runtime (clockBorders.ts)
// says each frame which steps it draws or waits for, and their chunks come first, two at a time at
// most; a walk keeps the last WALK_CHUNKS it used. Explore, once its dive lands, fetches every
// chunk, those nearest the clock first, and keeps them all until it ends. A chunk that does not
// arrive logs once and waits `degradeFor`, and is fetched again once wanted; one the data host
// lacks, or that does not decode, never comes back. end(), as a walk returns to the lobby or
// Explore ends, stops every fetch and drops the chunks.
import { tunables } from '../config/tunables';
import { decodeNamesChunk, NamesError, namesChunkOf, type NamesChunk } from '../data/names';
import type { NamesRelease } from '../data/release';
import { fetchData, MissingError } from '../data/surfaceLayer';
import type { MemoryAccount } from '../perf/memory';

/** The chunks a walk keeps: its beats' and its clock's, which a chunk's 16 steps mostly hold. */
export const WALK_CHUNKS = 3;
/** Chunks fetched at once. */
const LOADS = 2;

/** A step's names: its chunk, decoded, and the step's index within it. */
export interface StepNames {
  chunk: NamesChunk;
  /** The chunk's place in the release's list. */
  number: number;
  index: number;
}

export interface ClockNamesOptions {
  section: NamesRelease;
  dataHost: string;
  load?: (url: string, signal: AbortSignal) => Promise<ArrayBuffer>;
  now?: () => number;
}

export class ClockNames {
  readonly #section: NamesRelease;
  readonly #dataHost: string;
  readonly #load: (url: string, signal: AbortSignal) => Promise<ArrayBuffer>;
  readonly #now: () => number;
  /** Decoded chunks by number, the most recently used last. */
  readonly #chunks = new Map<number, NamesChunk>();
  readonly #loads = new Map<number, AbortController>();
  /** Chunks that failed, by number, with the time each may be fetched again: never, for good. */
  readonly #failed = new Map<number, number>();
  readonly #logged = new Set<number>();
  /** The chunks the borders want now, theirs first. */
  #wanted: number[] = [];
  /** Explore: every chunk, until end(). */
  #all = false;

  constructor(options: ClockNamesOptions) {
    this.#section = options.section;
    this.#dataHost = options.dataHost;
    this.#load = options.load ?? ((url, signal) => fetchData(url, () => true, signal));
    this.#now = options.now ?? (() => performance.now());
  }

  /** The chunks in the release. */
  get count(): number {
    return this.#section.keys.length;
  }

  /**
   * The steps the borders draw or wait for, the most wanted first (null for none): their chunks are
   * fetched first, and in a walk kept before any other.
   */
  follow(steps: readonly (number | null)[]): void {
    const wanted: number[] = [];
    for (const step of steps) {
      if (step === null || step < 0) continue;
      const { chunk } = namesChunkOf(this.#section, step);
      if (chunk < this.count && !wanted.includes(chunk)) wanted.push(chunk);
    }
    this.#wanted = wanted;
    for (const chunk of wanted) this.#touch(chunk);
    this.#pump();
  }

  /** Explore's dive has landed: every chunk comes, those nearest the wanted ones first. */
  loadAll(): void {
    this.#all = true;
    this.#pump();
  }

  /** Whether a step's names are in, or will not come: its chunk failed. */
  holds(step: number): boolean {
    const { chunk } = namesChunkOf(this.#section, step);
    return this.#chunks.has(chunk) || this.#failing(chunk) || chunk >= this.count;
  }

  /** A step's names, once its chunk is in. */
  at(step: number): StepNames | null {
    const { chunk: number, index } = namesChunkOf(this.#section, step);
    const chunk = this.#chunks.get(number);
    return chunk ? { chunk, number, index } : null;
  }

  /** Stops every fetch and drops every chunk; a walk or Explore asks for them again. */
  end(): void {
    for (const abort of this.#loads.values()) abort.abort();
    this.#loads.clear();
    this.#chunks.clear();
    this.#wanted = [];
    this.#all = false;
  }

  /** `names.cpu`: the decoded chunks' columns. */
  inspectMemory(account: MemoryAccount): void {
    account.bytes('names.cpu', 'arrayBuffers', 0);
    for (const chunk of this.#chunks.values()) {
      for (const column of [
        chunk.name,
        chunk.s0,
        chunk.s1,
        chunk.lon,
        chunk.lat,
        chunk.angle,
        chunk.em,
        chunk.span,
        chunk.km2,
        chunk.flags,
        chunk.group,
      ]) {
        account.array('names.cpu', column);
      }
    }
    account.details.names = { chunks: this.#chunks.size, loading: this.#loads.size };
  }

  /** Marks a held chunk as just used. */
  #touch(chunk: number): void {
    const held = this.#chunks.get(chunk);
    if (!held) return;
    this.#chunks.delete(chunk);
    this.#chunks.set(chunk, held);
  }

  /** Fetches what is wanted and not held, loading or failing, LOADS at a time. */
  #pump(): void {
    if (this.#loads.size >= LOADS || this.#chunks.size === this.count) return;
    const order = [...this.#wanted];
    if (this.#all) {
      const near = this.#wanted[0] ?? 0;
      const rest = Array.from({ length: this.count }, (_, i) => i).filter(
        (i) => !order.includes(i),
      );
      rest.sort((a, b) => Math.abs(a - near) - Math.abs(b - near) || a - b);
      order.push(...rest);
    }
    for (const chunk of order) {
      if (this.#loads.size >= LOADS) return;
      if (this.#chunks.has(chunk) || this.#loads.has(chunk) || this.#failing(chunk)) continue;
      void this.#fetch(chunk);
    }
  }

  async #fetch(chunk: number): Promise<void> {
    const abort = new AbortController();
    this.#loads.set(chunk, abort);
    const key = this.#section.keys[chunk] ?? '';
    try {
      const stored = await this.#load(`${this.#dataHost}/${key}`, abort.signal);
      const decoded = await decodeNamesChunk(stored).catch((error: unknown) => {
        throw error instanceof NamesError ? error : new NamesError(`${key}: ${String(error)}`);
      });
      if (abort.signal.aborted) return;
      if (decoded.first !== chunk * this.#section.per) {
        throw new NamesError(
          `${key} begins at step ${decoded.first}, not ${chunk * this.#section.per}`,
        );
      }
      this.#chunks.set(chunk, decoded);
      this.#trim();
    } catch (error) {
      if (abort.signal.aborted) return;
      const final = error instanceof MissingError || error instanceof NamesError;
      this.#failed.set(chunk, final ? Infinity : this.#now() + tunables.degradeFor);
      if (!this.#logged.has(chunk)) {
        this.#logged.add(chunk);
        console.warn(`The globe names no states from ${key}: ${String(error)}`);
      }
    } finally {
      if (this.#loads.get(chunk) === abort) this.#loads.delete(chunk);
    }
    this.#pump();
  }

  /** In a walk, drops the least recently used chunks past WALK_CHUNKS, never a wanted one. */
  #trim(): void {
    if (this.#all) return;
    for (const chunk of this.#chunks.keys()) {
      if (this.#chunks.size <= WALK_CHUNKS) return;
      if (!this.#wanted.includes(chunk)) this.#chunks.delete(chunk);
    }
  }

  #failing(chunk: number): boolean {
    const until = this.#failed.get(chunk);
    return until !== undefined && this.#now() < until;
  }
}
