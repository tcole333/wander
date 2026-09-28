// The walk's surface streamer (issue #4; streaming.md 5.2-5.7, simplified). Every frame it selects
// the drawn nodes for the camera, requests the tiles they want coarsest first and nearest the view
// center first, decodes them in the workers, uploads them into the surface pools within the frame's
// byte budget, and packs the drawn instances with their sources and seam flags. One request queue,
// rebuilt every frame, so requests nobody wants any more simply drop; no request classes or byte
// cache. fetchData aborts a stalled request and retries a failed one, but a started request whose
// tile nobody wants any more gives up instead of retrying. A tile that still fails draws from its
// ancestors for `degradeFor`, then is wanted again; one the data host lacks (a 404), or whose
// bytes do not decode, never is.
import {
  Frustum,
  Matrix4,
  Vector3,
  type Object3D,
  type PerspectiveCamera,
  type WebGLRenderer,
} from 'three';
import { tunables } from '../config/tunables';
import type { CreateSurfaceStreamer, SurfaceStreamer } from '../contract';
import type { Release } from '../data/release';
import {
  DataError,
  fetchData,
  loadSurfaceLayer,
  MissingError,
  type SurfaceLayer,
} from '../data/surfaceLayer';
import { flagsNeedUp, INSTANCE_WORDS, packInstance, type InstanceState } from '../globe/instances';
import { ancestorAt, CoverError, seamFlags, type DrawnNode } from '../globe/seamFlags';
import { GRID_SEGMENTS } from '../globe/tileGrid';
import { FIXED_SLOTS, SlotTable } from '../gpu/slotTable';
import { createSurfacePools, surfaceParts } from '../gpu/surfaceUploads';
import { UploadQueue, type StopReason, type UploadRun } from '../gpu/uploadQueue';
import { nodeIndex, tileKey, type Tile } from '../surface/cube';
import type { DecodedWst } from '../surface/wst';
import { DecodePool } from '../workers/decodePool';
import { decodeTiles } from '../workers/decodeTiles';
import { createInstanceGeometry } from './instanceGeometry';
import { NodeSelector } from './selectNodes';
import { assignSources } from './sources';

/** Surface pool slots on the full tier (streaming.md 5.5). */
const SLOTS = 256;
/** Instances the buffer holds. */
const CAPACITY = 2048;
const IN_FLIGHT = tunables.inFlight.total;
/**
 * Tiles fetching, decoding, waiting for a slot or uploading at once. Uploads drain about 1.4 tiles
 * a frame at uploadAnimated, so a deeper pipeline only holds slots for tiles the view may have
 * left by the time they land.
 */
const PIPELINE = 2 * IN_FLIGHT;
/** L0-L1 are the roots: loaded before the first frame, in fixed slots, always resident. */
const ROOT_LEVEL = 1;
/**
 * Tiles wanted at most: the slots besides the roots, less room for the tiles the last view still
 * draws while the next one loads. Past it the least urgent wait (the finest, then the farthest
 * from the view center), and their nodes draw coarser sources, so a view never stalls the pool.
 */
const WANT_MAX = SLOTS - FIXED_SLOTS - PIPELINE;
/** Ancestors of a drawn source kept resident, for seams' up tiles and zooming out. */
const KEEP_ANCESTORS = 3;
const LEVELS = 8;

/** More than the contract asks, for the debug page. */
export interface StreamerDetails {
  /** Wanted tiles not yet requested. */
  queued: number;
  /** Tiles the drawn nodes want past WANT_MAX, left unrequested. */
  trimmed: number;
  /** Tiles that failed lately or for good, whose nodes draw from their ancestors. */
  failed: number;
  culled: number;
  /** Drawn nodes per source level, L0 first. */
  sources: number[];
  /** CoverErrors met so far; each is logged once. */
  coverErrors: number;
  /** Milliseconds the last update spent selecting and packing. */
  selectMs: number;
  packMs: number;
  /** Decoded tiles waiting for a slot, and tiles with parts still to upload. */
  waiting: number;
  queuedUploads: number;
  /** The last frame's upload run. */
  upload: { bytes: number; ms: number; stoppedBy: StopReason };
  /** Tiles decoded that nobody wanted by the time they landed. */
  dropped: number;
}

export interface DebugStreamer extends SurfaceStreamer {
  details(): StreamerDetails;
}

interface Waiting {
  decoded: DecodedWst;
  /** The frame this tile last evicted a tile for its slot, which waits out the quarantine. */
  evictedAt: number;
}

export const createSurfaceStreamer = (async (
  renderer: WebGLRenderer,
  release: Release,
): Promise<DebugStreamer> => {
  const layer = await loadSurfaceLayer(release);
  const pools = createSurfacePools(renderer, SLOTS);
  for (const pool of [pools.height, pools.shoreWater, pools.edges]) pool.warm();
  const table = new SlotTable({
    slots: SLOTS,
    quarantineFrames: tunables.slotQuarantine,
    fixedRoots: true,
  });
  const uploads = new UploadQueue({
    stopMs: tunables.uploadStopMs,
    slowCallMs: tunables.uploadSlowCall,
  });
  /** codeMid of every tile that holds a slot. */
  const codeMids = new Map<string, number>();

  // The roots, into their fixed slots before the first frame.
  const roots = layer.tiles().filter((tile) => tile.level <= ROOT_LEVEL);
  const rootErrors = await decodeTiles(layer, roots, ({ key, tile }) => {
    const slot = table.reserve(key);
    if (slot === undefined) throw new Error(`no fixed slot for ${key}`);
    codeMids.set(key, tile.header.codeMid);
    uploads.enqueue({
      key,
      parts: surfaceParts(pools, slot, tile),
      onDone: () => table.publish(key),
    });
  });
  if (rootErrors.length > 0 || roots.filter((t) => t.level === 0).length < 6) {
    for (const pool of [pools.height, pools.shoreWater, pools.edges]) pool.dispose();
    throw new DataError(`the roots did not load: ${JSON.stringify(rootErrors)}`);
  }
  while (uploads.length > 0) {
    uploads.run(tunables.uploadIdle.full);
    table.endFrame();
  }

  const selector = new NodeSelector({
    available: (tile) => layer.available(tile),
    heightRange: (tile) => heightRange(layer, tile),
    hMin: lowestBound(layer),
  });
  const instances = createInstanceGeometry(GRID_SEGMENTS.full, CAPACITY);
  const decoder = DecodePool.create();
  const params = {
    refinePx: tunables.refinePx.full as number,
    maxLevel: 7,
    /** Keeps the drawn nodes as they are; their tiles still stream in. */
    freeze: false,
    /** Cull by horizon and frustum; off draws every leaf. */
    cull: true,
  };

  const inFlight = new Set<string>();
  const decoding = new Set<string>();
  const waiting = new Map<string, Waiting>();
  /** Tiles in the upload queue, holding reserved slots. */
  const uploading = new Set<string>();
  /** Failed tiles, with the time each may be requested again: never, if it failed for good. */
  const failed = new Map<string, number>();
  const logged = new Set<string>();
  /** The tiles the drawn nodes want this frame, with their ancestors down to L2. */
  const wanted = new Map<string, Tile>();
  /** Tiles the instance buffer reads, and their ancestors within KEEP_ANCESTORS: never evicted. */
  let kept = new Set<string>();
  let drawnTiles: Tile[] = [];
  let packedSignature = '';
  let refusedSignature = '';
  let levels = new Array<number>(LEVELS).fill(0);
  let sources = new Array<number>(LEVELS).fill(0);
  let queued = 0;
  let trimmed = 0;
  let coverErrors = 0;
  let selectMs = 0;
  let packMs = 0;
  let dropped = 0;
  let lastUpload: UploadRun | undefined;
  let frame = 0;
  let disposed = false;
  /** Set when the drawn nodes or the resident tiles change, so the instances need repacking. */
  let dirty = true;
  const viewCenter = new Vector3(1, 0, 0);
  let lastView: number[] = [];

  const logOnce = (message: string) => {
    if (logged.has(message)) return;
    logged.add(message);
    console.warn(`streamer: ${message}`);
  };
  /**
   * The tile's node draws from its ancestors for `degradeFor`, or for good when a retry cannot
   * help: the data host lacks the tile, or it does not decode, since the HTTP cache hands back the
   * same bytes and a failed decode worker is never replaced.
   */
  const fail = (key: string, error: unknown, forGood: boolean) => {
    failed.set(key, forGood ? Infinity : performance.now() + tunables.degradeFor);
    logOnce(`${key} failed: ${String(error)}`);
  };
  /** Whether `key` failed lately. An expired entry is dropped, so the tile is wanted again. */
  const failing = (key: string) => {
    const until = failed.get(key);
    if (until === undefined) return false;
    if (until > performance.now()) return true;
    failed.delete(key);
    return false;
  };
  const resident = (tile: Tile) => table.stateOf(tileKey(tile)) === 'resident';
  const usable = (tile: Tile) =>
    resident(tile) && (tile.level === 0 || resident(ancestorAt(tile, tile.level - 1)));
  const isProtected = (key: string) => kept.has(key) || wanted.has(key);
  /** Coarsest first, then nearest the view center. */
  const priority = (tile: Tile) =>
    tile.level * 10 + selector.centerOf(tile).angleTo(viewCenter) / Math.PI;

  const toLocal = new Matrix4();
  const clip = new Matrix4();
  const frustum = new Frustum();
  const eye = new Vector3();
  const forward = new Vector3();

  /** The drawn nodes for this camera, reselected only when the view or the params change. */
  function select(camera: PerspectiveCamera, height: number, globe: Object3D): void {
    camera.updateMatrixWorld();
    globe.updateMatrixWorld();
    toLocal.copy(globe.matrixWorld).invert();
    camera.getWorldPosition(eye).applyMatrix4(toLocal);
    camera.getWorldDirection(forward).transformDirection(toLocal);
    clip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    clip.multiply(globe.matrixWorld);
    const pxPerUnit = height / (2 * Math.tan((camera.getEffectiveFOV() * Math.PI) / 360));
    const view = [...clip.elements, ...eye.toArray(), pxPerUnit, params.refinePx, params.maxLevel];
    view.push(Number(params.cull));
    if (view.length === lastView.length && view.every((value, i) => value === lastView[i])) return;
    lastView = view;
    dirty = true;
    frustum.setFromProjectionMatrix(clip);
    drawnTiles = selector.select({
      eye,
      frustum,
      pxPerUnit,
      refinePx: params.refinePx,
      maxLevel: Math.min(params.maxLevel, layer.surface.maxLevel),
      cull: params.cull,
    });
    lookCenter(eye, forward, viewCenter);
  }

  /**
   * Every drawn node's deepest available tile, with its ancestors, is wanted, up to WANT_MAX in
   * priority order. Ancestors rank before their descendants, so what is left holds whole chains.
   */
  function want(): void {
    wanted.clear();
    for (const tile of drawnTiles) {
      let level = tile.level;
      while (level > 0 && !wantable(ancestorAt(tile, level))) level -= 1;
      for (; level > ROOT_LEVEL; level -= 1) {
        const ancestor = ancestorAt(tile, level);
        const key = tileKey(ancestor);
        // The rest of the chain came with it.
        if (wanted.has(key)) break;
        wanted.set(key, ancestor);
      }
    }
    trimmed = Math.max(0, wanted.size - WANT_MAX);
    if (trimmed === 0) return;
    const ranked = [...wanted].sort(([, a], [, b]) => priority(a) - priority(b));
    for (const [key] of ranked.slice(WANT_MAX)) wanted.delete(key);
  }

  function wantable(tile: Tile): boolean {
    return layer.available(tile) && !failing(tileKey(tile));
  }

  /**
   * Decoded tiles take slots, evicting the least recently drawn unprotected tile when full, and
   * queue their parts; queued tiles nobody wants any more give their slots back.
   */
  function upload(): void {
    for (const key of uploading) {
      if (wanted.has(key)) continue;
      uploads.cancel(key);
      table.release(key);
      codeMids.delete(key);
      uploading.delete(key);
      dropped += 1;
    }
    for (const result of decoder.drain()) {
      decoding.delete(result.key);
      if ('error' in result) fail(result.key, result.error, true);
      else if (!wanted.has(result.key) || table.slotOf(result.key) !== undefined) dropped += 1;
      else waiting.set(result.key, { decoded: result.tile, evictedAt: -Infinity });
    }
    const ordered = [...waiting].sort(
      ([a], [b]) => priorityOf(a, wanted, priority) - priorityOf(b, wanted, priority),
    );
    for (const [key, entry] of ordered) {
      if (!wanted.has(key)) {
        waiting.delete(key);
        dropped += 1;
        continue;
      }
      const slot = table.reserve(key);
      if (slot === undefined) {
        if (frame - entry.evictedAt <= tunables.slotQuarantine) continue;
        const victim = table.evictionCandidate(isProtected);
        if (victim === undefined) continue;
        table.release(victim);
        codeMids.delete(victim);
        entry.evictedAt = frame;
        dirty = true;
        continue;
      }
      waiting.delete(key);
      uploading.add(key);
      codeMids.set(key, entry.decoded.header.codeMid);
      uploads.enqueue({
        key,
        parts: surfaceParts(pools, slot, entry.decoded),
        onDone: () => {
          uploading.delete(key);
          table.publish(key);
          dirty = true;
        },
      });
    }
    lastUpload = uploads.run(tunables.uploadAnimated.full);
  }

  /** Starts the most urgent missing tiles, while fetches and slots allow. */
  function request(): void {
    const missing = [...wanted].filter(
      ([key]) =>
        table.slotOf(key) === undefined &&
        !inFlight.has(key) &&
        !decoding.has(key) &&
        !waiting.has(key) &&
        !failing(key),
    );
    queued = missing.length;
    const pending = () => inFlight.size + decoding.size + waiting.size + uploading.size;
    if (missing.length === 0 || inFlight.size >= IN_FLIGHT || pending() >= PIPELINE) return;
    let room = table.free + evictable() - inFlight.size - decoding.size - waiting.size;
    const ranked = missing
      .map(([key, tile]) => ({ key, tile, rank: priority(tile) }))
      .sort((a, b) => a.rank - b.rank);
    for (const { key, tile } of ranked) {
      if (inFlight.size >= IN_FLIGHT || pending() >= PIPELINE || room <= 0) break;
      room -= 1;
      inFlight.add(key);
      fetchData(layer.url(tile), () => !disposed && wanted.has(key)).then(
        (buf) => {
          inFlight.delete(key);
          if (disposed) return;
          if (!wanted.has(key)) {
            dropped += 1;
            return;
          }
          decoding.add(key);
          decoder.submit(key, buf);
        },
        (error: unknown) => {
          inFlight.delete(key);
          if (wanted.has(key)) fail(key, error, error instanceof MissingError);
        },
      );
    }
  }

  function evictable(): number {
    let count = 0;
    for (const key of table.keys()) {
      if (table.stateOf(key) === 'resident' && !isRoot(key) && !isProtected(key)) count += 1;
    }
    return count;
  }

  /** Sources, seam flags and instance words for the drawn nodes, when they change. */
  function pack(): void {
    if (!dirty) return;
    dirty = false;
    const nodes = assignSources(drawnTiles, usable);
    const signature = nodes.map((n) => `${tileKey(n.tile)}:${n.source}`).join();
    if (signature === packedSignature || signature === refusedSignature) return;
    let flags: Map<string, number>;
    try {
      flags = seamFlags(nodes, { partial: true });
    } catch (error) {
      if (!(error instanceof CoverError)) throw error;
      refusedSignature = signature;
      coverErrors += 1;
      logOnce(`kept the last instances: ${error.message}`);
      return;
    }
    const count = Math.min(nodes.length, CAPACITY);
    if (nodes.length > CAPACITY) logOnce(`${nodes.length} nodes; drawing the first ${CAPACITY}`);
    const words = new Uint32Array(count * INSTANCE_WORDS);
    const keep = new Set<string>();
    const nextLevels = new Array<number>(LEVELS).fill(0);
    const nextSources = new Array<number>(LEVELS).fill(0);
    try {
      for (let i = 0; i < count; i += 1) {
        const node = nodes[i] as DrawnNode;
        const state = instanceState(node, flags.get(tileKey(node.tile)) ?? 0, table, codeMids);
        // packInstance caps its index at INSTANCE_CAPACITY (1,024), so each instance packs as
        // index 0 of its own view.
        packInstance(words.subarray(i * INSTANCE_WORDS, (i + 1) * INSTANCE_WORDS), 0, state);
        const low = Math.max(0, node.source - KEEP_ANCESTORS);
        for (let level = node.source; level >= low; level -= 1) {
          keep.add(tileKey(ancestorAt(node.tile, level)));
        }
        nextLevels[node.tile.level] = (nextLevels[node.tile.level] ?? 0) + 1;
        nextSources[node.source] = (nextSources[node.source] ?? 0) + 1;
      }
    } catch (error) {
      refusedSignature = signature;
      logOnce(`kept the last instances: ${String(error)}`);
      return;
    }
    instances.words.set(words);
    instances.commit(count);
    kept = keep;
    packedSignature = signature;
    levels = nextLevels;
    sources = nextSources;
  }

  return {
    release,
    layer,
    pools,
    geometry: instances.geometry,
    params,

    update(camera, viewport, globe) {
      if (disposed) return;
      let t = performance.now();
      if (!params.freeze) select(camera, viewport.height, globe);
      want();
      selectMs = performance.now() - t;
      upload();
      request();
      t = performance.now();
      pack();
      packMs = performance.now() - t;
      table.drawn(kept);
      table.endFrame();
      frame += 1;
    },

    stats() {
      let residentCount = 0;
      for (const key of table.keys()) if (table.stateOf(key) === 'resident') residentCount += 1;
      return {
        drawn: instances.geometry.instanceCount,
        resident: residentCount,
        inFlight: inFlight.size,
        decoding: decoding.size,
        uploading: uploads.length + waiting.size,
        levels: [...levels],
      };
    },

    details() {
      return {
        queued,
        trimmed,
        failed: failed.size,
        culled: selector.culled,
        sources: [...sources],
        coverErrors,
        selectMs,
        packMs,
        waiting: waiting.size,
        queuedUploads: uploading.size,
        upload: {
          bytes: lastUpload?.bytes ?? 0,
          ms: lastUpload?.ms ?? 0,
          stoppedBy: lastUpload?.stoppedBy ?? 'empty',
        },
        dropped,
      };
    },

    dispose() {
      disposed = true;
      decoder.dispose();
      instances.geometry.dispose();
      for (const pool of [pools.height, pools.shoreWater, pools.edges]) pool.dispose();
    },
  };
}) satisfies CreateSurfaceStreamer;

/** The instance of a drawn node: its source, and the source's parent when a seam flag reads it. */
function instanceState(
  node: DrawnNode,
  flags: number,
  table: SlotTable,
  codeMids: Map<string, number>,
): InstanceState {
  const ref = (tile: Tile) => {
    const key = tileKey(tile);
    const slot = table.slotOf(key);
    const codeMid = codeMids.get(key);
    if (slot === undefined || codeMid === undefined) throw new Error(`${key} is not resident`);
    return { slot, codeMid };
  };
  const state: InstanceState = {
    tile: node.tile,
    src: { ...ref(ancestorAt(node.tile, node.source)), level: node.source },
    flags,
  };
  if (flagsNeedUp(flags)) state.up = ref(ancestorAt(node.tile, node.source - 1));
  return state;
}

/**
 * Meters anything drawn inside `tile` can take: its own bounds with its nearest available
 * ancestor's, since a coarser source or a seam's up tile may draw there; without a tile of its
 * own, what its deepest available ancestor draws.
 */
function heightRange(layer: SurfaceLayer, tile: Tile): [number, number] {
  const boundsOf = (t: Tile) => (layer.available(t) ? layer.bounds.get(nodeIndex(t)) : undefined);
  const own = boundsOf(tile);
  for (let level = tile.level - 1; level >= 0; level -= 1) {
    const above = boundsOf(ancestorAt(tile, level));
    if (!above) continue;
    return own ? [Math.min(own[0], above[0]), Math.max(own[1], above[1])] : [above[0], above[1]];
  }
  return own ? [own[0], own[1]] : [0, 0];
}

/** The lowest meters of any available node. */
function lowestBound(layer: SurfaceLayer): number {
  let low = 0;
  for (const [min] of layer.bounds.values()) low = Math.min(low, min);
  return low;
}

/** Where the view looks: the camera ray's hit on the globe, or the nearest point to it. */
function lookCenter(eye: Vector3, forward: Vector3, out: Vector3): void {
  const b = eye.dot(forward);
  const disc = b * b - (eye.lengthSq() - 1);
  const t = disc >= 0 && -b - Math.sqrt(disc) > 0 ? -b - Math.sqrt(disc) : Math.max(0, -b);
  out.copy(forward).multiplyScalar(t).add(eye).normalize();
}

function isRoot(key: string): boolean {
  return Number(key.split('/')[0]) <= ROOT_LEVEL;
}

function priorityOf(
  key: string,
  wanted: Map<string, Tile>,
  priority: (tile: Tile) => number,
): number {
  const tile = wanted.get(key);
  return tile ? priority(tile) : Infinity;
}
