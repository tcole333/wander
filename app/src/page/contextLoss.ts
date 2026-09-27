// What the page does when the GPU takes its WebGL context away: reload, which boots the walk
// again, unless it already reloaded for a loss a few minutes ago; then it rests on a plate, so a
// failing GPU never loops the page. The last loss's time lives in sessionStorage, which a browser
// may refuse; with no way to count, the page rests.

/** How long after a loss a second one counts as the GPU failing again. */
export const LOSS_WINDOW_MS = 5 * 60_000;

const KEY = 'wander:context-lost';

export type AfterLoss = 'reload' | 'rest';

/** Records a loss at `now` and says what to do about it. */
export function afterContextLoss(storage: () => Storage, now: number): AfterLoss {
  try {
    const store = storage();
    const last = Number(store.getItem(KEY));
    if (last > 0 && now - last < LOSS_WINDOW_MS) return 'rest';
    store.setItem(KEY, String(now));
    return 'reload';
  } catch {
    return 'rest';
  }
}
