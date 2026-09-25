// The decode test page's logic (e2e/decode.html, streaming.md 5.1, 7.3): read a release from a
// data server, fetch every available surface tile as the runtime fetches, decode it in the two
// real decode workers, and report a digest of each decoded tile, its decode time in the worker and
// whether its bounds match bounds.bin. The specs compare the digests with Node's decodeWst.
import { fetchData, loadSurfaceLayer } from '../data/surfaceLayer';
import type { Release } from '../data/release';
import { nodeIndex, parseTileKey, tileKey } from '../surface/cube';
import type { DecodedWst } from '../surface/wst';
import { DecodePool, DECODE_WORKERS } from './decodePool';

/** Fetches in flight at once: the runtime's cap (5.2, `inFlight`). */
const IN_FLIGHT = 12;

export interface DecodedTileReport {
  key: string;
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
  const queue = layer.tiles().filter((t) => t.level >= levels[0] && t.level <= levels[1]);
  const available = queue.length;
  const pool = DecodePool.create();
  const tiles: DecodedTileReport[] = [];
  const errors: DecodeProbeReport['errors'] = [];
  const bytes = new Map<string, number>();
  const start = performance.now();

  await new Promise<void>((done) => {
    let fetching = 0;
    const settled = () => tiles.length + errors.length;
    const pump = () => {
      while (fetching < IN_FLIGHT && queue.length > 0) {
        const t = queue.shift();
        if (!t) break;
        const key = tileKey(t);
        fetching += 1;
        fetchData(layer.url(t))
          .then((buf) => {
            bytes.set(key, buf.byteLength);
            pool.submit(key, buf);
          })
          .catch((error: unknown) => errors.push({ key, error: String(error) }))
          .finally(() => {
            fetching -= 1;
            pump();
          });
      }
      if (settled() === available) done();
    };
    pool.onready = () => {
      void Promise.all(
        pool.drain().map(async (result) => {
          if ('error' in result) return errors.push(result);
          const expected = layer.bounds.get(nodeIndex(parseTileKey(result.key)));
          tiles.push({
            key: result.key,
            digest: await digest(result.tile),
            ms: result.ms,
            bytes: bytes.get(result.key) ?? 0,
            boundsMatch:
              expected !== undefined &&
              expected[0] === result.tile.boundsM[0] &&
              expected[1] === result.tile.boundsM[1],
          });
        }),
      ).then(pump);
    };
    pump();
  });

  const wallMs = performance.now() - start;
  pool.dispose();
  tiles.sort((a, b) => a.key.localeCompare(b.key));
  return {
    release: { id: release.id, ver: release.surface.ver, maxLevel: release.surface.maxLevel },
    workers: DECODE_WORKERS,
    available,
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
