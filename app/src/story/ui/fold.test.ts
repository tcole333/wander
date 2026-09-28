// The fold on the beat card and on Meanwhile: pressing its knob folds the panel to its head and
// unfolds it again, the knob says which, and the fold is remembered for the viewer, or for the
// visit where storage refuses it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fake, stubDocument, type FakeDocument } from '../../test/fakeDom';

let doc: FakeDocument;

// The fold keeps what storage refused in the module, so each test starts with a fresh one.
beforeEach(() => {
  vi.resetModules();
  doc = stubDocument();
});
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, 'localStorage');
});

/** localStorage as a page with working storage has it, holding `stored`. */
function stubStorage(stored: Record<string, string> = {}) {
  const held = new Map(Object.entries(stored));
  const storage = {
    refusing: false,
    getItem: vi.fn((key: string) => held.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      if (storage.refusing) throw new DOMException('no room', 'QuotaExceededError');
      held.set(key, value);
    }),
  };
  vi.stubGlobal('localStorage', storage);
  return storage;
}

/** A page whose storage is out of reach, as with blocked site data: reaching for it throws. */
function blockStorage(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('blocked', 'SecurityError');
    },
  });
}

/** A panel with a heading, and a link inside what folds away, under a fold of the given kind. */
async function foldIn(id: 'card' | 'meanwhile' = 'card', changed?: () => void) {
  const { Fold } = await import('./fold');
  const panel = fake(document.createElement('section'));
  const heading = fake(document.createElement('h2'));
  const link = fake(document.createElement('a'));
  const content = document.createElement('div');
  content.append(link as unknown as Node);
  const fold = new Fold({
    id,
    name: 'Story card',
    panel: panel as unknown as HTMLElement,
    content: [content],
    changed,
  });
  const [control, region] = [fake(fold.control), fake(fold.region)];
  panel.append(heading, control, region);
  // The click a keyboard press makes has no pointer detail, so the knob keeps the focus.
  const press = () => control.dispatchEvent(new CustomEvent('click', { detail: 0 }));
  const shown = () => ({
    expanded: control.getAttribute('aria-expanded'),
    folded: panel.classList.contains('is-folded'),
    outOfReach: region.inert,
  });
  return { fold, panel, heading, link, control, region, press, shown };
}

describe('a fold', () => {
  beforeEach(() => {
    stubStorage();
  });

  it('starts open', async () => {
    const { shown } = await foldIn();
    expect(shown()).toEqual({ expanded: 'true', folded: false, outOfReach: false });
  });

  it('names its knob for the panel, and points it at what folds away', async () => {
    const { control, region, link } = await foldIn();
    expect({
      name: control.getAttribute('aria-label'),
      controls: control.getAttribute('aria-controls'),
      holdsContent: region.contains(link),
    }).toEqual({ name: 'Story card', controls: region.id, holdsContent: true });
    expect(region.id).not.toBe('');
  });

  it('folds when its knob is pressed, and unfolds when it is pressed again', async () => {
    const { press, shown } = await foldIn();
    press();
    const folded = shown();
    press();
    expect([folded, shown()]).toEqual([
      { expanded: 'false', folded: true, outOfReach: true },
      { expanded: 'true', folded: false, outOfReach: false },
    ]);
  });

  it('keeps the heading out of what folds away', async () => {
    const { region, heading } = await foldIn();
    expect(region.contains(heading)).toBe(false);
  });

  it('moves the keyboard to its knob when it folds away what held it', async () => {
    const { press, link, control } = await foldIn();
    link.focus();
    press();
    expect(doc.activeElement).toBe(control);
  });

  it('leaves the keyboard where it was when that is outside what folds away', async () => {
    const { press, heading } = await foldIn();
    heading.focus();
    press();
    expect(doc.activeElement).toBe(heading);
  });

  it('tells its panel once for each change, and not for none', async () => {
    const changed = vi.fn();
    const { fold, press } = await foldIn('card', changed);
    expect(changed).not.toHaveBeenCalled();
    press();
    press();
    fold.set(false);
    expect(changed).toHaveBeenCalledTimes(2);
  });
});

describe('a fold remembered', () => {
  it('starts as the viewer left it', async () => {
    const storage = stubStorage();
    const first = await foldIn();
    first.press();
    const next = await foldIn();
    expect([storage.setItem.mock.lastCall, next.shown().folded]).toEqual([
      ['wander.fold.card', '1'],
      true,
    ]);
  });

  it('starts open again once the viewer unfolds it', async () => {
    const storage = stubStorage();
    const first = await foldIn();
    first.press();
    first.press();
    const next = await foldIn();
    expect([storage.setItem.mock.lastCall, next.shown().folded]).toEqual([
      ['wander.fold.card', '0'],
      false,
    ]);
  });

  it('starts open where nothing is stored', async () => {
    stubStorage();
    const { shown } = await foldIn();
    expect(shown().folded).toBe(false);
  });

  it('keeps the card and Meanwhile apart', async () => {
    stubStorage({ 'wander.fold.card': '1' });
    const [card, meanwhile] = [await foldIn('card'), await foldIn('meanwhile')];
    expect([card.shown().folded, meanwhile.shown().folded]).toEqual([true, false]);
  });
});

describe('a fold where storage refuses', () => {
  it('works where reaching for storage throws', async () => {
    blockStorage();
    const { press, shown } = await foldIn();
    const open = shown();
    press();
    expect([open.folded, shown().folded]).toEqual([false, true]);
  });

  it('works where storage will not take a write', async () => {
    stubStorage().refusing = true;
    const { press, shown } = await foldIn();
    press();
    expect(shown().folded).toBe(true);
  });

  it('holds for the visit, from one story to the next', async () => {
    blockStorage();
    const { press } = await foldIn();
    press();
    const next = await foldIn();
    expect(next.shown().folded).toBe(true);
  });

  it('holds an unfold for the visit too', async () => {
    stubStorage({ 'wander.fold.card': '1' }).refusing = true;
    const { press } = await foldIn();
    press();
    const next = await foldIn();
    expect(next.shown().folded).toBe(false);
  });

  it('leaves the fold to storage once storage takes writes again', async () => {
    const storage = stubStorage();
    storage.refusing = true;
    const { press } = await foldIn();
    press();
    storage.refusing = false;
    press();
    const next = await foldIn();
    expect(next.shown().folded).toBe(false);
  });
});
