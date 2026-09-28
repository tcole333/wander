// A stand-in for the browser's DOM, for the tests of the walk's UI: Vitest runs here without one.
// It holds what el(), button() and svg() (story/ui/dom.ts) and the panels built on them use, and
// no more; a test that needs another member adds it here.
import { vi } from 'vitest';

/** A run of text, as append() makes of a string. */
class FakeText {
  constructor(readonly data: string) {}
}

export class FakeElement extends EventTarget {
  #classes = new Set<string>();
  #attributes = new Map<string, string>();
  readonly children: (FakeElement | FakeText)[] = [];
  parent: FakeElement | null = null;
  id = '';
  title = '';
  type = '';
  href = '';
  inert = false;
  hidden = false;
  offsetLeft = 0;
  offsetWidth = 0;
  scrollTop = 0;

  readonly classList = {
    add: (...names: string[]) => names.forEach((name) => this.#classes.add(name)),
    remove: (...names: string[]) => names.forEach((name) => this.#classes.delete(name)),
    contains: (name: string) => this.#classes.has(name),
    toggle: (name: string, force?: boolean) => {
      const on = force ?? !this.#classes.has(name);
      if (on) this.#classes.add(name);
      else this.#classes.delete(name);
      return on;
    },
  };

  readonly #properties = new Map<string, string>();
  readonly style = {
    setProperty: (name: string, value: string) => this.#properties.set(name, value),
    getPropertyValue: (name: string) => this.#properties.get(name) ?? '',
  };

  constructor(
    readonly tagName: string,
    readonly ownerDocument: FakeDocument,
  ) {
    super();
  }

  get className(): string {
    return [...this.#classes].join(' ');
  }

  set className(value: string) {
    this.#classes = new Set(value.split(' ').filter((name) => name !== ''));
  }

  get textContent(): string {
    return this.children
      .map((child) => (child instanceof FakeText ? child.data : child.textContent))
      .join('');
  }

  set textContent(value: string) {
    this.replaceChildren(value);
  }

  setAttribute(name: string, value: string): void {
    this.#attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.#attributes.get(name) ?? null;
  }

  append(...nodes: (FakeElement | string)[]): void {
    for (const node of nodes) {
      if (typeof node === 'string') {
        this.children.push(new FakeText(node));
        continue;
      }
      node.remove();
      node.parent = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes: (FakeElement | string)[]): void {
    for (const child of this.children.splice(0)) {
      if (child instanceof FakeElement) child.parent = null;
    }
    this.append(...nodes);
  }

  remove(): void {
    const siblings = this.parent?.children;
    siblings?.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }

  /** Whether `node` is this element or lies inside it. */
  contains(node: unknown): boolean {
    return (
      node === this ||
      this.children.some((child) => child instanceof FakeElement && child.contains(node))
    );
  }

  focus(): void {
    this.ownerDocument.activeElement = this;
  }

  blur(): void {
    if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null;
  }

  getBoundingClientRect(): { width: number } {
    return { width: 0 };
  }

  querySelectorAll(): FakeElement[] {
    return [];
  }
}

export class FakeDocument {
  activeElement: FakeElement | null = null;

  createElement = (tag: string) => new FakeElement(tag, this);

  createElementNS = (_namespace: string, tag: string) => new FakeElement(tag, this);
}

/** Puts a fake document where the browser's would be, until the test's globals are unstubbed. */
export function stubDocument(): FakeDocument {
  const document = new FakeDocument();
  vi.stubGlobal('document', document);
  return document;
}

/** The fake behind an element built while the fake document stood in. */
export function fake(element: Element | null): FakeElement {
  if (!(element instanceof FakeElement)) throw new Error('not an element of the fake document');
  return element;
}

/** The first element with the class in `root`'s tree, `root` included. */
export function byClass(root: FakeElement, name: string): FakeElement {
  const search = (element: FakeElement): FakeElement | undefined => {
    if (element.classList.contains(name)) return element;
    for (const child of element.children) {
      const found = child instanceof FakeElement ? search(child) : undefined;
      if (found) return found;
    }
    return undefined;
  };
  const found = search(root);
  if (!found) throw new Error(`no .${name} in the tree`);
  return found;
}
