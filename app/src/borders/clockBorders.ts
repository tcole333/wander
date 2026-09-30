// The borders through time at run time (streaming.md 3.3): whatever writes the world clock, the
// borders follow it. The step that holds on the clock's day draws from a slot of the look's border
// array once it is there; until then, where previews are on (Explore), its preview draws from a
// ring cell. Sources dissolve into each other by their drawn lines: a slot into a slot over
// borderFade, a preview into a preview over borderScrubFade, and a preview into its step once
// the step has streamed in. A clock crossing more than one step a frame fades the borders out
// until it slows, and before the first step nothing draws.
//
// A step is fetched once the clock has rested in it for borderRest, and a new target aborts a
// fetch more than a step away. Its field inflates in bands of a quarter MiB that join the
// streamer's uploads behind its tiles, two at most in hand, so a step holds its compressed file
// and two bands at its peak. On the full tier, once a step draws, the next step in the scrub
// direction fills the other slot, but never in place of the step across the boundary just
// crossed: rocking back and forth over one boundary swaps the slots without refetching. Explore's
// preview chunks stay compressed, and a cell decodes by streaming its chunk through the cell, the
// clock's own and those either side, least recently used first out. end() empties the slots and
// the ring and drops the chunks. A step or chunk that does not arrive logs once and waits
// `degradeFor`, and is fetched again once the clock wants it; one the data host lacks, or that
// does not decode, never comes back.
import type { Material, WebGLRenderer } from 'three';
import { tunables, type Tier } from '../config/tunables';
import { BordersError, CELL_BYTES, decodePreviewPair, stepBands } from '../data/borders';
import type { BorderStepsRelease, Release } from '../data/release';
import { fetchData, MissingError } from '../data/surfaceLayer';
import type { UploadJob } from '../gpu/uploadQueue';
import {
  sourceVector,
  stepUniformsOf,
  type BorderSource,
  type StepUniforms,
} from '../look/bordersHook';
import type { MemoryAccount } from '../perf/memory';
import { smoothstep } from '../story/effects/timeline';
import { worldClock, type WorldClock } from '../time/worldClock';
import { BorderArray, type BorderGpu } from './borderArray';
import { borderSteps, cellOf, chunkOf, stepAt, type BorderSteps } from './steps';

/** Where uploads go: the streamer's queue, behind its tiles. */
export interface BehindUploads {
  uploadBehind(job: UploadJob): void;
  cancelUpload(key: string): void;
}

export interface ClockBordersOptions {
  /** The release's borderSteps section; without one nothing loads or draws. */
  section: BorderStepsRelease | undefined;
  dataHost: string;
  uniforms: StepUniforms;
  gpu: BorderGpu;
  uploads: BehindUploads;
  tier: Tier;
  clock?: WorldClock;
  load?: (url: string, signal: AbortSignal) => Promise<ArrayBuffer>;
  now?: () => number;
}

/** What the active mode asks of the borders this frame. */
export interface BordersFrame {
  /** Whether borders draw: a beat that lists them, or Explore with its borders on. */
  wanted: boolean;
  /** Whether a step's preview draws until the step is in a slot: Explore's, never a walk's. */
  previews: boolean;
  /** The view's width, km across: the close fade and the inner lines' fade-in. */
  viewKm: number;
  /** The mode's own strength: its layer's easing and the lobby's fade. */
  strength: number;
}

/** The step drawn: its first year, how strongly, and whether its preview stands in for it. */
export interface StepShown {
  year: number;
  strength: number;
  preview: boolean;
}

type Drawn = { step: number } & Exclude<BorderSource, { kind: 'none' }>;

interface Load {
  step: number;
  abort: AbortController;
  /** The stored file while its bands inflate, and the bands queued by job key. */
  stored: ArrayBuffer | null;
  bands: Map<string, Uint8Array>;
  wake: (() => void) | null;
}

interface Slot {
  step: number | null;
  ready: boolean;
  load: Load | null;
}

interface Cell {
  pair: number | null;
  ready: boolean;
  usedAt: number;
}

interface Decode {
  cell: number;
  abort: AbortController;
  /** The decoded cell until it is uploaded, and its upload's key. */
  texels: Uint8Array | null;
  key: string | null;
}

const NONE: BorderSource = { kind: 'none' };

export class ClockBorders {
  readonly #steps: BorderSteps | null;
  readonly #section: BorderStepsRelease | undefined;
  readonly #dataHost: string;
  readonly #uniforms: StepUniforms;
  readonly #gpu: BorderGpu;
  readonly #uploads: BehindUploads;
  readonly #tier: Tier;
  readonly #clock: WorldClock;
  readonly #load: (url: string, signal: AbortSignal) => Promise<ArrayBuffer>;
  readonly #now: () => number;
  readonly #slots: Slot[];
  readonly #cells: Cell[];
  #chunks: (ArrayBuffer | null)[] = [];
  #chunkLoads = new Map<number, AbortController>();
  /** Whether Explore has asked for the chunks, until end(). */
  #chunksWanted = false;
  #decode: Decode | null = null;
  /** Keys that failed, with the time each may be fetched again: never, for a 404. */
  readonly #failed = new Map<string, number>();
  readonly #logged = new Set<string>();

  /** The source dissolving out, the one dissolving in, and its share, 0 to 1. */
  #from: Drawn | null = null;
  #to: Drawn | null = null;
  #mix = 1;
  #fadeMs: number = tunables.borderFade;
  #target: number | null = null;
  #since = 0;
  #direction: 1 | -1 = 1;
  #fastAt = -Infinity;
  #fast = 1;
  #last: number | null = null;
  #strength = 0;
  #serial = 0;

  constructor(options: ClockBordersOptions) {
    this.#section = options.section;
    this.#steps = options.section ? borderSteps(options.section) : null;
    this.#dataHost = options.dataHost;
    this.#uniforms = options.uniforms;
    this.#gpu = options.gpu;
    this.#uploads = options.uploads;
    this.#tier = options.tier;
    this.#clock = options.clock ?? worldClock;
    this.#load = options.load ?? ((url, signal) => fetchData(url, () => true, signal));
    this.#now = options.now ?? (() => performance.now());
    this.#slots = Array.from({ length: options.gpu.slots }, () => ({
      step: null,
      ready: false,
      load: null,
    }));
    this.#cells = Array.from({ length: options.gpu.cells }, () => ({
      pair: null,
      ready: false,
      usedAt: -Infinity,
    }));
  }

  /** The step drawn, while any is: for a walk's year plate and for scripts. */
  get shown(): StepShown | null {
    const to = this.#to;
    if (!to || !this.#steps || this.#strength <= 0) return null;
    const year = this.#steps.years[to.step] ?? 0;
    return { year, strength: this.#strength * this.#mix, preview: to.kind === 'cell' };
  }

  /** The steps each slot holds, null for an empty or loading one; for tests and the dev page. */
  get slotSteps(): (number | null)[] {
    return this.#slots.map((slot) => (slot.ready ? slot.step : null));
  }

  /** Every frame the active mode draws borders in, or asks them not to draw. */
  update(frame: BordersFrame): void {
    const now = this.#now();
    const dt = this.#last === null ? 0 : Math.max(0, now - this.#last);
    this.#last = now;
    const steps = this.#steps;
    if (!steps) {
      if (frame.wanted) this.#logOnce('', 'the release has no borderSteps section');
      this.#write(0, frame.viewKm);
      return;
    }
    const step = stepAt(steps, this.#clock.state().day);
    if (step !== this.#target) this.#retarget(step, now);
    const still = now - this.#fastAt >= tunables.borderScrubFade;
    const rate = dt / tunables.borderScrubFade;
    this.#fast = Math.max(0, Math.min(1, this.#fast + (still ? rate : -rate)));

    const desired = frame.wanted && step !== null ? this.#sourceFor(step, frame.previews) : null;
    const graced =
      desired === null && step !== null && now - this.#since < tunables.borderScrubFade;
    if (!(graced && frame.wanted)) this.#dissolveTo(desired);
    this.#mix = Math.min(1, this.#mix + dt / this.#fadeMs);
    if (this.#mix >= 1) this.#from = null;

    if (frame.wanted && step !== null) {
      if (frame.previews) this.#wantCells(step, now);
      if (now - this.#since >= tunables.borderRest) this.#wantSlot(step, false);
      const settled = this.#to?.kind === 'slot' && this.#to.step === step && !this.#from;
      if (settled) this.#wantNeighbour(step);
    }
    this.#write(frame.strength * this.#fast, frame.viewKm);
  }

  /** Fetches Explore's preview chunks, the clock's own first, to hold compressed until end(). */
  loadPreviews(): void {
    const section = this.#section;
    if (!this.#steps || !section) return;
    const count = section.previews.keys.length;
    if (this.#chunks.length !== count)
      this.#chunks = new Array<ArrayBuffer | null>(count).fill(null);
    this.#chunksWanted = true;
    this.#pumpChunks();
  }

  /**
   * Fetches the chunks not held, loading or failing, those nearest the clock's step first, two at
   * a time, so they never crowd the tiles' fetches. It runs again as each fetch ends, and while a
   * cell the clock may reach lacks its chunk, so a chunk that failed comes back after degradeFor.
   */
  #pumpChunks(): void {
    const steps = this.#steps;
    const section = this.#section;
    if (!steps || !section || !this.#chunksWanted) return;
    const own = chunkOf(steps, stepAt(steps, this.#clock.state().day) ?? 0).chunk;
    const order = Array.from({ length: this.#chunks.length }, (_, i) => i).sort(
      (a, b) => Math.abs(a - own) - Math.abs(b - own) || a - b,
    );
    for (const chunk of order) {
      if (this.#chunkLoads.size >= 2) return;
      if (this.#chunks[chunk] || this.#chunkLoads.has(chunk)) continue;
      const key = section.previews.keys[chunk] ?? '';
      if (this.#failing(key)) continue;
      const abort = new AbortController();
      this.#chunkLoads.set(chunk, abort);
      this.#load(`${this.#dataHost}/${key}`, abort.signal).then(
        (stored) => {
          if (abort.signal.aborted) return;
          this.#chunkLoads.delete(chunk);
          this.#chunks[chunk] = stored;
          this.#pumpChunks();
        },
        (error: unknown) => {
          if (abort.signal.aborted) return;
          this.#chunkLoads.delete(chunk);
          this.#fail(key, error);
          this.#pumpChunks();
        },
      );
    }
  }

  /** Clears the borders from the view, keeping what the slots and cells hold. */
  hide(): void {
    this.#from = null;
    this.#to = null;
    this.#mix = 1;
    this.#write(0, Infinity);
  }

  /** Empties the slots and the ring, stops every fetch and upload, and drops the chunks. */
  end(): void {
    for (let slot = 0; slot < this.#slots.length; slot += 1) this.#empty(slot);
    this.#stopDecode();
    for (const cell of this.#cells) Object.assign(cell, { pair: null, ready: false });
    for (const abort of this.#chunkLoads.values()) abort.abort();
    this.#chunkLoads.clear();
    this.#chunks = [];
    this.#chunksWanted = false;
    this.#target = null;
    this.hide();
  }

  dispose(): void {
    this.end();
  }

  /**
   * `borders.cpu`: the step being read, its bands queued, the chunks and a cell to upload; and the
   * array's own owners.
   */
  inspectMemory(account: MemoryAccount): void {
    this.#gpu.inspectMemory?.(account);
    account.bytes('borders.cpu', 'arrayBuffers', 0);
    for (const { load } of this.#slots) {
      account.array('borders.cpu', load?.stored);
      for (const band of load?.bands.values() ?? []) account.array('borders.cpu', band);
    }
    for (const chunk of this.#chunks) account.array('borders.cpu', chunk);
    account.array('borders.cpu', this.#decode?.texels);
    account.details.borders = {
      slots: this.slotSteps,
      cells: this.#cells.filter((cell) => cell.ready).length,
      chunks: this.#chunks.filter(Boolean).length,
    };
  }

  #retarget(step: number | null, now: number): void {
    const was = this.#target;
    if (was !== null && step !== null) {
      if (Math.abs(step - was) > 1) this.#fastAt = now;
      this.#direction = step > was ? 1 : -1;
    }
    this.#target = step;
    this.#since = now;
    // A new target aborts the fetches it no longer needs: any more than a step away.
    this.#slots.forEach((slot, i) => {
      const load = slot.load;
      if (load && (step === null || Math.abs(load.step - step) > 1)) this.#empty(i);
    });
  }

  /** The source that draws a step: its slot, else its preview cell, else none yet. */
  #sourceFor(step: number, previews: boolean): Drawn | null {
    const slot = this.#slots.findIndex((s) => s.ready && s.step === step);
    if (slot >= 0) return { kind: 'slot', slot, step };
    if (!previews) return null;
    const { pair, channel } = cellOf(step);
    const cell = this.#cells.findIndex((c) => c.ready && c.pair === pair);
    return cell >= 0 ? { kind: 'cell', cell, channel, step } : null;
  }

  #dissolveTo(next: Drawn | null): void {
    if (same(next, this.#to)) return;
    if (same(next, this.#from)) {
      // Back to the source dissolving out: the dissolve turns round where it stands.
      [this.#from, this.#to] = [this.#to, this.#from];
      this.#mix = 1 - this.#mix;
      return;
    }
    // The source more visible now dissolves out; the other, less than half drawn, gives way.
    if (this.#mix >= 0.5 || !this.#from) this.#from = this.#to;
    this.#to = next;
    this.#mix = this.#from || this.#to ? 0 : 1;
    const scrub = next?.kind === 'cell' || (!next && this.#from?.kind === 'cell');
    this.#fadeMs = scrub ? tunables.borderScrubFade : tunables.borderFade;
  }

  /** Slots the drawn sources read, which no load may write. */
  #drawnSlots(): Set<number> {
    const drawn = new Set<number>();
    for (const source of [this.#to, this.#from]) {
      if (source?.kind === 'slot') drawn.add(source.slot);
    }
    return drawn;
  }

  /**
   * Loads `step` into a slot no source draws: an empty one first, then one holding a step more
   * than a step away from it, and only for the clock's own step one holding its neighbour.
   */
  #wantSlot(step: number, neighbour: boolean): void {
    if (this.#slots.some((slot) => slot.step === step)) return;
    const key = this.#section?.keys[step] ?? '';
    if (this.#failing(key)) return;
    const target = this.#target ?? step;
    const drawn = this.#drawnSlots();
    let best = -1;
    let bestRank = Infinity;
    this.#slots.forEach((slot, i) => {
      if (drawn.has(i)) return;
      const held = slot.step;
      const rank = held === null ? 0 : Math.abs(held - target) > 1 ? 1 : 2;
      if (rank < bestRank) [best, bestRank] = [i, rank];
    });
    if (best < 0 || (neighbour && bestRank > 1)) return;
    this.#empty(best);
    void this.#fill(best, step, key);
  }

  /** On the full tier, the next step in the scrub direction fills the other slot. */
  #wantNeighbour(step: number): void {
    const next = step + this.#direction;
    if (this.#slots.length < 2 || next < 0 || next >= (this.#steps?.years.length ?? 0)) return;
    this.#wantSlot(next, true);
  }

  async #fill(slot: number, step: number, key: string): Promise<void> {
    const load: Load = {
      step,
      abort: new AbortController(),
      stored: null,
      bands: new Map(),
      wake: null,
    };
    Object.assign(this.#slots[slot] as Slot, { step, ready: false, load });
    const { signal } = load.abort;
    try {
      load.stored = await this.#load(`${this.#dataHost}/${key}`, signal);
      const reader = stepBands(load.stored, signal);
      for (;;) {
        while (load.bands.size >= 2) await this.#landed(load);
        signal.throwIfAborted();
        const next = await reader.next();
        if (next.done) {
          const year = this.#steps?.years[step];
          if (next.value !== year)
            throw new BordersError(`${key} holds ${next.value}, not ${year}`);
          break;
        }
        const { face, row, texels } = next.value;
        const job = `borders:${(this.#serial += 1)}`;
        load.bands.set(job, texels);
        this.#uploads.uploadBehind({
          key: job,
          parts: [this.#gpu.band(slot, face, row, texels)],
          onDone: () => {
            load.bands.delete(job);
            load.wake?.();
          },
        });
      }
      load.stored = null;
      while (load.bands.size > 0) await this.#landed(load);
      signal.throwIfAborted();
      Object.assign(this.#slots[slot] as Slot, { ready: true, load: null });
    } catch (error) {
      if (signal.aborted) return;
      this.#empty(slot);
      this.#fail(key, error);
    }
  }

  /** Resolves once one of a load's bands has landed, or it is aborted. */
  #landed(load: Load): Promise<void> {
    return new Promise((wake) => {
      load.wake = () => {
        load.wake = null;
        wake();
      };
      if (load.abort.signal.aborted) load.wake();
    });
  }

  /** Stops a slot's load, drops its queued bands, and leaves it empty. */
  #empty(slot: number): void {
    const state = this.#slots[slot];
    if (!state) return;
    const load = state.load;
    if (load) {
      load.abort.abort();
      for (const job of load.bands.keys()) this.#uploads.cancelUpload(job);
      load.bands.clear();
      load.stored = null;
      load.wake?.();
    }
    Object.assign(state, { step: null, ready: false, load: null });
  }

  /**
   * The previews the clock may reach next: its own step's cell, then those either side, the scrub
   * direction's first. One cell decodes at a time.
   */
  #wantCells(step: number, now: number): void {
    const steps = this.#steps;
    if (!steps) return;
    const last = steps.years.length - 1;
    const pairs = [step, step + 2 * this.#direction, step - 2 * this.#direction]
      .filter((s) => s >= 0 && s <= last)
      .map((s) => cellOf(s).pair);
    for (const pair of pairs) {
      const held = this.#cells.find((cell) => cell.pair === pair);
      if (held) {
        held.usedAt = now;
        continue;
      }
      if (this.#decode) return;
      const { chunk, index } = chunkOf(steps, 2 * pair);
      const stored = this.#chunks[chunk];
      if (!stored) {
        this.#pumpChunks();
        continue;
      }
      const cell = this.#freeCell();
      if (cell < 0) return;
      void this.#decodeCell(cell, pair, stored, index, now);
      return;
    }
  }

  /** The least recently used cell no source draws. */
  #freeCell(): number {
    const drawn = new Set<number>();
    for (const source of [this.#to, this.#from]) {
      if (source?.kind === 'cell') drawn.add(source.cell);
    }
    let best = -1;
    this.#cells.forEach((cell, i) => {
      if (drawn.has(i)) return;
      if (best < 0 || cell.usedAt < (this.#cells[best]?.usedAt ?? Infinity)) best = i;
    });
    return best;
  }

  async #decodeCell(
    cell: number,
    pair: number,
    stored: ArrayBuffer,
    index: number,
    now: number,
  ): Promise<void> {
    const state = this.#cells[cell] as Cell;
    Object.assign(state, { pair, ready: false, usedAt: now });
    const decode: Decode = { cell, abort: new AbortController(), texels: null, key: null };
    this.#decode = decode;
    const key = this.#section?.previews.keys[chunkOf(this.#steps as BorderSteps, 2 * pair).chunk];
    try {
      const texels = new Uint8Array(CELL_BYTES);
      await decodePreviewPair(stored, index, texels, decode.abort.signal);
      if (decode.abort.signal.aborted) return;
      decode.texels = texels;
      decode.key = `borders:${(this.#serial += 1)}`;
      this.#uploads.uploadBehind({
        key: decode.key,
        parts: [this.#gpu.cell(cell, texels)],
        onDone: () => {
          if (this.#decode === decode) this.#decode = null;
          if (state.pair === pair) state.ready = true;
        },
      });
    } catch (error) {
      if (decode.abort.signal.aborted) return;
      if (this.#decode === decode) this.#decode = null;
      Object.assign(state, { pair: null, ready: false });
      this.#fail(key ?? '', error);
    }
  }

  #stopDecode(): void {
    const decode = this.#decode;
    if (!decode) return;
    decode.abort.abort();
    if (decode.key) this.#uploads.cancelUpload(decode.key);
    this.#decode = null;
  }

  #failing(key: string): boolean {
    const until = this.#failed.get(key);
    return until !== undefined && this.#now() < until;
  }

  #fail(key: string, error: unknown): void {
    const final = error instanceof MissingError || error instanceof BordersError;
    this.#failed.set(key, final ? Infinity : this.#now() + tunables.degradeFor);
    this.#logOnce(key, String(error));
  }

  #logOnce(key: string, why: string): void {
    if (this.#logged.has(key)) return;
    this.#logged.add(key);
    console.warn(`The globe shows no borders${key ? ` from ${key}` : ''}: ${why}`);
  }

  #write(strength: number, viewKm: number): void {
    const uniforms = this.#uniforms;
    const fades = viewFades(viewKm);
    const drawing = this.#to !== null || this.#from !== null;
    this.#strength = drawing ? strength * fades.close : 0;
    uniforms.lookBorderStrength.value = this.#strength;
    uniforms.lookBorderInner.value = fades.inner;
    sourceVector(this.#tier, this.#from ?? NONE, uniforms.lookBorderA.value);
    sourceVector(this.#tier, this.#to ?? NONE, uniforms.lookBorderB.value);
    uniforms.lookBorderMix.value = this.#mix;
  }
}

/**
 * How the view's width fades the borders: `close`, all of them as the view closes in over
 * borderCloseKm, where a texel spans tens of pixels; `inner`, the inner lines in as it narrows over
 * borderInnerKm.
 */
export function viewFades(viewKm: number): { close: number; inner: number } {
  const close = tunables.borderCloseKm;
  const inner = tunables.borderInnerKm;
  return {
    close: smoothstep(close.near, close.far, viewKm),
    inner: 1 - smoothstep(inner.near, inner.far, viewKm),
  };
}

function same(a: Drawn | null, b: Drawn | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind === 'slot' && b.kind === 'slot') return a.slot === b.slot && a.step === b.step;
  if (a.kind === 'cell' && b.kind === 'cell') {
    return a.cell === b.cell && a.step === b.step && a.channel === b.channel;
  }
  return false;
}

const bound = new WeakMap<Material, ClockBorders>();

/**
 * Where a look holds the border steps (Explore enabled), allocates and warms its array, and binds
 * the borders' runtime to its material for the modes to drive; otherwise null.
 */
export function attachBorderSteps(
  renderer: WebGLRenderer,
  material: Material,
  uploads: BehindUploads,
  { borderSteps: section, dataHost }: Pick<Release, 'borderSteps' | 'dataHost'>,
  tier: Tier,
): ClockBorders | null {
  const uniforms = stepUniformsOf(material);
  if (!uniforms) return null;
  const gpu = new BorderArray(renderer, uniforms.lookBorderField.value, tier);
  gpu.warm();
  const borders = new ClockBorders({ section, dataHost, uniforms, gpu, uploads, tier });
  bound.set(material, borders);
  return borders;
}

/** The border steps' runtime of a look's material, where Explore is enabled. */
export function clockBordersOf(material: Material): ClockBorders | undefined {
  return bound.get(material);
}
