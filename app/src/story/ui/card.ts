// The beat card: a sheet of aged vellum in a thin riveted brass frame at the left, with the date
// line, the title in engraved capitals over a hairline rule, the beat's text, and its image
// mounted like a museum card (a mat, a brass bevel and a caption for the credit), sized so
// all of it shows without scrolling. The image is the story's crop, baked by the media stage and
// read from the data host; its credit comes from the story's lock (../lock.ts). The sources fold
// into a footnote at its foot, with the Credits link beside them, which opens the Credits panel.
// A small brass knob in its head folds all but the date line and the title away (fold.ts), and the
// card, folded, no longer stands in the globe's way. The story's controls live on the time ruler.
import { creditsLink } from '../../page/creditsPanel';
import type { WalkState } from '../contract';
import type { LockedFile } from '../lock';
import type { StoryBeat, StoryImage } from '../story';
import { button, el, onPress } from './dom';
import { Fold } from './fold';
import { curlyQuotes, dateLine } from './format';

/** The frame's width, CSS px, when the card has not been laid out to measure it. */
const FRAME_PX = 340;

export class BeatCard {
  readonly element = el('article', 'wu-card wu-lit');
  readonly #date = el('div', 'wu-date');
  readonly #title = el('h1', 'wu-title');
  readonly #body = el('div', 'wu-body');
  readonly #text = el('div', 'wu-text');
  readonly #figure = el('figure', 'wu-figure');
  readonly #foot = el('footer', 'wu-foot');
  readonly #sources = el('ol', 'wu-sources');
  readonly #sourcesToggle: HTMLButtonElement;
  readonly #fold: Fold;
  /** Where the images are, as the release's other keys are. */
  readonly #dataHost: string;
  #beat: StoryBeat | null = null;
  #imageListeners = new AbortController();
  #previewTimer: ReturnType<typeof setTimeout> | undefined;
  #overflowFrame = 0;

  /** `reachChanged` is called when folding or unfolding changes how far the card reaches. */
  constructor(dataHost: string, reachChanged: () => void = () => {}) {
    this.#dataHost = dataHost;
    const head = el('header', 'wu-card-head');
    head.append(this.#date, this.#title, el('div', 'wu-rule'));
    this.#body.append(this.#text, this.#figure);
    this.#body.addEventListener('scroll', () => this.#checkOverflow());

    this.#sources.id = 'wu-sources';
    this.#sourcesToggle = button('wu-sources-toggle', 'Sources', () =>
      this.#openSources(this.#sourcesToggle.getAttribute('aria-expanded') !== 'true'),
    );
    this.#sourcesToggle.setAttribute('aria-controls', this.#sources.id);
    const fold = el('div', 'wu-sources-fold');
    fold.append(this.#sources);
    fold.addEventListener('transitionend', () => this.#checkOverflow());
    const line = el('div', 'wu-foot-line');
    line.append(this.#sourcesToggle, creditsLink('wu-card-credits'));
    this.#foot.append(line, fold);

    this.#fold = new Fold({
      id: 'card',
      name: 'Story card',
      panel: this.element,
      content: [this.#body, this.#foot],
      changed: () => {
        this.#checkNextFrame();
        reachChanged();
      },
    });
    const region = this.#fold.region;
    region.addEventListener('transitionend', (event) => {
      if (event.target === region) this.#checkOverflow();
    });
    head.append(this.#fold.control);

    const sheet = el('div', 'wu-sheet');
    sheet.append(head, region);
    this.element.append(sheet);
  }

  /**
   * How far right of the page's left edge the card reaches where it is laid out, CSS px, or 0
   * once it is folded, when it no longer stands in the globe's way.
   */
  reach(): number {
    return this.#fold.folded ? 0 : this.element.offsetLeft + this.element.offsetWidth;
  }

  update(state: WalkState): void {
    const beat = state.story.beats[state.beat] ?? null;
    if (beat === this.#beat) return;
    this.#beat = beat;
    if (beat) this.#show(beat);
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
    this.#checkNextFrame();
  }

  #openSources(open: boolean): void {
    this.#foot.classList.toggle('is-open', open);
    this.#sourcesToggle.setAttribute('aria-expanded', String(open));
    this.#sources.inert = !open;
    this.#checkNextFrame();
  }

  #showSources(beat: StoryBeat): void {
    this.#openSources(false);
    const hand = el('span', 'wu-sources-hand', '☞');
    hand.setAttribute('aria-hidden', 'true');
    this.#sourcesToggle.replaceChildren(
      el('span', 'wu-sources-word', 'Sources'),
      el('span', 'wu-sources-count', String(beat.sources.length)),
      hand,
    );
    this.#sourcesToggle.setAttribute('aria-label', `Sources, ${beat.sources.length}`);
    const items = beat.sources.map((source) => {
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
      return item;
    });
    this.#sources.replaceChildren(...items);
  }

  /**
   * The image in its mount: a brass bevel around a mat, and the baked crop filling the mat's
   * window, with the credit as the caption below: the makers and the license on one line, and
   * under them, in full, the credit line of a collection that asks for one. The small file shows
   * first, blurred, and the sharp one, at the width the browser picks for the frame, fades in over
   * it; should the sharp one fail, the small one sharpens in its place. With neither, or with no
   * baked crop in the lock, the frame becomes a plate across the text column, its label the
   * image's whole description.
   */
  #showImage(image: StoryImage): void {
    this.#clearImage();
    this.#imageListeners = new AbortController();
    const { signal } = this.#imageListeners;
    const mount = el('div', 'wu-mount');
    const mat = el('div', 'wu-mat');
    const frame = el('div', 'wu-frame is-loading');
    mat.append(frame);
    mount.append(mat);
    const caption = el('figcaption', 'wu-caption');
    const credit = el('a', 'wu-credit');
    credit.target = '_blank';
    credit.rel = 'noopener';
    onPress(credit, () => {});
    caption.append(credit);
    this.#figure.append(mount, caption);

    const plate = () => {
      frame.classList.remove('is-loading');
      frame.replaceChildren(el('div', 'wu-plate', image.alt));
      mount.classList.add('is-plate');
      caption.hidden = true;
    };
    const files = [...(image.locked?.files ?? [])].sort((a, b) => a.w - b.w);
    const [small, large] = [files[0], files.at(-1)];
    if (!image.locked || !small || !large) {
      plate();
      return;
    }
    const { credit: makers, collection, license, source } = image.locked;
    mount.style.setProperty('--ar', String(large.w / large.h));
    const line = [makers, license].filter((part) => part.length > 0).join(' · ');
    credit.replaceChildren(el('span', 'wu-credit-line', line));
    credit.title = line;
    if (collection) {
      // The collection's names stay whole, so its line breaks only after a comma.
      const held = el('span', 'wu-credit-collection');
      for (const [i, name] of collection.split(', ').entries()) {
        if (i > 0) held.append(', ');
        held.append(el('span', undefined, name));
      }
      credit.append(held);
      credit.title = `${line}\n${collection}`;
    }
    credit.href = source;

    const url = (file: LockedFile) => `${this.#dataHost}/${file.key}`;
    const across = Math.ceil(frame.getBoundingClientRect().width) || FRAME_PX;
    const srcset = files.map((file) => `${url(file)} ${file.w}w`).join(', ');
    const preview = small !== large ? picture(url(small), '') : null;
    const full = picture(url(large), image.alt, { srcset, sizes: `${across}px` });
    let shown = false;
    const show = (img: HTMLImageElement) => {
      shown = true;
      frame.classList.remove('is-loading');
      img.classList.add('is-loaded');
    };
    if (preview) {
      preview.classList.add('wu-preview');
      preview.addEventListener('load', () => show(preview), { signal });
      preview.addEventListener('error', () => preview.remove(), { signal });
      frame.append(preview);
    }
    full.addEventListener(
      'load',
      () => {
        show(full);
        this.#previewTimer = setTimeout(() => preview?.remove(), 800);
      },
      { signal },
    );
    full.addEventListener(
      'error',
      () => {
        if (shown) preview?.classList.remove('wu-preview');
        else plate();
      },
      { signal },
    );
    frame.append(full);
    this.#checkNextFrame();
  }

  #clearImage(): void {
    this.#imageListeners.abort();
    clearTimeout(this.#previewTimer);
    for (const image of this.#figure.querySelectorAll('img')) {
      image.removeAttribute('srcset');
      image.removeAttribute('src');
    }
    this.#figure.replaceChildren();
  }

  #checkNextFrame(): void {
    cancelAnimationFrame(this.#overflowFrame);
    this.#overflowFrame = requestAnimationFrame(() => this.#checkOverflow());
  }

  /** Fades the text's foot while more of it lies below, and its head once scrolled. */
  #checkOverflow(): void {
    const body = this.#body;
    const below = body.scrollTop + body.clientHeight < body.scrollHeight - 4;
    body.style.setProperty('--fade-top', body.scrollTop > 4 ? '24px' : '0px');
    body.style.setProperty('--fade-bottom', below ? '36px' : '0px');
  }

  dispose(): void {
    cancelAnimationFrame(this.#overflowFrame);
    this.#clearImage();
    this.element.remove();
  }
}

/** An image of `src`, or of the width the browser picks from `choices`, set before `src`. */
function picture(
  src: string,
  alt: string,
  choices?: { srcset: string; sizes: string },
): HTMLImageElement {
  const image = el('img');
  image.decoding = 'async';
  image.alt = alt;
  if (choices) {
    image.sizes = choices.sizes;
    image.srcset = choices.srcset;
  }
  image.src = src;
  image.draggable = false;
  return image;
}
