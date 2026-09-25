// The servers playwright.config.ts starts. vite preview serves the production build; the Vite
// dev server serves test-only pages (e2e/*.html), which never reach that build.
export const PREVIEW_PORT = 4173;
export const DEV_PORT = 4174;
export const PREVIEW_URL = `http://127.0.0.1:${PREVIEW_PORT}`;
export const DEV_URL = `http://127.0.0.1:${DEV_PORT}`;
