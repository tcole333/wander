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
 * other than a 404 retries after each of `retryDelays`, with jitter; the last failure rejects, and
 * so does a failure once `stillWanted` turns false while waiting to retry, freeing the request's
 * place for one somebody wants. Aborting `signal` stops the request, or its wait to retry, and
 * rejects with the signal's reason, never retrying.
 */
export async function fetchData(
  url: string,
  stillWanted = () => true,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const wanted = () => stillWanted() && !signal?.aborted;
  for (const delay of tunables.retryDelays) {
    try {
      return await fetchOnce(url, signal);
    } catch (error) {
      if (error instanceof MissingError || signal?.aborted) throw aborted(signal) ?? error;
      await backoff(delay * (0.5 + Math.random()), wanted, error).catch((failed: unknown) => {
        throw aborted(signal) ?? failed;
      });
    }
  }
  return fetchOnce(url, signal);
}

/** The reason an aborted signal gives, or undefined while it is not aborted. */
function aborted(signal: AbortSignal | undefined): unknown {
  return signal?.aborted ? (signal.reason ?? new DOMException('aborted', 'AbortError')) : undefined;
}

/** How often a backoff asks whether the data is still wanted. */
const RECHECK = 250;

/** Waits `ms`, or rethrows `error` as soon as nobody wants the data any more. */
async function backoff(ms: number, stillWanted: () => boolean, error: unknown): Promise<void> {
  for (let left = ms; ; left -= RECHECK) {
    if (!stillWanted()) throw error;
    if (left <= 0) return;
    await new Promise((wake) => setTimeout(wake, Math.min(left, RECHECK)));
  }
}

async function fetchOnce(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (signal?.aborted) throw aborted(signal);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stall: (error: DataError) => void = () => {};
  const stalled = new Promise<never>((_, reject) => {
    stall = reject;
  });
  /**
   * Rejects `stalled` and aborts the request, unless the next step lands within `ms`. The stall
   * comes first: an abort rejects the pending fetch or read at once, and the race would settle
   * with its AbortError instead.
   */
  const watch = (ms: number, what: string) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stall(new DataError(`${url}: ${what} for ${ms / 1000} s`));
      controller.abort();
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
    if (signal?.aborted) throw aborted(signal);
    if (error instanceof DataError) throw error;
    throw new DataError(`${url}: ${String(error)}`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
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
