// The servers playwright.config.ts starts. vite preview serves the production build; the Vite
// dev server serves test-only pages (e2e/*.html), which never reach that build; the local data
// servers (scripts/dataServer.ts) serve the fixture build and, for lab runs, the region bake, each
// on an origin of its own, as R2 would.
import { DATA_PORTS } from '../scripts/dataServer';

export const PREVIEW_PORT = 4173;
export const DEV_PORT = 4174;
export const PREVIEW_URL = `http://127.0.0.1:${PREVIEW_PORT}`;
export const DEV_URL = `http://127.0.0.1:${DEV_PORT}`;
export const DATA_URL = {
  fixture: `http://127.0.0.1:${DATA_PORTS.fixture}`,
  region: `http://127.0.0.1:${DATA_PORTS.region}`,
};
