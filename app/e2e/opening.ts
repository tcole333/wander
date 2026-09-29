// The room's opening, as the production build's smoke tests watch it: once #room opens, every face
// and worker has come with the boot, so nothing more is fetched from the app's own host.
import type { Page } from '@playwright/test';

declare global {
  interface Window {
    /** When #room took is-open, on the page's clock. */
    roomOpenedAt?: number;
  }
}

/**
 * Marks the moment the room opens on the page's own clock, which a poll from the test would see
 * late, and keeps every resource entry from then on.
 */
export async function markOpening(page: Page): Promise<void> {
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(100_000);
    const watch = new MutationObserver(() => {
      if (!document.getElementById('room')?.classList.contains('is-open')) return;
      window.roomOpenedAt = performance.now();
      watch.disconnect();
    });
    watch.observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
}

/** What the page has fetched from `origin` since the room opened. */
export function fetchedSinceOpening(page: Page, origin: string): Promise<string[]> {
  return page.evaluate((from) => {
    const opened = window.roomOpenedAt;
    if (opened === undefined) throw new Error('the room never opened');
    return performance
      .getEntriesByType('resource')
      .filter((entry) => entry.startTime >= opened && new URL(entry.name).origin === from)
      .map((entry) => entry.name);
  }, origin);
}
