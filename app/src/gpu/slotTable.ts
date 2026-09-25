// The slots of one GPU array pool (streaming.md 5.5): which tile holds which slot, which slots are
// free, and which wait out their quarantine after an eviction. It only allocates; the caller says
// what is protected, uploads the parts, and publishes a tile once every part has landed.
import { nodeIndex, parseTileKey } from '../surface/cube';

/** L0-L1, 30 tiles, sit at slots 0-29 (5.5, Fixed slots): their node indices. */
export const FIXED_SLOTS = 30;

export type SlotState = 'uploading' | 'resident';

export interface SlotTableOptions {
  slots: number;
  /** Frames a freed slot waits before reuse (`slotQuarantine`). */
  quarantineFrames: number;
  /** Whether L0-L1 tiles take their fixed slots 0-29, as in the surface pools. */
  fixedRoots: boolean;
}

interface Entry {
  slot: number;
  state: SlotState;
  /** The frame the tile was last drawn in, for least-recently-drawn eviction. */
  drawn: number;
}

export class SlotTable {
  readonly #options: SlotTableOptions;
  readonly #entries = new Map<string, Entry>();
  readonly #free: number[] = [];
  /** Slots in quarantine, with the frames each still waits. */
  readonly #quarantine = new Map<number, number>();
  #frame = 0;

  constructor(options: SlotTableOptions) {
    const first = options.fixedRoots ? FIXED_SLOTS : 0;
    if (options.slots <= first) {
      throw new RangeError(`${options.slots} slots leave none to allocate`);
    }
    this.#options = options;
    // Popped from the end, so the lowest slots go first.
    for (let slot = options.slots - 1; slot >= first; slot -= 1) this.#free.push(slot);
  }

  slotOf(key: string): number | undefined {
    return this.#entries.get(key)?.slot;
  }

  stateOf(key: string): SlotState | undefined {
    return this.#entries.get(key)?.state;
  }

  /** Slots a reserve can take now. */
  get free(): number {
    return this.#free.length;
  }

  /** The tiles holding slots, uploading or resident. */
  keys(): IterableIterator<string> {
    return this.#entries.keys();
  }

  /**
   * A slot for `key` to upload into: its fixed slot for an L0-L1 tile, otherwise the lowest free
   * one. Undefined when none is free; the caller evicts and tries again.
   */
  reserve(key: string): number | undefined {
    const held = this.#entries.get(key);
    if (held) return held.slot;
    const slot = this.#fixedSlot(key) ?? this.#free.pop();
    if (slot === undefined) return undefined;
    this.#entries.set(key, { slot, state: 'uploading', drawn: this.#frame });
    return slot;
  }

  /** The tile's parts have all landed; it may be drawn. */
  publish(key: string): void {
    const entry = this.#entries.get(key);
    if (!entry) throw new Error(`${key} holds no slot`);
    entry.state = 'resident';
  }

  /** Records that these tiles were drawn this frame. */
  drawn(keys: Iterable<string>): void {
    for (const key of keys) {
      const entry = this.#entries.get(key);
      if (entry) entry.drawn = this.#frame;
    }
  }

  /**
   * Frees the tile's slot, after the caller has removed it from the draw set and rebuilt the
   * instances. The slot is reused only after the quarantine, so no frame in flight samples a slot
   * that is being overwritten. A fixed slot is never freed.
   */
  release(key: string): void {
    const entry = this.#entries.get(key);
    if (!entry) return;
    if (this.#fixedSlot(key) !== undefined) throw new Error(`${key} holds a fixed slot`);
    this.#entries.delete(key);
    this.#quarantine.set(entry.slot, this.#options.quarantineFrames);
  }

  /**
   * The resident tile to evict: the least recently drawn one that is not protected, taking tiles
   * the caller marks `last` (N+1 critical, 5.5) only when nothing else is left. Fixed and
   * uploading tiles are never candidates.
   */
  evictionCandidate(
    isProtected: (key: string) => boolean,
    last: (key: string) => boolean = () => false,
  ): string | undefined {
    let best: { key: string; drawn: number; last: boolean } | undefined;
    for (const [key, entry] of this.#entries) {
      if (entry.state !== 'resident' || this.#fixedSlot(key) !== undefined || isProtected(key)) {
        continue;
      }
      const candidate = { key, drawn: entry.drawn, last: last(key) };
      if (
        !best ||
        (best.last && !candidate.last) ||
        (best.last === candidate.last && candidate.drawn < best.drawn)
      ) {
        best = candidate;
      }
    }
    return best?.key;
  }

  /** Ends a frame: quarantines count down, and slots that are done return to the free list. */
  endFrame(): void {
    this.#frame += 1;
    for (const [slot, frames] of this.#quarantine) {
      if (frames <= 1) {
        this.#quarantine.delete(slot);
        this.#free.push(slot);
        this.#free.sort((a, b) => b - a);
      } else {
        this.#quarantine.set(slot, frames - 1);
      }
    }
  }

  #fixedSlot(key: string): number | undefined {
    if (!this.#options.fixedRoots) return undefined;
    const t = parseTileKey(key);
    return t.level <= 1 ? nodeIndex(t) : undefined;
  }
}
