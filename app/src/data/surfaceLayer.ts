// The surface layer as a page reads it from a release (streaming.md 3.8): the availability bitmap,
// every available node's meter bounds from bounds.bin, and each tile's URL on the data host.
import { tunables } from '../config/tunables';
import { parseSurfaceBounds } from '../surface/bounds';
import { availGet, nodeCount, nodeFromIndex, nodeIndex, tileKey, type Tile } from '../surface/cube';
import { inflate } from '../surface/wst';
import type { Release, SurfaceRelease } from './release';

export interface SurfaceLayer {
  surface: SurfaceRelease;
  /** One bit per node in node order (3.0 item 8). */
  avail: Uint8Array;
  /** [min, max] meters by node index, for every available node. */
  bounds: Map<number, [number, number]>;
  url(t: Tile): string;
  available(t: Tile): boolean;
  /** Every available tile, in node order. */
  tiles(): Tile[];
}

/** Data the page needs did not arrive: the data host refused it or could not be reached. */
export class DataError extends Error {
  override name = 'DataError';
}

/** The data host has no such key: a release bug, since keys are immutable (5.2). Never retried. */
export class MissingError extends DataError {
  override name = 'MissingError';
}

/**
 * Fetches data as the runtime does: cross-origin, without credentials, the body through a reader
 * (4.2, 5.2). A request with no response headers for `stallHeaders`, or whose body stops arriving
 * for `stallBytes`, is aborted; a body that keeps arriving, however slowly, never is. A failure
 * other than a 404 retries after each of `retryDelays`, with jitter; the last failure rejects.
 */
export async function fetchData(url: string): Promise<ArrayBuffer> {
  for (const delay of tunables.retryDelays) {
    try {
      return await fetchOnce(url);
    } catch (error) {
      if (error instanceof MissingError) throw error;
    }
    await new Promise((wake) => setTimeout(wake, delay * (0.5 + Math.random())));
  }
  return fetchOnce(url);
}

async function fetchOnce(url: string): Promise<ArrayBuffer> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stall: (error: DataError) => void = () => {};
  const stalled = new Promise<never>((_, reject) => {
    stall = reject;
  });
  /** Aborts the request, rejecting `stalled`, unless the next step lands within `ms`. */
  const watch = (ms: number, what: string) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      controller.abort();
      stall(new DataError(`${url}: ${what} for ${ms / 1000} s`));
    }, ms);
  };
  try {
    watch(tunables.stallHeaders, 'no response');
    const response = await Promise.race([
      fetch(url, { mode: 'cors', credentials: 'omit', signal: controller.signal }),
      stalled,
    ]);
    if (response.status === 404) throw new MissingError(`${url}: HTTP 404`);
    if (!response.ok) throw new DataError(`${url}: HTTP ${response.status}`);
    if (!response.body) return await response.arrayBuffer();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      watch(tunables.stallBytes, 'no bytes');
      const { done, value } = await Promise.race([reader.read(), stalled]);
      if (done) break;
      chunks.push(value);
    }
    return concat(chunks);
  } catch (error) {
    // Lets go of a body left unread.
    controller.abort();
    if (error instanceof DataError) throw error;
    throw new DataError(`${url}: ${String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

function concat(chunks: Uint8Array[]): ArrayBuffer {
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes.buffer;
}

export async function loadSurfaceLayer(release: Release): Promise<SurfaceLayer> {
  const { dataHost, surface } = release;
  const nodes = nodeCount(surface.maxLevel);
  const avail = fromBase64(surface.avail);
  // 'WSB1' header, then two i16 per node at most.
  const raw = await inflate(await fetchData(`${dataHost}/${surface.bounds}`), 12 + 4 * nodes);
  const bounds = parseSurfaceBounds(raw.slice().buffer, avail);
  const layer = `${dataHost}/surf/${surface.ver}`;
  const available = (t: Tile) => t.level <= surface.maxLevel && availGet(avail, nodeIndex(t));
  return {
    surface,
    avail,
    bounds,
    url: (t) => `${layer}/${tileKey(t)}.wst`,
    available,
    tiles: () => [...bounds.keys()].map(nodeFromIndex),
  };
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
