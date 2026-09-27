// The room (index.html's #room, room.css): the museum's dark room with the Wander mark in its
// lamp's pool. It is the page's poster until the walk's first live frame, which it crossfades
// into, and the ground a failure plate stands on: cast brass with a Reload control when the data
// does not arrive, and the story's own vellum card, its title and blurb, when this browser cannot
// draw the globe, its GPU keeps dropping it, or the boot stops on anything else. The card offers a
// Reload unless the browser cannot draw.
import type { Story } from '../story/story';
import { button, el } from '../story/ui/dom';
import { yearsLabel } from '../story/ui/format';

export class Room {
  readonly #element: HTMLElement;

  constructor(element: HTMLElement) {
    this.#element = element;
  }

  /** Crossfades from the poster into the live canvas under it. */
  open(): void {
    this.#element.classList.add('is-open');
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
  const plate = el('article', 'plate plate-card wu-card wu-lit');
  plate.setAttribute('role', 'alert');
  const sheet = el('div', 'wu-sheet');
  const head = el('header', 'wu-card-head');
  head.append(el('div', 'wu-date', yearsLabel(story.beats)), el('h1', 'wu-title', story.title));
  head.append(el('div', 'wu-rule'));
  const foot = el('footer', 'plate-foot');
  foot.append(el('p', 'plate-note', NOTES[why]));
  if (why !== 'cannot-draw') foot.append(reload());
  sheet.append(head, el('p', 'plate-blurb', story.blurb), foot);
  plate.append(sheet);
  return plate;
}

function reload(): HTMLButtonElement {
  const control = button('plate-button', 'Reload', () => location.reload());
  control.textContent = 'Reload';
  return control;
}
