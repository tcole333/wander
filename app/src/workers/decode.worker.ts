// A decode worker (streaming.md 5.1): stateless, it decodes what the main thread sends and
// transfers the results back with the stored bytes. It must not import three (40 KB budget).
// Requests decode one at a time in arrival order: decodes interleaved at their awaits would all
// finish late, when the main thread submits coarsest first (5.2).
import { handleDecodeMessage, type DecodeRequest } from '../surface/decodeProtocol';

let queue = Promise.resolve();

self.onmessage = (event: MessageEvent<DecodeRequest>) => {
  queue = queue.then(async () => {
    const { reply, transfer } = await handleDecodeMessage(event.data);
    self.postMessage(reply, { transfer });
  });
};
