// The lobby's DOM (lobby.css): the Wander mark where the walk has it, the Credits link engraved at
// the top right, and at the left a column with a heading and the story's plaque in dark cast
// brass: an engraved medallion (Tambora's volcano, milestone 1's one story), the title, the years
// and the blurb, a Begin line at its foot, and an ember that wakes in its socket when the plaque
// is hovered or focused. The plaque is a button, so Tab reaches it and Enter or Space chooses it. The column fades in as the
// opening ends and slides away once the plaque is chosen.
import '@fontsource/libre-baskerville/400.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/400-italic.css';
import '../story/ui/tokens.css';
import '../story/ui/walkUi.css';
import './lobby.css';
import { creditsLink } from '../page/creditsPanel';
import type { Story } from '../story/story';
import { el, svg } from '../story/ui/dom';
import { yearsLabel } from '../story/ui/format';

export class Plaques {
  /** The lobby's layer, over the canvas as the walk's UI is. */
  readonly element = el('div', 'wu lobby');
  /** The Wander mark, where the walk's stands. */
  readonly mark = mark();
  readonly #column = el('nav', 'lobby-column');

  /** The plaque for `story`; choosing it calls `onChoose`. */
  constructor(story: Story, onChoose: () => void) {
    this.#column.setAttribute('aria-label', 'Stories');
    const rule = el('div', 'lobby-rule');
    this.#column.append(el('h2', 'lobby-head', 'Choose a story'), rule);
    this.#column.append(plaque(story, onChoose));
    this.element.append(this.mark, this.#column, creditsLink('lobby-credits'));
  }

  /** How far right the column reaches where it stands, in CSS px (its slide aside). */
  reach(): number {
    return this.#column.offsetLeft + this.#column.offsetWidth;
  }

  /** The mark, the column and the Credits link come in. */
  show(): void {
    this.element.classList.add('is-shown');
  }

  /**
   * The column and the Credits link slide away, the mark going at once, since the walk's own mark
   * takes its place. Resolves once they have gone.
   */
  leave(): Promise<void> {
    this.mark.remove();
    this.element.classList.add('is-leaving');
    (document.activeElement as HTMLElement | null)?.blur();
    return new Promise((done) => setTimeout(done, LEAVE_MS));
  }

  dispose(): void {
    this.element.remove();
  }
}

/** How long the column takes to slide away (lobby.css). */
const LEAVE_MS = 600;

/** The walk's mark: WANDER over a rule and its line, where the walk's UI has it. */
function mark(): HTMLElement {
  const header = el('header', 'wu-mark');
  const rule = el('div', 'wu-mark-rule');
  rule.append(el('span'), el('i', undefined, '✦'), el('span'));
  header.append(
    el('div', 'wu-mark-word', 'WANDER'),
    rule,
    el('div', 'wu-mark-sub', 'AN INTERACTIVE HISTORY'),
  );
  return header;
}

function plaque(story: Story, choose: () => void): HTMLButtonElement {
  const button = el('button', 'lobby-plaque wu-brass wu-lit');
  button.type = 'button';
  button.addEventListener('click', choose);
  const words = el('span', 'lobby-words');
  words.append(
    el('span', 'lobby-title', story.title),
    el('span', 'lobby-years', yearsLabel(story.beats)),
    el('span', 'lobby-blurb', story.blurb),
  );
  const ember = el('span', 'lobby-ember');
  ember.setAttribute('aria-hidden', 'true');
  const begin = el('span', 'lobby-begin', 'Begin');
  const hand = el('span', 'lobby-begin-hand', '☞');
  hand.setAttribute('aria-hidden', 'true');
  begin.append(hand);
  button.append(medallion(), words, ember, begin);
  return button;
}

/**
 * The medallion: a brass bezel around a dark face engraved with a volcano under its ash column,
 * cut in gilt with its shadow under each stroke, and a crater that glows with the plaque's ember.
 */
function medallion(): SVGSVGElement {
  const face = svg('svg', { viewBox: '0 0 60 60', class: 'lobby-medal', 'aria-hidden': 'true' });
  const defs = svg('defs');
  const rim = svg('linearGradient', { id: 'lobby-rim', x1: 0, y1: 0, x2: 1, y2: 1 });
  for (const [offset, color] of [
    [0, '#f6e0aa'],
    [0.25, '#c9a263'],
    [0.6, '#7a5a2a'],
    [1, '#3e2c13'],
  ] as const) {
    rim.append(svg('stop', { offset, 'stop-color': color }));
  }
  const well = svg('radialGradient', { id: 'lobby-well', cx: 0.38, cy: 0.32, r: 0.8 });
  for (const [offset, color] of [
    [0, '#3a2c1c'],
    [0.55, '#1a130c'],
    [1, '#0b0805'],
  ] as const) {
    well.append(svg('stop', { offset, 'stop-color': color }));
  }
  const clip = svg('clipPath', { id: 'lobby-face' });
  clip.append(svg('circle', { cx: 30, cy: 30, r: 23.4 }));
  defs.append(rim, well, clip);

  const engraving = [
    // The sea, and a few waves on it.
    'M6 43.5H54',
    'M11 47.5h5M20 47.5h7M33 47.5h6M43 47.5h5M15 51.5h6M26 51.5h8M38 51.5h5',
    // The mountain, its crater, and gullies down its flanks.
    'M11 43.5L23.4 29.6Q25 28 26.4 28.3L27.6 26.8H32.4L33.6 28.3Q35 28 36.6 29.6L49 43.5',
    'M26 31.5L22.5 37.5M29 30.5L27.6 38M31.6 31L32.8 37.2M34.6 31.6L38.4 37',
    // The ash column, billowing up and leaning west.
    'M28.3 26.4C26.4 24.6 26 22.3 27.5 20.8C25.2 19.9 24.6 17 26.7 15.6C25.4 13.2 27.6 10.6 30.4 11.4',
    'M30.4 11.4C31.4 9.3 35 9.4 35.7 11.9C38.2 12 39.2 14.8 37.4 16.4C39 17.9 38 20.6 35.6 20.5',
    'M35.6 20.5C35.4 22.6 33.4 23.8 31.6 23.2C31.3 24.6 31.6 25.8 31.7 26.4',
  ].join('');
  const cut = svg('g', { 'clip-path': 'url(#lobby-face)', fill: 'none' });
  cut.append(
    svg('path', { d: engraving, class: 'lobby-medal-lip', transform: 'translate(0.5 0.7)' }),
    svg('path', { d: engraving, class: 'lobby-medal-cut' }),
  );
  face.append(
    defs,
    svg('circle', { cx: 30, cy: 30, r: 29, fill: 'url(#lobby-rim)' }),
    svg('circle', { cx: 30, cy: 30, r: 25.6, class: 'lobby-medal-groove' }),
    svg('circle', { cx: 30, cy: 30, r: 24.2, fill: 'url(#lobby-well)' }),
    cut,
    svg('ellipse', { cx: 30, cy: 27.2, rx: 2.6, ry: 1, class: 'lobby-medal-crater' }),
  );
  return face;
}
