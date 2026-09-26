// The surface upload test's page logic (e2e/surface-upload.html; streaming.md 5.4, 5.5): decode a
// release's tiles in the decode workers, give each a slot, upload its parts through the upload
// queue at a tier's animated budget, one queue run per frame, and read every slot back texel for
// texel. It reports what E2 measures of the pool path: each write's time, each slot's, the frames
// a tile takes, the bytes each frame took against the budget, and GL errors. Frames here are only
// queue runs, with nothing drawn between them.
import { DataUtils, WebGLRenderer } from 'three';
import { tunables, type Tier } from '../config/tunables';
import { loadSurfaceLayer } from '../data/surfaceLayer';
import type { Release } from '../data/release';
import { tileKey } from '../surface/cube';
import { EDGE_ENTRIES, EDGE_ROWS, MIP_SIZES, type DecodedWst } from '../surface/wst';
import { decodeTiles } from '../workers/decodeTiles';
import { centers, createSampler, rendererName } from './poolReadback';
import { FIXED_SLOTS, SlotTable } from './slotTable';
import { createSurfacePools, surfaceParts, type SurfacePools } from './surfaceUploads';
import { UploadQueue, type StopReason } from './uploadQueue';

/** Height mips, shore and water mips, the edge texture (surfaceUploads.ts). */
const SURFACE_PARTS = 7;

export interface SurfaceUploadOptions {
  tier: Tier;
  levels: [number, number];
  /** Upload at most this many tiles, spread evenly through the matching ones in node order. */
  limit: number;
}

export interface SurfaceUploadReport {
  renderer: string;
  tier: Tier;
  budgetBytes: number;
  slots: number;
  tiles: string[];
  frames: { bytes: number; parts: number; ms: number; stoppedBy: StopReason }[];
  /** Every write, in the order made. */
  writes: { bytes: number; ms: number }[];
  /** Per tile: its slot, the frames from its first part to its publish, and its writes' total. */
  uploads: { key: string; slot: number; frames: number; ms: number }[];
  /** Tiles published before all their parts landed: none, if the queue is right. */
  earlyPublishes: string[];
  /** Readbacks that differed from the decoded planes, with the largest difference. */
  mismatches: { key: string; plane: string; level: number; worst: number }[];
  decodeErrors: { key: string; error: string }[];
  glError: number;
}

declare global {
  interface Window {
    /** Set by surfaceUploadProbe.main.ts when e2e/surface-upload.html loads. */
    surfaceUpload?: Promise<SurfaceUploadReport>;
  }
}

export async function runSurfaceUpload(
  dataHost: string,
  options: SurfaceUploadOptions,
): Promise<SurfaceUploadReport> {
  const release = (await (await fetch(`${dataHost}/release.json`)).json()) as Release;
  const layer = await loadSurfaceLayer(release);
  const matching = layer
    .tiles()
    .filter((t) => t.level >= options.levels[0] && t.level <= options.levels[1]);
  const wanted = spread(matching, options.limit);

  const renderer = new WebGLRenderer({ antialias: false });
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const slots = FIXED_SLOTS + wanted.length;
  const pools = createSurfacePools(renderer, slots);
  const all = [pools.height, pools.shoreWater, pools.edges];
  for (const pool of all) pool.warm();
  const table = new SlotTable({
    slots,
    quarantineFrames: tunables.slotQuarantine,
    fixedRoots: true,
  });
  const queue = new UploadQueue({
    stopMs: tunables.uploadStopMs,
    slowCallMs: tunables.uploadSlowCall,
  });
  const budgetBytes = tunables.uploadAnimated[options.tier];

  const decoded = new Map<string, DecodedWst>();
  const decodeErrors = await decodeTiles(layer, wanted, ({ key, tile }) => {
    decoded.set(key, tile);
  });

  const report: SurfaceUploadReport = {
    renderer: rendererName(gl),
    tier: options.tier,
    budgetBytes,
    slots,
    tiles: [],
    frames: [],
    writes: [],
    uploads: [],
    earlyPublishes: [],
    mismatches: [],
    decodeErrors,
    glError: 0,
  };
  // Queued in node order, as the scheduler queues roots and then the view coarsest first.
  const slotOf = new Map<string, number>();
  for (const t of wanted) {
    const key = tileKey(t);
    const tile = decoded.get(key);
    if (!tile) continue;
    const slot = table.reserve(key);
    if (slot === undefined) throw new Error(`no slot for ${key}`);
    slotOf.set(key, slot);
    queue.enqueue({
      key,
      parts: surfaceParts(pools, slot, tile),
      onDone: () => table.publish(key),
    });
    report.tiles.push(key);
  }

  // Per tile: the frame of its first write, its writes so far and their total time.
  const progress = new Map<string, { first: number; parts: number; ms: number }>();
  while (queue.length > 0) {
    const frame = report.frames.length;
    const { bytes, parts, ms, stoppedBy, writes, published } = queue.run(budgetBytes);
    report.frames.push({ bytes, parts, ms, stoppedBy });
    for (const write of writes) {
      report.writes.push({ bytes: write.bytes, ms: write.ms });
      const tile = progress.get(write.key) ?? { first: frame, parts: 0, ms: 0 };
      tile.parts += 1;
      tile.ms += write.ms;
      progress.set(write.key, tile);
    }
    for (const key of published) {
      const tile = progress.get(key);
      if (!tile || tile.parts !== SURFACE_PARTS) report.earlyPublishes.push(key);
      report.uploads.push({
        key,
        slot: slotOf.get(key) ?? -1,
        frames: frame - (tile?.first ?? frame) + 1,
        ms: tile?.ms ?? 0,
      });
    }
    table.endFrame();
  }
  report.glError = gl.getError();

  report.mismatches = readBack(renderer, pools, table, decoded);
  for (const pool of all) pool.dispose();
  renderer.dispose();
  return report;
}

/** Up to `limit` of `items`, spread evenly through them, in their order. */
function spread<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  return Array.from(
    { length: limit },
    (_, i) => items[Math.floor((i * items.length) / limit)] as T,
  );
}

/** Every uploaded slot sampled at its texel centers, level by level, against its decoded planes. */
function readBack(
  renderer: WebGLRenderer,
  pools: SurfacePools,
  table: SlotTable,
  decoded: Map<string, DecodedWst>,
): SurfaceUploadReport['mismatches'] {
  const sampler = createSampler(renderer);
  const mismatches: SurfaceUploadReport['mismatches'] = [];
  const bytes = (value: number) => Math.round(value * 255);
  for (const key of table.keys()) {
    const slot = table.slotOf(key);
    const tile = decoded.get(key);
    if (slot === undefined || !tile) continue;
    const note = (plane: string, level: number, worst: number) => {
      if (worst !== 0) mismatches.push({ key, plane, level, worst });
    };
    MIP_SIZES.forEach((size, level) => {
      const heights = tile.heightMips[level];
      const channels = tile.channelMips[level];
      if (!heights || !channels) return;
      note(
        'height',
        level,
        sampler.worst(pools.height.texture, centers(slot, level, size), (x, y) => [
          DataUtils.fromHalfFloat(heights[y * size + x] ?? 0),
        ]),
      );
      note(
        'shoreWater',
        level,
        sampler.worst(
          pools.shoreWater.texture,
          centers(slot, level, size),
          (x, y) => [channels[2 * (y * size + x)] ?? 0, channels[2 * (y * size + x) + 1] ?? 0],
          bytes,
        ),
      );
    });
    // Both channels of every row: codes and shore bytes of each side at each mip.
    note(
      'edges',
      0,
      sampler.worst(pools.edges.texture, centers(slot, 0, EDGE_ENTRIES, EDGE_ROWS), (x, y) => [
        DataUtils.fromHalfFloat(tile.edges[2 * (y * EDGE_ENTRIES + x)] ?? 0),
        DataUtils.fromHalfFloat(tile.edges[2 * (y * EDGE_ENTRIES + x) + 1] ?? 0),
      ]),
    );
  }
  sampler.dispose();
  return mismatches;
}
