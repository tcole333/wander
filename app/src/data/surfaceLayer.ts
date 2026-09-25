// The surface layer as a page reads it from a release (streaming.md 3.8): the availability bitmap,
// every available node's meter bounds from bounds.bin, and each tile's URL on the data host.
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

/** Fetches data as the runtime does: cross-origin, without credentials (4.2, 5.2). */
export async function fetchData(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.arrayBuffer();
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
