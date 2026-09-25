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
  /** The run that opened the page (e2e/lab/external.ts), so a spec never takes another's report. */
  run: string | null;
  date: string;
  userAgent: string;
  /**
   * Whether the page was hidden when it asked to report and when it posted. Browsers throttle
   * hidden pages, so timings from one are not foreground timings.
   */
  hidden: { atStart: boolean; atPost: boolean };
  report?: T;
  error?: string;
}

/** Where a page reports: from ?report=<browser> and, for pages a spec opened, ?run=<token>. */
export interface LabTarget {
  what: string;
  browser: string;
  run: string | null;
  hiddenAtStart: boolean;
}

/** The page's report target, or null when its URL does not ask it to report. */
export function labTarget(what: string): LabTarget | null {
  const params = new URLSearchParams(location.search);
  const browser = params.get('report');
  if (browser === null) return null;
  const name = `${what}-${browser}`;
  if (!LAB_REPORT_NAME.test(name)) throw new Error(`bad lab report name ${name}`);
  return { what, browser, run: params.get('run'), hiddenAtStart: document.hidden };
}

/** Posts the page's report as build/lab/<what>-<browser>.json. */
export async function postLabReport<T>(target: LabTarget, report: T): Promise<void> {
  try {
    await post(target, { report });
  } finally {
    leave(target);
  }
}

/**
 * Posts the first uncaught error or rejection in place of the report, so a spec waiting on a page
 * in another browser fails with the page's error instead of timing out. A failed post is dropped:
 * its rejection must not come back through the handler as another error to report.
 */
export function reportFailures(target: LabTarget): void {
  let reported = false;
  const fail = (reason: unknown) => {
    if (reported) return;
    reported = true;
    const error = reason instanceof Error ? `${reason.message}\n${reason.stack ?? ''}` : reason;
    post(target, { error: String(error) })
      .catch(() => undefined)
      .finally(() => leave(target));
  };
  window.addEventListener('error', (event) => fail(event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => fail(event.reason));
}

async function post<T>(target: LabTarget, body: Pick<LabReport<T>, 'report' | 'error'>) {
  const { what, browser, run, hiddenAtStart } = target;
  const report: LabReport<T> = {
    what,
    browser,
    run,
    date: new Date().toISOString(),
    userAgent: navigator.userAgent,
    hidden: { atStart: hiddenAtStart, atPost: document.hidden },
    ...body,
  };
  const response = await fetch(`${LAB_REPORT_PATH}${target.what}-${target.browser}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  });
  if (!response.ok) throw new Error(`lab report ${target.what}: HTTP ${response.status}`);
}

/**
 * A page a spec opened in Safari or Firefox leaves once it has reported, so a later dev server's
 * reconnect reload cannot run the probe again in a tab nobody is watching.
 */
function leave(target: LabTarget): void {
  if (target.run !== null) location.replace('about:blank');
}
