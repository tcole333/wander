// The servers playwright.config.ts starts. vite preview serves the production build; the Vite
// dev server serves test-only pages (e2e/*.html), which never reach that build; the local data
// servers (scripts/dataServer.ts) serve the fixture build and, for lab runs, the region bake, each
// on an origin of its own, as R2 would.
import { DATA_PORTS } from '../scripts/dataServer';

// e2e's own ports, which no manual command defaults to (vite preview takes 4173, npm run data
// 8791-8793), so a server someone started by hand never collides with a run. The run starts all
// three itself and refuses one already listening: the e2e lock (scripts/slot.sh) lets one run at
// a time use them, and slot.sh stops any server a killed run left there before the next starts.
// Its WANDER_E2E_PORTS default names the same ports.
export const PREVIEW_PORT = 6273;
export const DEV_PORT = 6274;
export const FIXTURE_DATA_PORT = 6275;
export const PREVIEW_URL = `http://127.0.0.1:${PREVIEW_PORT}`;
export const DEV_URL = `http://127.0.0.1:${DEV_PORT}`;
export const DATA_URL = {
  fixture: `http://127.0.0.1:${FIXTURE_DATA_PORT}`,
  region: `http://127.0.0.1:${DATA_PORTS.region}`,
  global: `http://127.0.0.1:${DATA_PORTS.global}`,
};
