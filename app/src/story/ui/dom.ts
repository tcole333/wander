// Small DOM helpers for the walk's UI.

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/**
 * Runs `action` on click. A pointer's click gives up focus, so Space and the arrow keys stay with
 * the director rather than pressing or scrolling whatever was clicked last; a click the keyboard
 * made (Enter or Space, with no pointer detail) keeps it, so a keyboard visitor stays where they
 * were. A held Enter presses once, as a held arrow key steps the walk once, rather than at the
 * key's repeat rate.
 */
export function onPress(element: HTMLElement, action: (event: MouseEvent) => void): void {
  element.addEventListener('click', (event) => {
    action(event);
    if (event.detail > 0) element.blur();
  });
  element.addEventListener('keydown', (event) => {
    if (event.repeat && event.key === 'Enter') event.preventDefault();
  });
}

/**
 * Hands the keyboard's focus from a control going out of reach to `heir`, when the control has
 * it, so a keyboard visitor keeps their place rather than holding a control no one can see.
 */
export function passFocus(from: HTMLElement, heir: HTMLElement): void {
  if (from.ownerDocument.activeElement === from) heir.focus();
}

export function button(className: string, label: string, action: () => void): HTMLButtonElement {
  const b = el('button', className);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  onPress(b, action);
  return b;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  return element;
}
