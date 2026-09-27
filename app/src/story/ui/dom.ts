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
 * Runs `action` on click and gives up focus, so Space and the arrow keys stay with the director
 * rather than pressing or scrolling whatever was clicked last.
 */
export function onPress(element: HTMLElement, action: (event: MouseEvent) => void): void {
  element.addEventListener('click', (event) => {
    action(event);
    element.blur();
  });
}

/** The credits page (credits.html), in a tab of its own so the walk keeps its place. */
export function creditsLink(className: string): HTMLAnchorElement {
  const link = el('a', className, 'Credits');
  link.href = '/credits';
  link.target = '_blank';
  link.rel = 'noopener';
  onPress(link, () => {});
  return link;
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
