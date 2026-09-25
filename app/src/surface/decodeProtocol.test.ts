import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readExpectation, readExpectationBytes } from '../test/fixture';
import { handleDecodeMessage, type DecodeRequest } from './decodeProtocol';

interface SyntheticTile {
  name: string;
  key: string;
  wst: string;
}

const trench = readExpectation<SyntheticTile[]>('synthetic.json').find((t) => t.name === 'trench');
if (!trench) throw new Error('synthetic.json has no trench tile');
const tile: SyntheticTile = trench;

function request(changes: Partial<DecodeRequest> = {}): DecodeRequest {
  const buf = readExpectationBytes(tile.wst).buffer;
  return { type: 'decode', id: 7, key: tile.key, buf, ...changes };
}

describe('handleDecodeMessage', () => {
  it('replies with the decoded tile under the request id', async () => {
    const msg = request();
    const { reply } = await handleDecodeMessage(msg);
    if (reply.type !== 'decoded') throw new Error(reply.message);
    expect(reply.id).toBe(7);
    expect(reply.tile.compressed).toBe(msg.buf);
  });

  it('says how long the decode took', async () => {
    const { reply } = await handleDecodeMessage(request());
    if (reply.type !== 'decoded') throw new Error(reply.message);
    expect(reply.ms).toBeGreaterThan(0);
  });

  it('transfers every plane and the stored bytes, each once', async () => {
    const { reply, transfer } = await handleDecodeMessage(request());
    if (reply.type !== 'decoded') throw new Error(reply.message);
    const { heightMips, channelMips, edges, grid, compressed } = reply.tile;
    const planes = [...heightMips, ...channelMips, edges, grid].map((plane) => plane.buffer);
    const buffers = [...planes, compressed];
    expect(transfer).toHaveLength(buffers.length);
    expect(buffers.every((buf) => transfer.includes(buf))).toBe(true);
    // postMessage's rules: the clone moves every listed buffer, once, and detaches the originals.
    const moved = structuredClone(reply, { transfer });
    expect(buffers.every((buf) => buf.byteLength === 0)).toBe(true);
    expect(moved.tile.grid).toHaveLength(33 * 33);
  });

  it('replies with an error under the request id for bytes that are not a tile', async () => {
    const { reply, transfer } = await handleDecodeMessage(
      request({ id: 9, buf: new Uint8Array([1, 2, 3]).buffer }),
    );
    expect(reply).toMatchObject({ type: 'error', id: 9 });
    expect(transfer).toEqual([]);
  });

  it('replies with an error for bytes of another tile', async () => {
    const { reply } = await handleDecodeMessage(request({ key: '7/1/102/50' }));
    expect(reply).toEqual({
      type: 'error',
      id: 7,
      message: 'tile is 7/1/103/50, not 7/1/102/50',
    });
  });

  it('replies with an error for a key that names no tile', async () => {
    const { reply } = await handleDecodeMessage(request({ key: '7/6/0/0' }));
    expect(reply).toMatchObject({ type: 'error', id: 7 });
  });
});

describe('the decode worker', () => {
  // The worker's budget is 40 KB (streaming.md 6), so nothing it imports may pull in three.
  it('imports nothing from three', () => {
    const worker = fileURLToPath(new URL('../workers/decode.worker.ts', import.meta.url));
    const { modules, packages } = importClosure(worker);
    expect(modules.some((path) => path.endsWith(join('surface', 'wst.ts')))).toBe(true);
    expect(packages.filter((name) => name === 'three' || name.startsWith('three/'))).toEqual([]);
  });

  it('is checked by a scan that sees three where it is imported', () => {
    const test = fileURLToPath(new URL('./half.test.ts', import.meta.url));
    expect(importClosure(test).packages).toContain('three');
  });
});

// `import … from '…'`, `export … from '…'` and `import '…'`, at the start of a line.
const IMPORT =
  /^\s*(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm;

/** The app modules a file reaches through its static imports, and the packages they name. */
function importClosure(entry: string): { modules: string[]; packages: string[] } {
  const modules = new Set<string>();
  const packages = new Set<string>();
  const pending = [entry];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (modules.has(file)) continue;
    modules.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(IMPORT)) {
      const specifier = match[1] ?? match[2] ?? '';
      if (specifier.startsWith('.')) pending.push(resolve(dirname(file), `${specifier}.ts`));
      else if (!specifier.startsWith('@shared/')) packages.add(specifier);
    }
  }
  return { modules: [...modules], packages: [...packages] };
}
