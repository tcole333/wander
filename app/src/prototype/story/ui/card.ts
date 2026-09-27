// The beat card: a vellum panel at the left with the date line, the title, the beat's text, its
// framed image from Commons with a one-line credit, the sources folded away, and the story's
// controls (Back, Play or Pause, Next, and the beat's number) along its foot.
import type { Walk, WalkState } from '../contract';
import type { StoryBeat, StoryImage } from '../story';
import { commonsImage } from './commons';
import { button, el, onPress, svg } from './dom';
import { curlyQuotes, dateLine } from './format';

const PLAY = 'M9 6.5v15l12-7.5z';
const PAUSE = 'M8 6.5h4.5v15H8zM15.5 6.5H20v15h-4.5z';
const RING_R = 23;
const RING_C = 2 * Math.PI * RING_R;
/** The frame's shape until Commons says what the image's is. */
const GUESS_ASPECT = 1.4;

export class BeatCard {
  readonly element = el('article', 'wu-card wu-parchment');
  readonly #walk: Walk;
  readonly #date = el('div', 'wu-date');
  readonly #title = el('h1', 'wu-title');
  readonly #body = el('div', 'wu-body');
  readonly #text = el('div', 'wu-text');
  readonly #figure = el('figure', 'wu-figure');
  readonly #sources = el('details', 'wu-sources');
  readonly #back: HTMLButtonElement;
  readonly #play: HTMLButtonElement;
  readonly #next: HTMLButtonElement;
  readonly #icon = svg('path', { d: PLAY });
  readonly #ring = svg('circle', { cx: 25, cy: 25, r: RING_R, class: 'wu-ring' });
  readonly #count = el('span', 'wu-count');
  #beat = -1;
  #playing: boolean | null = null;
  /** The countdown's first value, to show how much of it has run. */
  #advanceFrom: number | null = null;
  /** Bumped per beat, so a slow image never lands on a later beat's card. */
  #imageToken = 0;

  constructor(walk: Walk) {
    this.#walk = walk;
    const head = el('header', 'wu-card-head');
    head.append(this.#date, this.#title);
    this.#body.append(this.#text, this.#figure, this.#sources);
    this.#body.addEventListener('scroll', () => this.#checkOverflow());
    this.#sources.addEventListener('toggle', () => {
      this.#checkOverflow();
      if (!this.#sources.open) return;
      this.#body.scrollTo({ top: this.#body.scrollHeight, behavior: 'smooth' });
    });

    this.#back = button('wu-step', 'Back', () => this.#walk.back());
    this.#back.innerHTML = '<span aria-hidden="true">&lsaquo;</span> Back';
    this.#next = button('wu-step', 'Next', () => this.#walk.next());
    this.#next.innerHTML = 'Next <span aria-hidden="true">&rsaquo;</span>';
    this.#play = button('wu-play', 'Play', () => this.#walk.togglePlay());
    const ring = svg('svg', { class: 'wu-play-ring', viewBox: '0 0 50 50', 'aria-hidden': 'true' });
    this.#ring.setAttribute('stroke-dasharray', String(RING_C));
    ring.append(this.#ring);
    const icon = svg('svg', { class: 'wu-play-icon', viewBox: '0 0 28 28', 'aria-hidden': 'true' });
    icon.append(this.#icon);
    this.#play.append(ring, icon);
    const controls = el('footer', 'wu-controls');
    const steps = el('div', 'wu-steps');
    steps.append(this.#back, this.#play, this.#next);
    controls.append(steps, this.#count);

    this.element.append(head, this.#body, controls);
  }

  update(state: WalkState): void {
    const beats = state.story.beats;
    if (state.beat !== this.#beat) {
      this.#beat = state.beat;
      const beat = beats[state.beat];
      if (beat) this.#show(beat);
      this.#back.disabled = state.beat <= 0;
      this.#next.disabled = state.beat >= beats.length - 1;
      this.#count.textContent = `${state.beat + 1} of ${beats.length}`;
    }
    const playing = state.mode === 'playing';
    if (playing !== this.#playing) {
      this.#playing = playing;
      this.#icon.setAttribute('d', playing ? PAUSE : PLAY);
      this.#play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      this.#play.classList.toggle('is-playing', playing);
    }
    this.#showCountdown(state.advanceIn);
  }

  #showCountdown(advanceIn: number | null): void {
    if (advanceIn === null) {
      this.#advanceFrom = null;
      this.#ring.style.opacity = '0';
      return;
    }
    if (this.#advanceFrom === null || advanceIn > this.#advanceFrom) this.#advanceFrom = advanceIn;
    const run = this.#advanceFrom > 0 ? 1 - advanceIn / this.#advanceFrom : 1;
    this.#ring.style.opacity = '1';
    this.#ring.setAttribute('stroke-dashoffset', String(RING_C * (1 - run)));
  }

  #show(beat: StoryBeat): void {
    this.#date.textContent = dateLine(beat);
    this.#title.textContent = curlyQuotes(beat.title);
    this.#text.replaceChildren(...beat.paragraphs.map((p) => el('p', undefined, curlyQuotes(p))));
    this.#showImage(beat.image);
    this.#showSources(beat);
    this.#body.scrollTop = 0;
    // Restart the fade-in on the new beat's words.
    this.element.classList.remove('is-fresh');
    void this.element.offsetWidth;
    this.element.classList.add('is-fresh');
    requestAnimationFrame(() => this.#checkOverflow());
  }

  #showSources(beat: StoryBeat): void {
    this.#sources.open = false;
    this.#sources.hidden = beat.sources.length === 0;
    const summary = el('summary', undefined, 'Sources');
    summary.append(el('span', 'wu-sources-count', String(beat.sources.length)));
    onPress(summary, () => {});
    const list = el('ol');
    for (const source of beat.sources) {
      const item = el('li');
      const link = el('a', undefined, source.title);
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noopener';
      onPress(link, () => {});
      const by = [source.author, source.publisher, source.year]
        .filter((part) => part !== undefined && part !== null && part !== '')
        .join(', ');
      item.append(link, el('div', 'wu-source-by', by));
      list.append(item);
    }
    this.#sources.replaceChildren(summary, list);
  }

  #showImage(image: StoryImage | undefined): void {
    const token = ++this.#imageToken;
    this.#figure.replaceChildren();
    this.#figure.hidden = !image;
    if (!image) return;
    const [x0, y0, x1, y1] = image.crop;
    const frame = el('div', 'wu-frame is-loading');
    const crop = { '--cx': x0, '--cy': y0, '--cw': x1 - x0, '--ch': y1 - y0, '--ar': GUESS_ASPECT };
    for (const [name, value] of Object.entries(crop)) frame.style.setProperty(name, String(value));
    const credit = el('a', 'wu-credit');
    credit.target = '_blank';
    credit.rel = 'noopener';
    onPress(credit, () => {});
    this.#figure.append(frame, credit);

    const plate = () => {
      frame.classList.remove('is-loading');
      frame.replaceChildren(el('div', 'wu-plate', image.alt));
      frame.style.setProperty('--ar', String(GUESS_ASPECT));
      credit.hidden = true;
    };
    commonsImage(image.commons, x1 - x0).then(
      (info) => {
        if (token !== this.#imageToken) return;
        const aspect = ((x1 - x0) * info.width) / ((y1 - y0) * info.height);
        frame.style.setProperty('--ar', String(aspect));
        credit.textContent = info.credit;
        credit.title = info.credit;
        credit.href = info.page;
        // The preview shows first, blurred; the full image fades in over it and replaces it. With
        // neither, the frame becomes a plate with the image's description.
        const preview = info.preview !== info.full ? picture(info.preview, '') : null;
        const full = picture(info.full, image.alt);
        let shown = false;
        const show = (img: HTMLImageElement) => {
          shown = true;
          frame.classList.remove('is-loading');
          img.classList.add('is-loaded');
        };
        if (preview) {
          preview.classList.add('wu-preview');
          preview.addEventListener('load', () => show(preview));
          preview.addEventListener('error', () => preview.remove());
          frame.append(preview);
        }
        full.addEventListener('load', () => {
          show(full);
          setTimeout(() => preview?.remove(), 800);
        });
        full.addEventListener('error', () => {
          if (!shown) plate();
        });
        frame.append(full);
        requestAnimationFrame(() => this.#checkOverflow());
      },
      () => {
        if (token === this.#imageToken) plate();
      },
    );
  }

  /** Fades the text's foot while more of it lies below, and its head once scrolled. */
  #checkOverflow(): void {
    const body = this.#body;
    const below = body.scrollTop + body.clientHeight < body.scrollHeight - 4;
    body.style.setProperty('--fade-top', body.scrollTop > 4 ? '24px' : '0px');
    body.style.setProperty('--fade-bottom', below ? '36px' : '0px');
  }

  dispose(): void {
    this.#imageToken += 1;
    this.element.remove();
  }
}

function picture(src: string, alt: string): HTMLImageElement {
  const image = el('img');
  image.decoding = 'async';
  image.alt = alt;
  image.src = src;
  image.draggable = false;
  return image;
}
