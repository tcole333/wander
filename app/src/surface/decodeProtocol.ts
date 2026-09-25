// Messages between the main thread and a decode worker (streaming.md 5.1). The handler is a pure
// function so it can be tested without a worker; decode.worker.ts only posts what it returns.
import { parseTileKey } from './cube';
import { decodeWst, type DecodedWst } from './wst';

export interface DecodeRequest {
  type: 'decode';
  id: number;
  /** The tile key `L/f/x/y` the bytes were fetched for. */
  key: string;
  /** The stored .wst, transferred in and handed back in the reply. */
  buf: ArrayBuffer;
}

export type DecodeReply =
  | {
      type: 'decoded';
      id: number;
      tile: DecodedWst;
      /** Milliseconds spent decoding. */ ms: number;
    }
  | { type: 'error'; id: number; message: string };

/** The reply to a request and the buffers to transfer with it: every plane and the stored bytes. */
export async function handleDecodeMessage(
  msg: DecodeRequest,
): Promise<{ reply: DecodeReply; transfer: Transferable[] }> {
  try {
    if (msg.type !== 'decode') throw new Error(`unknown message type ${String(msg.type)}`);
    const start = performance.now();
    const tile = await decodeWst(msg.buf, parseTileKey(msg.key));
    const ms = performance.now() - start;
    const planes = [...tile.heightMips, ...tile.channelMips, tile.edges, tile.grid];
    return {
      reply: { type: 'decoded', id: msg.id, tile, ms },
      transfer: [...planes.map((plane) => plane.buffer), tile.compressed],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { reply: { type: 'error', id: msg.id, message }, transfer: [] };
  }
}
