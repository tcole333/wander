// The decode test page's logic (e2e/decode.html, streaming.md 5.1, 7.3): read a release from a
// data server, fetch every available surface tile as the runtime fetches, decode it in the two
// real decode workers, and report a digest of each decoded tile, its decode time in the worker and
// whether its bounds match bounds.bin. The specs compare the digests with Node's decodeWst.
import { loadSurfaceLayer } from '../data/surfaceLayer';
import type { Release } from '../data/release';
import { nodeIndex, parseTileKey } from '../surface/cube';
import type { DecodedWst } from '../surface/wst';
import { DECODE_WORKERS } from './decodePool';
import { decodeTiles } from './decodeTiles';

export interface DecodedTileReport {
  key: string;
  /** The order the tile's decode finished in, from 0. */
  order: number;
  /** SHA-256 of the decoded planes, in the order decodedPlanes() gives them. */
  digest: string;
  /** Decode time in the worker, in milliseconds. */
  ms: number;
  /** Stored bytes fetched. */
  bytes: number;
  /** Whether the decoded meter bounds equal bounds.bin's entry for the node. */
  boundsMatch: boolean;
}

export interface DecodeProbeReport {
  release: { id: string; ver: string; maxLevel: number };
  workers: number;
  /** Available tiles at the levels asked for. */
  available: number;
  tiles: DecodedTileReport[];
  errors: { key: string; error: string }[];
  /** From the first fetch to the last decoded tile, in milliseconds. */
  wallMs: number;
}

declare global {
  interface Window {
    /** Set by decodeProbe.main.ts when e2e/decode.html loads. */
    decodeProbe?: Promise<DecodeProbeReport>;
  }
}

/** The planes a digest covers, in order, as bytes. */
export function decodedPlanes(tile: DecodedWst): Uint8Array[] {
  const planes = [...tile.heightMips, ...tile.channelMips, tile.edges, tile.grid];
  return planes.map((plane) => new Uint8Array(plane.buffer, plane.byteOffset, plane.byteLength));
}

export async function runDecodeProbe(
  dataHost: string,
  levels: [number, number] = [0, Infinity],
): Promise<DecodeProbeReport> {
  const release = (await (await fetch(`${dataHost}/release.json`)).json()) as Release;
  const layer = await loadSurfaceLayer(release);
  const wanted = layer.tiles().filter((t) => t.level >= levels[0] && t.level <= levels[1]);
  const tiles: DecodedTileReport[] = [];
  let finished = 0;
  const start = performance.now();
  const errors = await decodeTiles(layer, wanted, async ({ key, tile, ms, bytes }) => {
    const order = finished++;
    const expected = layer.bounds.get(nodeIndex(parseTileKey(key)));
    tiles.push({
      key,
      order,
      digest: await digest(tile),
      ms,
      bytes,
      boundsMatch:
        expected !== undefined &&
        expected[0] === tile.boundsM[0] &&
        expected[1] === tile.boundsM[1],
    });
  });
  const wallMs = performance.now() - start;
  tiles.sort((a, b) => a.key.localeCompare(b.key));
  return {
    release: { id: release.id, ver: release.surface.ver, maxLevel: release.surface.maxLevel },
    workers: DECODE_WORKERS,
    available: wanted.length,
    tiles,
    errors,
    wallMs,
  };
}

async function digest(tile: DecodedWst): Promise<string> {
  const planes = decodedPlanes(tile);
  const all = new Uint8Array(planes.reduce((sum, plane) => sum + plane.length, 0));
  let at = 0;
  for (const plane of planes) {
    all.set(plane, at);
    at += plane.length;
  }
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', all));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
