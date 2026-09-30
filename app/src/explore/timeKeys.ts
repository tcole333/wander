// Explore's keys for time (explore/timeRuler.ts), in the pattern of the walks' bindWalkKeys: with
// nothing focused, the arrow keys move time as they do in the stories. Left and Right step to the
// tape's next fine tick (held, they glide), with Shift to its next labelled one; Up and Down show
// more or fewer years, a detent at a time; PageUp and PageDown move a span; Home and End fly to
// history's ends; a digit opens the plaque's date entry with it; Backspace flies back to where the
// last jump left from. The Years shown slider takes Left and Right for fewer and more years, and
// Home and End for the closest and widest.
//
// The globe keeps + and - everywhere (view/viewControl.ts), and gets the arrow keys from a stop of
// its own in the tab order, a hidden Globe: while it has the focus the view control's arrowKeys is
// on, and a small plate at the top names it, as the events' listbox's does. arrowKeys is off at
// every other time in Explore. The listbox keeps its own arrows, and a text field its keys.
import type { ExploreTime } from '../time/exploreTime';
import { MAX_EXPLORE_DAYS, MIN_EXPLORE_DAYS } from '../time/exploreTime';
import { el } from '../story/ui/dom';
import { isFormField, type ViewControl } from '../view/viewControl';
import type { TimeRuler } from './timeRuler';

/** The Globe stop's accessible name and the plate that names it while it has the focus. */
export const GLOBE_STOP = 'Globe';

export type TimeKeysRuler = Pick<
  TimeRuler,
  'plaque' | 'counter' | 'openEntry' | 'sayDate' | 'sayYears'
>;

export interface TimeKeys {
  /** The Globe stop, which Explore's layer holds after the ruler. */
  readonly globe: HTMLElement;
  /** The plate naming the Globe stop while it has the focus. */
  readonly caption: HTMLElement;
  dispose(): void;
}

type Target = 'time' | 'years' | 'globe';

/** Whose keys a key down on `target` is: the Years shown slider's, the Globe's, or time's. */
function targetOf(target: EventTarget | null, ruler: TimeKeysRuler, globe: HTMLElement): Target {
  if (target !== null && ruler.counter.contains(target as Node)) return 'years';
  if (target === globe) return 'globe';
  return 'time';
}

/**
 * Binds Explore's time keys on the window and makes the Globe stop, whose focus hands the arrow
 * keys to `control`. Returns them, and a function that removes it all.
 */
export function bindTimeKeys(
  time: ExploreTime,
  ruler: TimeKeysRuler,
  control: Pick<ViewControl, 'arrowKeys'>,
): TimeKeys {
  const listeners = new AbortController();
  const { signal } = listeners;
  const globe = el('div', 'xt-globe');
  globe.tabIndex = 0;
  globe.setAttribute('role', 'application');
  globe.setAttribute('aria-label', GLOBE_STOP);
  globe.setAttribute('aria-roledescription', 'globe');
  const caption = el('div', 'xl-focus xt-globe-name', GLOBE_STOP);
  caption.setAttribute('aria-hidden', 'true');
  control.arrowKeys = false;
  globe.addEventListener(
    'focus',
    () => {
      control.arrowKeys = true;
      caption.classList.add('is-shown');
    },
    { signal },
  );
  globe.addEventListener(
    'blur',
    () => {
      control.arrowKeys = false;
      caption.classList.remove('is-shown');
    },
    { signal },
  );

  /** The arrow held down, which glides until its key comes up. */
  let held: string | null = null;
  const letGo = () => {
    if (held === null) return;
    held = null;
    time.letGo();
  };

  const jumped = () => ruler.sayDate(time.target.day);
  addEventListener(
    'keydown',
    (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isFormField(event.target)) return;
      const target = targetOf(event.target, ruler, globe);
      const { key } = event;
      if (/^[0-9]$/.test(key)) {
        ruler.openEntry(key);
      } else if (key === 'Backspace') {
        if (time.back()) jumped();
      } else if (key === 'PageUp' || key === 'PageDown') {
        time.step(key === 'PageUp' ? 1 : -1, 'span');
      } else if (target === 'globe') {
        // The globe's arrows are the view control's, which took them first; Home and End reach
        // history's ends from here too.
        if (key === 'Home' || key === 'End') {
          time.toEnd(key === 'Home' ? 'start' : 'end');
          jumped();
        } else return;
      } else if (key === 'ArrowUp' || key === 'ArrowDown') {
        const dir = key === 'ArrowUp' ? 1 : -1;
        time.detent(dir);
        ruler.sayYears(time.target.span);
      } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
        const dir = key === 'ArrowRight' ? 1 : -1;
        if (target === 'years') {
          time.detent(dir);
          ruler.sayYears(time.target.span);
        } else if (event.shiftKey) {
          time.step(dir, 'label');
        } else if (!event.repeat) {
          letGo();
          held = key;
          time.hold(dir);
        }
      } else if (key === 'Home' || key === 'End') {
        if (target === 'years') {
          time.fly(time.target.day, key === 'Home' ? MIN_EXPLORE_DAYS : MAX_EXPLORE_DAYS);
          ruler.sayYears(time.target.span);
        } else {
          time.toEnd(key === 'Home' ? 'start' : 'end');
          jumped();
        }
      } else return;
      event.preventDefault();
    },
    { signal },
  );
  addEventListener(
    'keyup',
    (event) => {
      if (event.key === held) letGo();
    },
    { signal },
  );
  addEventListener('blur', letGo, { signal });

  return {
    globe,
    caption,
    dispose() {
      letGo();
      listeners.abort();
      control.arrowKeys = false;
      globe.remove();
      caption.remove();
    },
  };
}
