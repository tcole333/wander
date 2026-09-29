// Where the production entry reads its data. The public page reads the bundled release only; a page
// served from this machine may name a local data server instead (npm run data, streaming.md 7.3)
// with ?data=<origin>, or one of the local bakes' servers by name, and reads that server's
// /release.json. Such a page may also ask for the memory account (?memory=1) and for Explore before
// it goes live (?explore). The public page never asks: a query on any other host is ignored.

/** The local bakes' data servers by name, on the ports scripts/dataServer.ts gives them. */
export const DATA_SERVERS: Readonly<Record<string, string>> = {
  fixture: 'http://127.0.0.1:8791',
  region: 'http://127.0.0.1:8792',
  global: 'http://127.0.0.1:8793',
};

/** The hostnames a page on this machine is served from. */
export const LOOPBACK: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** The memory account is opt-in even on loopback; public URLs can never switch it on. */
export function memoryRequested(page: { hostname: string; search: string }): boolean {
  return LOOPBACK.has(page.hostname) && new URLSearchParams(page.search).get('memory') === '1';
}

/**
 * Whether a page on this machine asks for Explore before it goes live: ?explore (not ?explore=0).
 * Public URLs can never switch it on.
 */
export function exploreRequested(page: { hostname: string; search: string }): boolean {
  const query = new URLSearchParams(page.search);
  return LOOPBACK.has(page.hostname) && query.has('explore') && query.get('explore') !== '0';
}

/** The data server a page asks for, or null for the bundled release. */
export function dataOverride(page: { hostname: string; search: string }): string | null {
  if (!LOOPBACK.has(page.hostname)) return null;
  const asked = new URLSearchParams(page.search).get('data');
  if (asked === null) return null;
  const origin = DATA_SERVERS[asked] ?? asked;
  return URL.canParse(origin) ? new URL(origin).origin : null;
}
