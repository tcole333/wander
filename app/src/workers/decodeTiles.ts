// Fetches tiles of a surface layer as the runtime does (`inFlight` at once, cross-origin) and
// decodes them in the two decode workers, handing each decoded tile to `visit` as it lands. The test pages
// use it; the runtime's scheduler (5.2) does its own ordering and cancellation.
import { tunables } from '../config/tunables';
import { fetchData, type SurfaceLayer } from '../data/surfaceLayer';
import { tileKey, type Tile } from '../surface/cube';
import type { DecodedWst } from '../surface/wst';
import { DecodePool } from './decodePool';

/** Fetches in flight at once: the runtime's cap (5.2, `inFlight`). */
const IN_FLIGHT = tunables.inFlight.total;

export interface DecodedTile {
  key: string;
  tile: DecodedWst;
  /** Decode time in the worker, in milliseconds. */
  ms: number;
  /** Stored bytes fetched. */
  bytes: number;
}

/** Resolves with the tiles that failed, once every tile has been visited or has failed. */
export async function decodeTiles(
  layer: SurfaceLayer,
  tiles: Tile[],
  visit: (decoded: DecodedTile) => void | Promise<void>,
): Promise<{ key: string; error: string }[]> {
  const queue = [...tiles];
  const pool = DecodePool.create();
  const errors: { key: string; error: string }[] = [];
  const bytes = new Map<string, number>();
  let visited = 0;

  await new Promise<void>((done) => {
    let fetching = 0;
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
      if (visited + errors.length === tiles.length) done();
    };
    pool.onready = () => {
      void Promise.all(
        pool.drain().map(async (result) => {
          if ('error' in result) return errors.push(result);
          const { key, tile, ms } = result;
          await visit({ key, tile, ms, bytes: bytes.get(key) ?? 0 });
          visited += 1;
        }),
      ).then(pump);
    };
    pump();
  });

  pool.dispose();
  return errors;
}
