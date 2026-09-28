// The room (index.html's #room, room.css): the museum's dark room with the Wander mark in its
// lamp's pool. It is the page's poster until the walk's first live frame, which it crossfades
// into, its mark gliding onto the page's own as it goes, and the ground a failure plate stands on: cast brass with a Reload control when the data
// does not arrive, and the story's own vellum card, its title and blurb, when this browser cannot
// draw the globe, its GPU keeps dropping it, or the boot stops on anything else. The card offers a
// Reload unless the browser cannot draw.
import type { Story } from '../story/story';
import { button, el } from '../story/ui/dom';
import { yearsLabel } from '../story/ui/format';

/** How long the poster's mark takes to glide onto the page's, in ms. */
const GLIDE_MS = 1200;
/** How long it takes to fade over the page's mark once there, in ms. */
const HANDOFF_MS = 250;

export class Room {
  readonly #element: HTMLElement;

  constructor(element: HTMLElement) {
    this.#element = element;
  }

  /**
   * Crossfades from the poster into the live canvas under it. Given the page's own mark (`onto`),
   * the poster's mark lifts out of the fading room and glides onto it, and the page's mark stands
   * in its place from the moment it lands; the promise resolves once the poster's mark is back in
   * the room.
   */
  async open(onto?: HTMLElement): Promise<void> {
    const mark = this.#element.querySelector<HTMLElement>('.room-mark');
    if (!onto || !mark) {
      this.#element.classList.add('is-open');
      return;
    }
    onto.style.visibility = 'hidden';
    const from = mark.getBoundingClientRect();
    const to = onto.getBoundingClientRect();
    mark.classList.add('is-gliding');
    Object.assign(mark.style, {
      left: `${from.left}px`,
      top: `${from.top}px`,
      width: `${from.width}px`,
    });
    document.body.append(mark);
    this.#element.classList.add('is-open');

    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const landed = `translate(${dx}px, ${dy}px) scale(${to.width / from.width})`;
    const glide = mark.animate([{ transform: 'none' }, { transform: landed }], {
      duration: GLIDE_MS,
      easing: 'ease-in-out',
      fill: 'forwards',
    });
    await glide.finished;
    Object.assign(onto.style, { visibility: 'visible', opacity: '1', transition: 'none' });
    await mark.animate([{ opacity: 1 }, { opacity: 0 }], { duration: HANDOFF_MS, fill: 'forwards' })
      .finished;

    for (const animation of mark.getAnimations()) animation.cancel();
    mark.classList.remove('is-gliding');
    mark.removeAttribute('style');
    this.#element.prepend(mark);
  }

  /** Brings the room back if it had opened, with `plate` standing under the mark. */
  fail(plate: HTMLElement): void {
    this.#element.querySelector('.plate')?.remove();
    this.#element.classList.remove('is-open');
    this.#element.append(plate);
    plate.querySelector('button')?.focus();
  }
}

/**
 * Why the story's card stands in the room: the browser cannot draw, the GPU dropped it twice, or
 * the boot stopped on something else.
 */
export type Unable = 'cannot-draw' | 'lost-twice' | 'stopped';

const NOTES: Record<Unable, string> = {
  'cannot-draw':
    'This browser cannot draw the globe. It needs WebGL 2 with hardware acceleration turned on, as in current Chrome, Safari or Firefox.',
  'lost-twice':
    'The graphics card reset twice in a few minutes. Close other heavy tabs, then reload.',
  stopped: 'The globe stopped before it was ready. Reload to try again.',
};

/** Data that did not arrive: a cast brass plate with a Reload control. */
export function dataPlate(): HTMLElement {
  const plate = el('section', 'plate plate-brass wu-brass wu-lit');
  plate.setAttribute('role', 'alert');
  plate.append(
    el('h1', 'plate-head', 'The globe did not arrive'),
    el('p', 'plate-text', 'The connection broke before the globe’s relief came through.'),
    reload(),
  );
  return plate;
}

/** The story's card in vellum and brass, its title and blurb, and why the globe is not drawn. */
export function storyPlate(story: Story, why: Unable): HTMLElement {
  return storiesPlate([story], why);
}

/** Before a choice, both stories stand in the room with the same explanation. */
export function lobbyPlate(stories: readonly Story[], why: Unable): HTMLElement {
  return storiesPlate(stories, why);
}

function storiesPlate(stories: readonly Story[], why: Unable): HTMLElement {
  const plate = el('article', 'plate plate-card wu-card wu-lit');
  plate.setAttribute('role', 'alert');
  const sheet = el('div', 'wu-sheet');
  for (const story of stories) {
    const head = el('header', 'wu-card-head');
    head.append(el('div', 'wu-date', yearsLabel(story.beats)), el('h1', 'wu-title', story.title));
    head.append(el('div', 'wu-rule'));
    sheet.append(head, el('p', 'plate-blurb', story.blurb));
  }
  const foot = el('footer', 'plate-foot');
  foot.append(el('p', 'plate-note', NOTES[why]));
  if (why !== 'cannot-draw') foot.append(reload());
  sheet.append(foot);
  plate.append(sheet);
  return plate;
}

function reload(): HTMLButtonElement {
  const control = button('plate-button', 'Reload', () => location.reload());
  control.textContent = 'Reload';
  return control;
}
