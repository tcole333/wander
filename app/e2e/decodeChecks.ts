// What the decode specs compare a browser's decode against: Node's decodeWst of the same stored
// bytes, digested the same way as src/workers/decodeProbe.ts digests the workers' output.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTileKey } from '../src/surface/cube';
import { decodeWst } from '../src/surface/wst';
import { decodedPlanes, type DecodeProbeReport } from '../src/workers/decodeProbe';

/** Each tile's digest as Node decodes it, from a layer folder `build/<profile>/surf/<ver>/`. */
export async function nodeDigests(layer: string, keys: string[]): Promise<Map<string, string>> {
  const digests = new Map<string, string>();
  for (const key of keys) {
    const stored = new Uint8Array(readFileSync(join(layer, `${key}.wst`)));
    const tile = await decodeWst(stored.buffer, parseTileKey(key));
    const hash = createHash('sha256');
    for (const plane of decodedPlanes(tile)) hash.update(plane);
    digests.set(key, hash.digest('hex'));
  }
  return digests;
}

/** Keys whose browser digest differs from Node's, or that Node has and the browser lacks. */
export function mismatches(report: DecodeProbeReport, node: Map<string, string>): string[] {
  const browser = new Map(report.tiles.map((tile) => [tile.key, tile.digest]));
  return [...node].filter(([key, digest]) => browser.get(key) !== digest).map(([key]) => key);
}
