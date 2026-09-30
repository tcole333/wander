// The borders through time at run time, on synthetic steps and previews, with the world clock,
// the time and the streamer's upload queue in the test's hands: a step streams in once the clock
// rests, in bands behind the tiles, two at most in hand; a new target aborts a fetch; slots
// dissolve into each other and rocking swaps them without refetching; previews stand in while
// the step streams and dissolve over the scrub fade; a fast clock fades the borders out; nothing
// draws before the first step; and end() leaves no memory behind.
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { tunables, type Tier } from '../config/tunables';
import { BAND_BYTES, STEP_BANDS } from '../data/borders';
import type { BorderStepsRelease } from '../data/release';
import { UploadQueue } from '../gpu/uploadQueue';
import { createStepUniforms, sourceVector } from '../look/bordersHook';
import { MemoryAccount } from '../perf/memory';
import { dayFromCivil } from '../story/dates';
import { previewChunk, stepFile } from '../test/borderFiles';
import { WorldClock } from '../time/worldClock';
import type { BorderGpu } from './borderArray';
import { ClockBorders, type BordersFrame } from './clockBorders';
import { firstDay } from './steps';

const YEARS = [1800, 1805, 1810, 1815, 1817, 1820];
const HOST = 'https://data.test';
const at = (year: number) => YEARS.indexOf(year);

const SECTION: BorderStepsRelease = {
  ver: 'f00dcafe',
  size: 1024,
  apron: 4,
  years: YEARS,
  keys: YEARS.map((year) => `fd/borders/s/${year}.bin`),
  bytes: YEARS.map(() => 1),
  previews: { per: 4, keys: ['fd/borders/p/0.bin', 'fd/borders/p/1.bin'], bytes: [1, 1] },
  polities: 'fd/borders/m/0.json',
  notice: 'lic/0.txt',
};

function gz(raw: Uint8Array): ArrayBuffer {
  const out = gzipSync(raw);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

/** Each step's stored field, far from any border, and the two preview chunks, made when asked. */
const FILES = new Map<string, () => Uint8Array>([
  ...YEARS.map(
    (year, i) => [`${HOST}/${SECTION.keys[i]}`, () => stepFile(year, [255, 127])] as const,
  ),
  ...[0, 1].map((chunk) => {
    const years = YEARS.slice(4 * chunk, 4 * chunk + 4);
    const layers = years.map((_, k) => new Uint8Array(512 * 256).fill(10 * (4 * chunk + k)));
    return [`${HOST}/${SECTION.previews.keys[chunk]}`, () => previewChunk(years, layers)] as const;
  }),
]);
const stored = new Map<string, ArrayBuffer>();
function file(url: string): ArrayBuffer | undefined {
  const make = FILES.get(url);
  if (!make) return undefined;
  if (!stored.has(url)) stored.set(url, gz(make()));
  return stored.get(url);
}

/** A day within a step's year. */
const inYear = (year: number, month = 6) => dayFromCivil({ year, month, day: 1 });

afterEach(() => vi.restoreAllMocks());

function harness(tier: Tier = 'full', section: BorderStepsRelease | null = SECTION) {
  const clock = new WorldClock(inYear(1815), 365);
  let t = 0;
  const queue = new UploadQueue({ stopMs: Infinity, slowCallMs: Infinity, now: () => 0 });
  const writes: string[] = [];
  const gpu: BorderGpu = {
    slots: tier === 'full' ? 2 : 1,
    cells: 16,
    band: (slot, face, row, texels) => ({
      bytes: texels.length,
      write: () => writes.push(`band ${slot}/${face}/${row}`),
    }),
    cell: (cell, texels) => ({ bytes: texels.length, write: () => writes.push(`cell ${cell}`) }),
  };
  const fetched: { url: string; signal: AbortSignal }[] = [];
  /** URLs whose fetch waits until released, rejecting when aborted. */
  const held = new Map<string, () => void>();
  /** URLs whose next fetches fail as a dropped connection does, and how many. */
  const flaky = new Map<string, number>();
  const load = vi.fn((url: string, signal: AbortSignal) => {
    fetched.push({ url, signal });
    const failures = flaky.get(url) ?? 0;
    if (failures > 0) {
      flaky.set(url, failures - 1);
      return Promise.reject(new TypeError('Failed to fetch'));
    }
    const bytes = file(url);
    if (!bytes) return Promise.reject(new Error(`no ${url}`));
    if (!held.has(url)) return Promise.resolve(bytes);
    return new Promise<ArrayBuffer>((resolve, reject) => {
      held.set(url, () => resolve(bytes));
      signal.addEventListener('abort', () => reject(signal.reason as Error));
    });
  });
  const uniforms = createStepUniforms(tier);
  const borders = new ClockBorders({
    section: section ?? undefined,
    dataHost: HOST,
    uniforms,
    gpu,
    uploads: {
      uploadBehind: (job) => queue.enqueue(job, true),
      cancelUpload: (key) => queue.cancel(key),
    },
    tier,
    clock,
    load,
    now: () => t,
  });
  /** The bands and cells in hand: queued, not yet landed. */
  let peakQueued = 0;
  const h = {
    clock,
    borders,
    uniforms,
    writes,
    fetched,
    held,
    flaky,
    queue,
    get peakQueued() {
      return peakQueued;
    },
    /** One frame of `ms`: the borders' update, then the queue at the full tier's budget. */
    async frame(ms = 16, frame: Partial<BordersFrame> = {}) {
      t += ms;
      borders.update({ wanted: true, previews: false, viewKm: 3000, strength: 1, ...frame });
      peakQueued = Math.max(peakQueued, queue.behindLength);
      queue.run(tunables.uploadAnimated.full);
      // Room for Node's inflater, a thread-pool round trip a piece, and the loads to move on.
      for (let i = 0; i < 32; i += 1) await new Promise((wake) => setImmediate(wake));
    },
    async frames(count: number, ms = 16, frame: Partial<BordersFrame> = {}) {
      for (let i = 0; i < count; i += 1) await h.frame(ms, frame);
    },
    /** Frames until `done`, failing past `limit`. */
    async until(done: () => boolean, frame: Partial<BordersFrame> = {}, limit = 400) {
      for (let i = 0; i < limit && !done(); i += 1) await h.frame(16, frame);
      expect(done()).toBe(true);
    },
    /** What source B, the one dissolving in, draws. */
    drawing() {
      return [...uniforms.lookBorderB.value.toArray()];
    },
    slot(slot: number) {
      return [...sourceVector(tier, { kind: 'slot', slot }).toArray()];
    },
    cpu() {
      const account = new MemoryAccount();
      borders.inspectMemory(account);
      return account.owners['borders.cpu']?.arrayBuffers ?? 0;
    },
  };
  return h;
}

describe('a step', () => {
  test('is fetched only once the clock has rested in it for borderRest', async () => {
    const h = harness();
    // The first frame finds the clock in 1815; the rest counts from there.
    await h.frames(Math.ceil(tunables.borderRest / 16));
    expect(h.fetched).toEqual([]);
    await h.frames(1);
    expect(h.fetched.map(({ url }) => url)).toEqual([`${HOST}/${SECTION.keys[at(1815)]}`]);
  });

  test('streams in bands behind the tiles, two in hand at most, then eases in', async () => {
    const h = harness();
    let peakCpu = 0;
    await h.until(() => {
      peakCpu = Math.max(peakCpu, h.cpu());
      return h.borders.slotSteps.includes(at(1815));
    });
    expect(h.writes.filter((w) => w.startsWith('band 0/'))).toHaveLength(STEP_BANDS);
    expect(h.writes.slice(0, 2)).toEqual(['band 0/0/0', 'band 0/0/128']);
    expect(h.peakQueued).toBeLessThanOrEqual(2);
    const compressed = file(`${HOST}/${SECTION.keys[at(1815)]}`)?.byteLength ?? 0;
    expect(peakCpu).toBeLessThanOrEqual(compressed + 2 * BAND_BYTES);
    await h.frame();
    expect(h.drawing()).toEqual(h.slot(0));
    expect(h.uniforms.lookBorderMix.value).toBeLessThan(0.1);
    await h.frames(Math.ceil(tunables.borderFade / 16));
    expect(h.uniforms.lookBorderMix.value).toBe(1);
    expect(h.borders.shown).toMatchObject({ year: 1815, preview: false });
    // Its neighbour then streams into the other slot, and once it has, nothing is held.
    await h.until(() => h.borders.slotSteps.includes(at(1817)));
    expect(h.cpu()).toBe(0);
  });

  test('is aborted by a new target more than a step away, its bands dropped', async () => {
    const h = harness();
    const url = `${HOST}/${SECTION.keys[at(1815)]}`;
    h.held.set(url, () => {});
    await h.frames(20);
    expect(h.fetched[0]?.signal.aborted).toBe(false);
    h.clock.set(inYear(1800));
    await h.frame();
    expect(h.fetched[0]?.signal.aborted).toBe(true);
    expect(h.queue.behindLength).toBe(0);
  });

  test('keeps streaming when the clock moves a single step away', async () => {
    const h = harness();
    h.held.set(`${HOST}/${SECTION.keys[at(1815)]}`, () => {});
    await h.frames(20);
    h.clock.set(inYear(1817));
    await h.frame();
    expect(h.fetched[0]?.signal.aborted).toBe(false);
  });
});

describe('two slots', () => {
  /** A harness at rest in 1815 with 1815 drawn and its neighbour, 1817, in the other slot. */
  async function rested() {
    const h = harness();
    await h.until(() => h.borders.slotSteps.includes(at(1817)));
    await h.frames(Math.ceil(tunables.borderFade / 16));
    return h;
  }

  test('fill the other with the next step once one draws', async () => {
    const h = await rested();
    expect(h.borders.slotSteps).toEqual([at(1815), at(1817)]);
    expect(h.fetched).toHaveLength(2);
  });

  test('dissolve one into the other over borderFade, half way half way through', async () => {
    const h = await rested();
    h.clock.set(inYear(1817));
    await h.frames(Math.round(tunables.borderFade / 2 / 16));
    expect(h.drawing()).toEqual(h.slot(1));
    expect([...h.uniforms.lookBorderA.value.toArray()]).toEqual(h.slot(0));
    expect(h.uniforms.lookBorderMix.value).toBeCloseTo(0.5, 1);
    await h.frames(Math.ceil(tunables.borderFade / 16));
    expect(h.uniforms.lookBorderMix.value).toBe(1);
    expect(h.borders.shown?.year).toBe(1817);
  });

  test('swap back and forth across one boundary without refetching', async () => {
    const h = await rested();
    for (const year of [1817, 1815, 1817, 1815, 1817]) {
      h.clock.set(inYear(year));
      await h.frames(40);
      expect(h.drawing()).toEqual(h.slot(year === 1815 ? 0 : 1));
    }
    expect(h.fetched).toHaveLength(2);
  });

  test('turn a dissolve round where it stands when the clock turns back', async () => {
    const h = await rested();
    h.clock.set(inYear(1817));
    await h.frames(Math.round(tunables.borderFade / 4 / 16));
    const mix = h.uniforms.lookBorderMix.value;
    h.clock.set(inYear(1815));
    await h.frame(0);
    expect(h.drawing()).toEqual(h.slot(0));
    expect(h.uniforms.lookBorderMix.value).toBeCloseTo(1 - mix, 5);
  });
});

describe('one slot, on the lite tier', () => {
  test('loads a new step only once the one drawn has dissolved out', async () => {
    const h = harness('lite');
    await h.until(() => h.borders.slotSteps.includes(at(1815)));
    await h.frames(Math.ceil(tunables.borderFade / 16));
    h.clock.set(inYear(1820));
    await h.frames(Math.floor(tunables.borderFade / 16) - 2);
    expect(h.fetched).toHaveLength(1);
    await h.until(() => h.borders.slotSteps.includes(at(1820)));
    expect(h.fetched).toHaveLength(2);
  });
});

describe('previews', () => {
  const explore = { previews: true };

  test("draw the clock's step from its cell until the step streams in, then dissolve into it", async () => {
    const h = harness();
    h.held.set(`${HOST}/${SECTION.keys[at(1815)]}`, () => {});
    h.borders.loadPreviews();
    // The clock's own chunk first.
    expect(h.fetched[0]?.url).toBe(`${HOST}/${SECTION.previews.keys[0]}`);
    await h.until(() => h.uniforms.lookBorderB.value.x > 0, explore);
    // 1815 is step 3: the odd one of its cell's pair, in G.
    expect(h.uniforms.lookBorderB.value.x).toBe(3);
    expect(h.borders.shown).toMatchObject({ year: 1815, preview: true });
    await h.frames(Math.ceil(tunables.borderScrubFade / 16), 16, explore);
    expect(h.uniforms.lookBorderMix.value).toBe(1);
    const step = `${HOST}/${SECTION.keys[at(1815)]}`;
    await h.until(() => h.fetched.some(({ url }) => url === step), explore);
    expect(h.uniforms.lookBorderB.value.x).toBe(3);
    h.held.get(step)?.();
    await h.until(() => h.borders.slotSteps.includes(at(1815)), explore);
    await h.frame(16, explore);
    expect(h.drawing()).toEqual(h.slot(0));
    expect(h.uniforms.lookBorderA.value.x).toBe(3);
  });

  test('dissolve into each other over borderScrubFade as the clock steps', async () => {
    const h = harness();
    for (const key of SECTION.keys) h.held.set(`${HOST}/${key}`, () => {});
    h.borders.loadPreviews();
    await h.until(() => h.uniforms.lookBorderB.value.x > 0, explore);
    await h.frames(10, 16, explore);
    h.clock.set(inYear(1817));
    await h.until(() => h.borders.shown?.year === 1817, explore);
    await h.frame(Math.round(tunables.borderScrubFade / 2) - 16, explore);
    expect(h.uniforms.lookBorderMix.value).toBeGreaterThan(0.2);
    expect(h.uniforms.lookBorderMix.value).toBeLessThan(0.8);
    await h.frames(Math.ceil(tunables.borderScrubFade / 16), 16, explore);
    expect(h.uniforms.lookBorderMix.value).toBe(1);
  });

  test('come back after degradeFor when a chunk does not arrive', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness();
    const chunk = `${HOST}/${SECTION.previews.keys[0]}`;
    h.flaky.set(chunk, 1);
    h.held.set(`${HOST}/${SECTION.keys[at(1815)]}`, () => {});
    h.borders.loadPreviews();
    await h.frames(20, 16, explore);
    expect(h.fetched.filter(({ url }) => url === chunk)).toHaveLength(1);
    expect(h.uniforms.lookBorderB.value.x).toBe(0);
    await h.frames(Math.ceil(tunables.degradeFor / 1000) - 1, 1000, explore);
    expect(h.fetched.filter(({ url }) => url === chunk)).toHaveLength(1);
    await h.until(() => h.uniforms.lookBorderB.value.x > 0, explore);
    expect(h.fetched.filter(({ url }) => url === chunk)).toHaveLength(2);
    expect(h.borders.shown).toMatchObject({ year: 1815, preview: true });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('never draw in a walk', async () => {
    const h = harness();
    h.held.set(`${HOST}/${SECTION.keys[at(1815)]}`, () => {});
    h.borders.loadPreviews();
    await h.frames(60);
    expect(h.uniforms.lookBorderB.value.x).toBe(0);
    expect(h.writes.filter((w) => w.startsWith('cell'))).toEqual([]);
  });
});

describe('the clock', () => {
  test('crossing more than a step a frame fades the borders out until it slows', async () => {
    const h = harness();
    await h.until(() => h.borders.slotSteps.includes(at(1815)));
    await h.frames(Math.ceil(tunables.borderFade / 16));
    expect(h.uniforms.lookBorderStrength.value).toBeGreaterThan(0.9);
    for (const year of [1800, 1815, 1800, 1815]) {
      h.clock.set(inYear(year));
      await h.frame();
    }
    expect(h.uniforms.lookBorderStrength.value).toBeLessThan(0.7);
    await h.frames(Math.ceil((2 * tunables.borderScrubFade) / 16));
    expect(h.uniforms.lookBorderStrength.value).toBeGreaterThan(0.9);
  });

  test('before the first step draws nothing and fetches nothing', async () => {
    const h = harness();
    h.clock.set(firstDay(1800) - 1);
    await h.frames(40);
    expect(h.fetched).toEqual([]);
    expect(h.uniforms.lookBorderStrength.value).toBe(0);
    expect(h.borders.shown).toBeNull();
  });

  test('the close fade and the inner lines follow the view', async () => {
    const h = harness();
    await h.until(() => h.borders.slotSteps.includes(at(1815)));
    await h.frames(Math.ceil(tunables.borderFade / 16));
    await h.frame(16, { viewKm: 8000 });
    expect(h.uniforms.lookBorderInner.value).toBe(0);
    expect(h.uniforms.lookBorderStrength.value).toBe(1);
    await h.frame(16, { viewKm: 2000 });
    expect(h.uniforms.lookBorderInner.value).toBe(1);
    await h.frame(16, { viewKm: 200 });
    expect(h.uniforms.lookBorderStrength.value).toBe(0);
  });
});

describe('end()', () => {
  test('empties the slots and the ring and drops the chunks, holding no memory', async () => {
    const h = harness();
    h.held.set(`${HOST}/${SECTION.keys[at(1817)]}`, () => {});
    h.borders.loadPreviews();
    await h.until(() => h.borders.slotSteps.includes(at(1815)), { previews: true });
    expect(h.cpu()).toBeGreaterThan(0);
    h.borders.end();
    expect(h.borders.slotSteps).toEqual([null, null]);
    expect(h.cpu()).toBe(0);
    expect(h.queue.behindLength).toBe(0);
    expect(h.fetched.every(({ signal, url }) => signal.aborted || !h.held.has(url))).toBe(true);
    expect(h.uniforms.lookBorderStrength.value).toBe(0);
  });
});

describe('without a borderSteps section', () => {
  test('logs once and draws nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness('full', null);
    await h.frames(30);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(h.fetched).toEqual([]);
    expect(h.uniforms.lookBorderStrength.value).toBe(0);
  });
});
