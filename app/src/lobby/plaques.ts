// The lobby's DOM (lobby.css): the Credits link engraved at
// the top right, and at the left a column with a heading and the stories' plaques in dark cast
// brass: an engraved medallion (Tambora's volcano, Magellan's ship), the title, the years
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
import type { Choice } from '../walk/mode';

export class Plaques {
  /** The lobby's layer, over the canvas as the walk's UI is. */
  readonly element = el('div', 'wu lobby');
  readonly #column = el('nav', 'lobby-column');
  readonly #credits = creditsLink('lobby-credits');
  #chosen: HTMLButtonElement | undefined;

  /** The plaques in story order; choosing one passes its choice to `onChoose`. */
  constructor(stories: readonly Story[], onChoose: (choice: Choice) => void) {
    this.#column.setAttribute('aria-label', 'Stories');
    const rule = el('div', 'lobby-rule');
    this.#column.append(el('h2', 'lobby-head', 'Choose a story'), rule);
    for (const story of stories) {
      const button = plaque(story, () => {
        this.#chosen = button;
        onChoose({ kind: 'story', story });
      });
      this.#chosen ??= button;
      this.#column.append(button);
    }
    this.element.append(this.#column, this.#credits);
    this.element.inert = true;
  }

  /** How far right the column reaches where it stands, in CSS px (its slide aside). */
  reach(): number {
    return this.#column.offsetLeft + this.#column.offsetWidth;
  }

  /** The column and the Credits link come in. */
  show(): void {
    this.element.classList.add('is-shown');
    this.element.classList.remove('is-leaving');
    this.element.inert = false;
  }

  /**
   * The column and Credits slide away. They stay mounted, out of reach, ready for the return.
   */
  leave(): void {
    this.element.classList.add('is-leaving');
    this.element.inert = true;
  }

  focus(): void {
    this.#chosen?.focus({ preventScroll: true });
  }

  dispose(): void {
    this.element.remove();
  }
}

function plaque(story: Story, choose: () => void): HTMLButtonElement {
  const button = el('button', 'lobby-plaque wu-brass wu-lit');
  button.type = 'button';
  button.dataset.story = story.id;
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
  button.append(medallion(story.id), words, ember, begin);
  return button;
}

/**
 * The medallions share a bezel and dark face, each stroke cut in gilt above its shadow. Tambora's
 * crater glows with its ember; Magellan's carries a three-masted ship under sail above the waves.
 */
function medallion(story: string): SVGSVGElement {
  const id = `lobby-${story}`;
  const face = svg('svg', { viewBox: '0 0 60 60', class: 'lobby-medal', 'aria-hidden': 'true' });
  const defs = svg('defs');
  const rim = svg('linearGradient', { id: `${id}-rim`, x1: 0, y1: 0, x2: 1, y2: 1 });
  for (const [offset, color] of [
    [0, '#f6e0aa'],
    [0.25, '#c9a263'],
    [0.6, '#7a5a2a'],
    [1, '#3e2c13'],
  ] as const) {
    rim.append(svg('stop', { offset, 'stop-color': color }));
  }
  const well = svg('radialGradient', { id: `${id}-well`, cx: 0.38, cy: 0.32, r: 0.8 });
  for (const [offset, color] of [
    [0, '#3a2c1c'],
    [0.55, '#1a130c'],
    [1, '#0b0805'],
  ] as const) {
    well.append(svg('stop', { offset, 'stop-color': color }));
  }
  const clip = svg('clipPath', { id: `${id}-face` });
  clip.append(svg('circle', { cx: 30, cy: 30, r: 23.4 }));
  defs.append(rim, well, clip);

  const volcano = [
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
  const ship = [
    // Hull, raised stern, bowsprit and planking.
    'M12 36L18 44Q30 48 43 41L48 34L39 37H22L20 34H12ZM17 40Q29 44 44 38M44 36L52 30',
    // Three masts, a pennant on the mainmast, and the rigging to the rails.
    'M20 15V36M30 9V38M40 17V37M30 10L37 12L30 14M20 19L12 36M30 16L21 37M40 22L47 35',
    // Billowing square sails on the fore and main masts, and a lateen mizzen.
    'M15 20H25Q23 25 25 28H15Q17 24 15 20ZM24 16H36Q34 21 36 24H24Q26 20 24 16Z',
    'M23 26H37Q35 31 37 34H23Q25 30 23 26ZM40 21L47 31H40Z',
    // Fine seams and short waves under the keel.
    'M30 17V23M30 27V33M20 21V27M10 47Q15 45 20 47T30 47T40 47T50 47M18 51h6M30 51h7',
  ].join('');
  const engraving = story === 'magellan' ? ship : volcano;
  const cut = svg('g', { 'clip-path': `url(#${id}-face)`, fill: 'none' });
  cut.append(
    svg('path', { d: engraving, class: 'lobby-medal-lip', transform: 'translate(0.5 0.7)' }),
    svg('path', { d: engraving, class: 'lobby-medal-cut' }),
  );
  face.append(
    defs,
    svg('circle', { cx: 30, cy: 30, r: 29, fill: `url(#${id}-rim)` }),
    svg('circle', { cx: 30, cy: 30, r: 25.6, class: 'lobby-medal-groove' }),
    svg('circle', { cx: 30, cy: 30, r: 24.2, fill: `url(#${id}-well)` }),
    cut,
  );
  if (story === 'tambora') {
    face.append(svg('ellipse', { cx: 30, cy: 27.2, rx: 2.6, ry: 1, class: 'lobby-medal-crater' }));
  }
  return face;
}
