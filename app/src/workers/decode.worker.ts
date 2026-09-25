// A decode worker (streaming.md 5.1): stateless, it decodes what the main thread sends and
// transfers the results back with the stored bytes. It must not import three (40 KB budget).
import { handleDecodeMessage, type DecodeRequest } from '../surface/decodeProtocol';

self.onmessage = (event: MessageEvent<DecodeRequest>) => {
  void handleDecodeMessage(event.data).then(({ reply, transfer }) => {
    self.postMessage(reply, { transfer });
  });
};
