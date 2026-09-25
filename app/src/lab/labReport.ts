// Lab pages report what they measured by posting it to the Vite dev server, which writes it to
// build/lab/<what>-<browser>.json (e2e/lab/reports.ts). This is how pages opened in the installed
// Safari and Firefox, which Playwright does not drive here, hand their results to the lab specs. A
// page reports only when its URL names the browser with ?report=<browser>, so specs that read a
// page's result directly leave nothing behind.

/** Where the dev server takes reports; the report's name follows. */
export const LAB_REPORT_PATH = '/__lab/report/';

/** A report name: the page's `what`, then the browser, in lowercase words joined by hyphens. */
export const LAB_REPORT_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** What build/lab/<what>-<browser>.json holds: the page's report, or the error that stopped it. */
export interface LabReport<T> {
  what: string;
  browser: string;
  date: string;
  userAgent: string;
  report?: T;
  error?: string;
}

/** The browser named by ?report=, or null when the page should not report. */
export function reportingBrowser(): string | null {
  return new URLSearchParams(location.search).get('report');
}

/** Posts the page's report as build/lab/<what>-<browser>.json. */
export async function postLabReport<T>(what: string, browser: string, report: T): Promise<void> {
  await post({ ...envelope(what, browser), report });
}

/**
 * Posts any uncaught error or rejection in place of the report, so a spec waiting on a page in
 * another browser fails with the page's error instead of timing out.
 */
export function reportFailures(what: string, browser: string): void {
  const fail = (reason: unknown) => {
    const error = reason instanceof Error ? `${reason.message}\n${reason.stack ?? ''}` : reason;
    void post({ ...envelope(what, browser), error: String(error) });
  };
  window.addEventListener('error', (event) => fail(event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => fail(event.reason));
}

function envelope(what: string, browser: string): LabReport<never> {
  const name = `${what}-${browser}`;
  if (!LAB_REPORT_NAME.test(name)) throw new Error(`bad lab report name ${name}`);
  return { what, browser, date: new Date().toISOString(), userAgent: navigator.userAgent };
}

async function post<T>(body: LabReport<T>): Promise<void> {
  const response = await fetch(`${LAB_REPORT_PATH}${body.what}-${body.browser}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`lab report ${body.what}: HTTP ${response.status}`);
}
