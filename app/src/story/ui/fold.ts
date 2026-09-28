// The fold on the beat card and on Meanwhile: a small brass knob in the panel's head, the sound
// knob's metal in miniature (soundKnob.ts) with a chevron cut into its face. Pressing it folds the
// panel down to its head, and pressing it again unfolds the panel. What folds away is a grid row
// that shrinks to nothing, as the card's sources do (card.ts), and stays out of reach of the
// keyboard and of screen readers while folded. A fold holds across beats and across stories, and
// is remembered per viewer in localStorage, as the mute is (audio/walkAudio.ts); where storage
// refuses, it holds for this visit alone.
import { button, el, passFocus, svg } from './dom';
import { smallKnob } from './rulerCraft';

/** The knob's radius, px, as walkUi.css sizes it. */
const RADIUS = 12;
/** The chevron: its point up while the panel is open, and turned over once it is folded. */
const CHEVRON = 'M-4 1.9 L0 -2.1 L4 1.9';

/** The folds storage would not keep, which hold for this visit alone. */
const unsaved = new Map<string, boolean>();

interface FoldOptions {
  /** Names the fold's stored key, its region and its knob's metal. */
  id: 'card' | 'meanwhile';
  /** The knob's name, for assistive technology. */
  name: string;
  /** The panel, which wears `is-folded`; what folds away lies inside it, in `content`. */
  panel: HTMLElement;
  content: HTMLElement[];
  /** Called once the panel has been folded or unfolded. */
  changed?: () => void;
}

export class Fold {
  readonly control: HTMLButtonElement;
  /** Holds what folds away, and stands in the panel where that would. */
  readonly region = el('div', 'wu-fold');
  readonly #panel: HTMLElement;
  readonly #key: string;
  readonly #changed: () => void;
  #folded: boolean;

  constructor({ id, name, panel, content, changed = () => {} }: FoldOptions) {
    this.#panel = panel;
    this.#key = `wander.fold.${id}`;
    this.#changed = changed;
    const inside = el('div', 'wu-fold-in');
    inside.append(...content);
    this.region.id = `wu-fold-${id}`;
    this.region.append(inside);

    this.control = button('wu-fold-knob', name, () => this.set(!this.#folded));
    this.control.setAttribute('aria-controls', this.region.id);
    this.control.append(smallKnob(`wu-fold-${id}`, RADIUS), chevron());
    this.#folded = readFolded(this.#key);
    this.#show();
  }

  get folded(): boolean {
    return this.#folded;
  }

  set(folded: boolean): void {
    if (folded === this.#folded) return;
    // A keyboard visitor inside what folds away keeps their place, at the knob.
    if (folded) passFocus(this.region, this.control);
    this.#folded = folded;
    writeFolded(this.#key, folded);
    this.#show();
    this.#changed();
  }

  #show(): void {
    this.#panel.classList.toggle('is-folded', this.#folded);
    this.region.inert = this.#folded;
    this.control.setAttribute('aria-expanded', String(!this.#folded));
    this.control.title = this.#folded ? 'Unfold' : 'Fold';
  }
}

/** The chevron, cut twice as the sound knob's speaker is: its lit lip, then the niello. */
function chevron(): SVGSVGElement {
  const face = svg('svg', {
    class: 'wu-fold-mark',
    viewBox: `${-RADIUS} ${-RADIUS} ${2 * RADIUS} ${2 * RADIUS}`,
    'aria-hidden': 'true',
  });
  const lip = svg('g', { transform: 'translate(0.4 0.7)' });
  lip.append(svg('path', { d: CHEVRON, class: 'wu-niello-line wu-lip' }));
  face.append(lip, svg('path', { d: CHEVRON, class: 'wu-niello-line' }));
  return face;
}

function readFolded(key: string): boolean {
  const visit = unsaved.get(key);
  if (visit !== undefined) return visit;
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFolded(key: string, folded: boolean): void {
  try {
    localStorage.setItem(key, folded ? '1' : '0');
    unsaved.delete(key);
  } catch {
    // Storage refused (blocked site data, say): the fold holds for this visit only.
    unsaved.set(key, folded);
  }
}
