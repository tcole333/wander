// The Credits panel (PRD, Credits): the credits page's sheet over the lobby or the walk, in the beat
// card's riveted brass frame on the darkened room. Its content is the page's own (credits.html,
// read here as text and parsed), so the page and the panel never differ. The lobby's and the card's
// Credits links open it in place and still point at /credits, for a new tab or a link passed on.
// Escape, its close controls or a press beside the sheet close it. Focus moves into it, and back
// to the link when the keyboard opened it; keys pressed while it is open stay in it, so neither
// the walk nor the globe acts on them. An entry the page marks data-release credits data only
// some releases name, the border steps': the panel shows it only where the page's release names
// that section, while the credits page, which has no release, shows every entry.
import creditsPage from '../../credits.html?raw';
import '../story/ui/tokens.css';
import '../story/ui/walkUi.css';
import './room.css';
import './creditsSheet.css';
import './creditsPanel.css';
import { el } from '../story/ui/dom';

interface Panel {
  dialog: HTMLDialogElement;
  scroll: HTMLElement;
  /** The link to give focus back to on closing, when the keyboard opened the panel. */
  returnTo: HTMLElement | null;
}

let panel: Panel | null = null;
/** The sections the page's release names, once the page has named its release. */
let named: ReadonlySet<string> | null = null;

/**
 * Names the release the page draws from: an entry marked data-release shows in the panel only
 * where this release names that section.
 */
export function creditsFor(release: object): void {
  named = new Set(
    Object.entries(release)
      .filter(([, section]) => section !== undefined)
      .map(([name]) => name),
  );
  // A panel built for another release is built again when it next opens.
  panel?.dialog.remove();
  panel = null;
}

/** Opens the panel over the page; `returnTo` has focus back when it closes. */
export function openCredits(returnTo: HTMLElement | null = null): void {
  panel ??= buildPanel();
  if (panel.dialog.open) return;
  panel.returnTo = returnTo;
  panel.dialog.showModal();
  // Only once shown: a closed dialog has no box to scroll, and the browser brings back the offset
  // the sheet closed at.
  panel.scroll.scrollTop = 0;
}

/**
 * A link to the credits page that opens the panel in place instead. A click meant for a new tab
 * or window still follows the link.
 */
export function creditsLink(className: string): HTMLAnchorElement {
  const link = el('a', className, 'Credits');
  link.href = '/credits';
  link.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    // A click the keyboard made (Enter on the link) has no pointer detail.
    openCredits(event.detail === 0 ? link : null);
  });
  return link;
}

/** The panel from the page's sheet: its head, its sections and its foot, whose link closes. */
function buildPanel(): Panel {
  const page = new DOMParser().parseFromString(creditsPage, 'text/html');
  const source = page.querySelector('.credits-card .wu-sheet');
  if (!source) throw new Error('credits.html has no credits sheet');
  const sheet = document.importNode(source, true) as HTMLElement;
  for (const entry of sheet.querySelectorAll<HTMLElement>('[data-release]')) {
    if (named && !named.has(entry.dataset.release ?? '')) entry.remove();
  }
  // The attributions lead off the site, so they open in a tab of their own and the walk keeps its
  // place.
  for (const link of sheet.querySelectorAll('a[href]')) {
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener');
  }

  const dialog = el('dialog', 'cp');
  const title = sheet.querySelector('.wu-title');
  if (title) {
    title.id = 'cp-title';
    dialog.setAttribute('aria-labelledby', title.id);
  }
  const close = () => dialog.close();
  const back = sheet.querySelector('.credits-back');
  if (back) {
    const button = el('button', 'credits-back', back.textContent?.trim() ?? 'Close');
    button.type = 'button';
    button.addEventListener('click', close);
    back.replaceWith(button);
  }
  const scroll = el('div', 'cp-scroll');
  scroll.append(...sheet.childNodes);
  const corner = el('button', 'cp-close', '×');
  corner.type = 'button';
  corner.setAttribute('aria-label', 'Close');
  corner.addEventListener('click', close);
  sheet.append(corner, scroll);
  const card = el('article', 'cp-card wu-card wu-lit credits-card');
  card.append(sheet);
  dialog.append(card);
  document.body.append(dialog);

  const made: Panel = { dialog, scroll, returnTo: null };
  // A press on the backdrop lands on the dialog itself, outside its card.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  dialog.addEventListener('close', () => {
    const to = made.returnTo;
    made.returnTo = null;
    if (to?.isConnected) {
      to.focus();
      return;
    }
    // Opened by a press: the link the browser gives focus back to lets it go again, so Space and
    // the arrow keys stay with the walk.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  return made;
}
