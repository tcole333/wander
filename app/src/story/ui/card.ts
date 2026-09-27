// The beat card: a sheet of aged vellum in a thin riveted brass frame at the left, with the date
// line, the title in engraved capitals over a hairline rule, the beat's text, and its image from
// Commons mounted like a museum card (a mat, a brass bevel and a caption line for the credit),
// sized so all of it shows without scrolling. The sources fold into a footnote at its foot. The
// story's controls live on the time ruler.
import type { WalkState } from '../contract';
import type { StoryBeat, StoryImage } from '../story';
import { commonsImage } from './commons';
import { button, el, onPress } from './dom';
import { curlyQuotes, dateLine } from './format';

/** The frame's shape until Commons says what the image's is. */
const GUESS_ASPECT = 1.4;

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
  #beat: StoryBeat | null = null;
  /** Bumped per beat, so a slow image never lands on a later beat's card. */
  #imageToken = 0;

  constructor() {
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
    this.#foot.append(this.#sourcesToggle, fold);

    const sheet = el('div', 'wu-sheet');
    sheet.append(head, this.#body, this.#foot);
    this.element.append(sheet);
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
    requestAnimationFrame(() => this.#checkOverflow());
  }

  #openSources(open: boolean): void {
    this.#foot.classList.toggle('is-open', open);
    this.#sourcesToggle.setAttribute('aria-expanded', String(open));
    this.#sources.inert = !open;
    requestAnimationFrame(() => this.#checkOverflow());
  }

  #showSources(beat: StoryBeat): void {
    this.#openSources(false);
    this.#foot.hidden = beat.sources.length === 0;
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
   * The image in its mount: a brass bevel around a mat, and the image's window in the mat, cropped
   * to the story's crop, with the credit as the caption below.
   */
  #showImage(image: StoryImage | undefined): void {
    const token = ++this.#imageToken;
    this.#figure.replaceChildren();
    this.#figure.hidden = !image;
    if (!image) return;
    const [x0, y0, x1, y1] = image.crop;
    const mount = el('div', 'wu-mount');
    const mat = el('div', 'wu-mat');
    const frame = el('div', 'wu-frame is-loading');
    mat.append(frame);
    mount.append(mat);
    const crop = { '--cx': x0, '--cy': y0, '--cw': x1 - x0, '--ch': y1 - y0, '--ar': GUESS_ASPECT };
    for (const [name, value] of Object.entries(crop)) mount.style.setProperty(name, String(value));
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
      mount.style.setProperty('--ar', String(GUESS_ASPECT));
      caption.hidden = true;
    };
    commonsImage(image.commons, x1 - x0).then(
      (info) => {
        if (token !== this.#imageToken) return;
        const aspect = ((x1 - x0) * info.width) / ((y1 - y0) * info.height);
        mount.style.setProperty('--ar', String(aspect));
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
