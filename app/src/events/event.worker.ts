import { EventRuntime, type EventRequest } from './runtime';
const runtime = new EventRuntime();
self.onmessage = (event: MessageEvent<EventRequest>) => {
  // The client admits only one page at a time. Queries can use the overview while that page
  // awaits inflation; parsing and every query still run synchronously on this one worker.
  void runtime.handle(event.data).then((reply) => self.postMessage(reply));
};
