// window.__wanderView, for scripts that render the production page (scripts/marksShots.ts): it sets
// the view at once and says when the globe has settled. Installed only on a page served from this
// machine that asks for it with ?hooks=1 (page/dataOrigin.ts).
import type { ViewState } from '../view/viewState';
import type { WalkPage } from '../walk/boot';

export interface WanderViewHook {
  /** Sets the view at once. */
  go(view: ViewState): void;
  /** The view as drawn. */
  view(): ViewState;
  /**
   * The view has settled and the streamer has been idle for a while, with a story's border beat
   * holding its step.
   */
  ready(): boolean;
}

declare global {
  interface Window {
    __wanderView?: WanderViewHook;
  }
}

/** Serves window.__wanderView for `walk`; returns what removes it. */
export function installViewHook(walk: Pick<WalkPage, 'control' | 'stats' | 'ready'>): () => void {
  const hook: WanderViewHook = {
    go: (view) => walk.control.go(view, true),
    view: () => walk.stats().view,
    ready: () => walk.ready(),
  };
  window.__wanderView = hook;
  return () => {
    if (window.__wanderView === hook) delete window.__wanderView;
  };
}
