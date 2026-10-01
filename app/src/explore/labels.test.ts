// Explore's labels over the fake DOM: hovering, pinning and the keyboard, against Explore's events
// standing in as the marks placed on screen.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tunables } from '../config/tunables';
import type { EventDescription } from '../events/describe';
import type { EventMark } from '../events/query';
import type { PlacedMark } from '../marks/marks';
import { dayFromHistorical } from '../story/dates';
import { byClass, fake, stubDocument, type FakeDocument, type FakeElement } from '../test/fakeDom';
import type { EventLabel, FocalEvent } from './exploreEvents';
import { CLICK_PX, ExploreLabels, nearestToward, type LabelEvents } from './labels';
import { openings } from './openings';

const VIEW = { width: 1440, height: 900 };
const DAY = dayFromHistorical({ year: 1815, month: 6, day: 18 });

/** An event on screen: its mark's id and place, and what the worker says of it. */
interface OnScreen {
  id: string;
  x: number;
  y: number;
  label: string;
  parent?: string;
  /** Its mark drawn from the openings lock, which the worker has not described. */
  lock?: boolean;
  /** How far up the screen, CSS px, the relief may lift its mark. */
  lift?: number;
  /** The mark the worker's label names, when not this one: a war's hollow one as it turns solid. */
  labelled?: string;
  /** Not yet described by the worker. */
  undescribed?: boolean;
}

/** Explore's events as the labels see them: marks placed on screen, 8 px in radius. */
function fakeEvents(shown: OnScreen[]) {
  const qidOf = (id: string) => Number(id.replace(/^Q/, '').replace('/outline', ''));
  const mark = (on: OnScreen, row: number, labelled = false): EventMark => ({
    row,
    qid: qidOf(on.id),
    at: [0, 0],
    x: on.x,
    y: on.y,
    anchorVisible: true,
    score: 500,
    cls: 0,
    t0: DAY,
    t1: DAY,
    prec: 11,
    flags: 0,
    unc: 0,
    parent: -1,
    focal: false,
    context: (labelled ? (on.labelled ?? on.id) : on.id).endsWith('/outline'),
  });
  const events = {
    focal: null as FocalEvent | null,
    focalNow: true as boolean,
    hovered: null as string | null,
    focused: [] as (FocalEvent | null)[],
    placed: (): PlacedMark[] => shown.map(({ id, x, y }) => ({ id, x, y, rPx: 8, alpha: 1 })),
    event(id: string) {
      const row = shown.findIndex((on) => on.id === id);
      if (row < 0) return undefined;
      return shown[row]!.lock ? null : mark(shown[row]!, row);
    },
    hit: (x: number, y: number) =>
      shown.find((on) => Math.hypot(on.x - x, on.y - y) <= 8)?.id ?? null,
    span(id: string) {
      const on = shown.find((mark) => mark.id === id);
      return on ? { x0: on.x, y0: on.y, x1: on.x, y1: on.y - (on.lift ?? 0) } : null;
    },
    hover(id: string | null) {
      events.hovered = id;
    },
    focus(focal: FocalEvent | null) {
      events.focal = focal;
      events.focused.push(focal);
    },
    labels: (): EventLabel[] =>
      shown
        .filter((on) => !on.lock)
        .map((on, row) => ({
          ...mark(on, row, true),
          text: on.label,
          fade: { phase: 'steady', from: 1, to: 1, start: 0, duration: 0 },
        })),
    description(row: number): EventDescription | undefined {
      const on = shown[row];
      if (!on || on.lock || on.undescribed) return undefined;
      return {
        row,
        qid: qidOf(on.id),
        label: on.label,
        ...(on.parent ? { parent: on.parent } : {}),
        t0: DAY,
        t1: DAY,
        prec: 11,
      };
    },
  } satisfies LabelEvents & Record<string, unknown>;
  return events;
}

const SHOWN: OnScreen[] = [
  { id: 'Q48314', x: 700, y: 400, label: 'Battle of Waterloo', parent: 'Hundred Days' },
  { id: 'Q207318', x: 640, y: 380, label: 'Battle of Ligny' },
  { id: 'Q10', x: 900, y: 420, label: 'Congress of Vienna' },
  { id: 'Q11', x: 700, y: 200, label: 'Year Without a Summer' },
];

let document: FakeDocument;
/** The window, which hears what bubbles past the canvas. */
let win: EventTarget;

function setup(shown = SHOWN, panels: Element[] = []) {
  const events = fakeEvents(shown);
  const canvas = fake(document.createElement('canvas') as unknown as Element);
  const labels = new ExploreLabels({
    events,
    canvas: canvas as unknown as HTMLElement,
    openings,
    panels: () => panels,
    view: () => VIEW,
  });
  const root = fake(labels.element);
  // A plate's size, as the browser would lay it out.
  for (const plate of [plate$(root, false), plate$(root, true)]) {
    plate.offsetWidth = 160;
    plate.offsetHeight = 48;
  }
  const pointer = (type: string, x: number, y: number, button = 0) =>
    canvas.dispatchEvent(Object.assign(new Event(type), { clientX: x, clientY: y, button }));
  const click = (x: number, y: number, moved = 0) => {
    pointer('pointerdown', x, y);
    pointer('pointerup', x + moved, y);
  };
  const key = (target: EventTarget, name: string) => {
    const event = Object.assign(new Event('keydown', { cancelable: true }), { key: name });
    target.dispatchEvent(event);
    return event;
  };
  return { events, labels, canvas, root, pointer, click, key, list: byClass(root, 'xl-list') };
}

/** The hovered plate, or the pinned one. */
function plate$(root: FakeElement, pinned: boolean): FakeElement {
  const plates = root.children.filter(
    (child): child is FakeElement =>
      typeof child === 'object' && 'classList' in child && child.classList.contains('xl-plate'),
  );
  const found = plates.find((plate) => plate.classList.contains('is-pinned') === pinned);
  if (!found) throw new Error('no plate');
  return found;
}

const shown = (plate: FakeElement) => plate.classList.contains('is-shown');

beforeEach(() => {
  document = stubDocument();
  win = new EventTarget();
  vi.stubGlobal('addEventListener', win.addEventListener.bind(win));
});
afterEach(() => vi.unstubAllGlobals());

describe('Explore’s labels', () => {
  it('bring a mark’s plate once the pointer has rested on it for hoverQueue', () => {
    const { events, labels, root, pointer } = setup();
    labels.land(null);
    pointer('pointermove', 702, 401);
    labels.update(0);
    labels.update(tunables.hoverQueue - 1);
    expect(shown(plate$(root, false))).toBe(false);
    labels.update(tunables.hoverQueue);
    const plate = plate$(root, false);
    expect(shown(plate)).toBe(true);
    expect(plate.textContent).toBe('Battle of Waterloo18 June 1815Part ofHundred Days');
    expect(byClass(plate, 'xl-part-of').textContent).toBe('Part of');
    expect(byClass(plate, 'xl-parent-name').textContent).toBe('Hundred Days');
    expect(events.hovered).toBe('Q48314');
    // It stands right of the mark, clear of it.
    expect(plate.getAttribute('data-side')).toBe('right');
    pointer('pointerleave', 0, 0);
    labels.update(tunables.hoverQueue + 16);
    expect([shown(plate), events.hovered]).toEqual([false, null]);
  });

  it('bring no plate while a press drags the globe, with any button', () => {
    const { events, labels, canvas, pointer } = setup();
    labels.land(null);
    pointer('pointerdown', 702, 401, 2);
    labels.update(0);
    labels.update(tunables.hoverQueue * 2);
    expect([events.hovered, canvas.classList.contains('is-over-mark')]).toEqual([null, false]);
    pointer('pointerup', 702, 401, 2);
    labels.update(tunables.hoverQueue * 3);
    expect(canvas.classList.contains('is-over-mark')).toBe(true);
    labels.update(tunables.hoverQueue * 4);
    expect(events.hovered).toBe('Q48314');
  });

  it('bring plates again once a press the canvas does not see end is let go', () => {
    const { events, labels, pointer } = setup();
    labels.land(null);
    // The middle button, which the view does not capture, let go over a panel.
    pointer('pointerdown', 702, 401, 1);
    labels.update(0);
    labels.update(tunables.hoverQueue * 2);
    expect(events.hovered).toBeNull();
    win.dispatchEvent(Object.assign(new Event('pointerup'), { button: 1 }));
    labels.update(tunables.hoverQueue * 3);
    labels.update(tunables.hoverQueue * 4);
    expect(events.hovered).toBe('Q48314');
    // A press the window's losing the focus cut short.
    pointer('pointerdown', 702, 401);
    labels.update(tunables.hoverQueue * 5);
    expect(events.hovered).toBeNull();
    win.dispatchEvent(new Event('blur'));
    labels.update(tunables.hoverQueue * 6);
    labels.update(tunables.hoverQueue * 7);
    expect(events.hovered).toBe('Q48314');
  });

  it('bring nothing before the dive has landed', () => {
    const { events, labels, pointer } = setup();
    pointer('pointermove', 700, 400);
    labels.update(0);
    labels.update(1000);
    expect(events.hovered).toBeNull();
  });

  it('keep the listbox out of the tab order and deaf to keys until the dive has landed', () => {
    const { events, labels, list, key } = setup();
    labels.update(0);
    expect(list.tabIndex).toBe(-1);
    list.dispatchEvent(new Event('focus'));
    labels.update(16);
    const enter = key(list, 'Enter');
    labels.update(32);
    expect([events.hovered, labels.pinned, events.focused, enter.defaultPrevented]).toEqual([
      null,
      null,
      [],
      false,
    ]);
    labels.land(null);
    expect(list.tabIndex).toBe(0);
  });

  it('pin a clicked mark’s event, making it focal, its plate linking its source', () => {
    const { events, labels, root, click } = setup();
    labels.land(null);
    click(640, 380);
    labels.update(0);
    expect(events.focal).toEqual({ qid: 207318, span: { t0: DAY, t1: DAY } });
    expect(labels.pinned).toBe(207318);
    const plate = plate$(root, true);
    expect(shown(plate)).toBe(true);
    const link = byClass(plate, 'xl-source');
    expect([link.href, link.target, link.rel]).toEqual([
      'https://www.wikidata.org/wiki/Special:GoToLinkedPage/enwiki/Q207318',
      '_blank',
      'noopener',
    ]);
    // The live region reads the pinned plate once.
    expect(byClass(root, 'xl-live').textContent).toBe('Battle of Ligny, 18 June 1815');
  });

  it('take a press that moves as far as a drag for no click', () => {
    const { labels, click } = setup();
    labels.land(null);
    click(640, 380, CLICK_PX);
    labels.update(0);
    expect(labels.pinned).toBeNull();
  });

  it('unpin on a click on bare metal, and on Escape before the lobby hears it', () => {
    const { events, labels, root, click } = setup();
    labels.land(null);
    click(640, 380);
    labels.update(0);
    click(100, 100);
    labels.update(16);
    expect([labels.pinned, events.focal, shown(plate$(root, true))]).toEqual([null, null, false]);

    click(900, 420);
    labels.update(32);
    const escape = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' });
    document.dispatchEvent(escape);
    expect([labels.pinned, events.focal, escape.defaultPrevented]).toEqual([null, null, true]);
    // With nothing pinned, Escape is the lobby's.
    const again = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' });
    document.dispatchEvent(again);
    expect(again.defaultPrevented).toBe(false);
  });

  it('leave Escape to the lobby while no pinned plate stands in view', () => {
    const inView = SHOWN.map((on) => ({ ...on }));
    const { labels, root, click } = setup(inView);
    labels.land(null);
    click(640, 380);
    labels.update(0);
    // Ligny panned out of view: its plate goes, and Escape is the lobby's.
    inView.splice(1, 1);
    labels.update(16);
    expect([labels.pinned, shown(plate$(root, true))]).toEqual([207318, false]);
    const escape = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' });
    document.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
  });

  it('hold a pin while its dates are on the tape, dimmed outside the glass, unpinning off it', () => {
    const { events, labels, root, click } = setup();
    labels.land(null);
    click(700, 400);
    labels.update(0);
    const plate = plate$(root, true);
    expect([labels.pinned, shown(plate), plate.classList.contains('is-away')]).toEqual([
      48314,
      true,
      false,
    ]);
    // A step takes its dates out of the glass but not off the tape: the pin holds, dimmed.
    events.focalNow = false;
    labels.update(16);
    expect([labels.pinned, shown(plate), plate.classList.contains('is-away')]).toEqual([
      48314,
      true,
      true,
    ]);
    events.focalNow = true;
    labels.update(32);
    expect(plate.classList.contains('is-away')).toBe(false);
    // Off the tape the event is no longer focal, and the pin goes.
    events.focal = null;
    labels.update(48);
    expect([labels.pinned, shown(plate)]).toEqual([null, false]);
  });

  it('pin a hovered event’s plate in place of its hovered one, the other plate clear of it', () => {
    const { labels, root, pointer, click } = setup();
    labels.land(null);
    click(700, 400);
    pointer('pointermove', 700, 400);
    labels.update(0);
    labels.update(tunables.hoverQueue);
    expect(shown(plate$(root, false))).toBe(false);
    // Ligny, just left of Waterloo: its plate stands clear of Waterloo's.
    pointer('pointermove', 640, 380);
    labels.update(tunables.hoverQueue + 16);
    labels.update(2 * tunables.hoverQueue + 16);
    const [pinned, hovered] = [plate$(root, true), plate$(root, false)];
    expect(shown(hovered)).toBe(true);
    expect(pinned.getAttribute('data-side')).toBe('right');
    expect(hovered.getAttribute('data-side')).not.toBe('right');
  });

  it('keep plates clear of the panels', () => {
    const ruler = {
      getBoundingClientRect: () => ({ left: 0, right: 1440, top: 410, bottom: 900 }),
    };
    const { labels, root, pointer } = setup(SHOWN, [ruler as unknown as Element]);
    labels.land(null);
    pointer('pointermove', 700, 200);
    labels.update(0);
    labels.update(tunables.hoverQueue);
    expect(plate$(root, false).getAttribute('data-side')).toBe('right');
    pointer('pointermove', 900, 420);
    labels.update(tunables.hoverQueue + 16);
    labels.update(2 * tunables.hoverQueue + 16);
    // Under the ruler every side but the one above is covered.
    expect(plate$(root, false).getAttribute('data-side')).toBe('above');
  });

  it('stand a plate and the ember’s keep-out clear of a mark wherever the relief may lift it', () => {
    // Waterloo on a mountain seen tilted, focal, its mark lifted up to 60 px; Ligny beside it.
    const { events, labels, root, pointer } = setup([
      { id: 'Q48314', x: 700, y: 400, label: 'Battle of Waterloo', lift: 60 },
      { id: 'Q207318', x: 520, y: 340, label: 'Battle of Ligny' },
    ]);
    events.focal = { qid: 48314 };
    labels.land(null);
    pointer('pointermove', 700, 400);
    labels.update(0);
    labels.update(tunables.hoverQueue);
    const hovered = plate$(root, false);
    // Right of it, centered on the way up: rows 346 to 394, less the plate's half height.
    expect(hovered.getAttribute('data-side')).toBe('right');
    expect(hovered.style.getPropertyValue('translate')).toBe(
      `${(700 + 1.42 * 8 + 8).toFixed(1)}px ${(370 - 24).toFixed(1)}px`,
    );
    // Ligny's plate, right of it, would cover the ember's reach up the mountain.
    pointer('pointermove', 520, 340);
    labels.update(tunables.hoverQueue + 16);
    labels.update(2 * tunables.hoverQueue + 16);
    expect(plate$(root, false).getAttribute('data-side')).not.toBe('right');
  });

  it('move the keyboard among the marks as they are drawn, lifted by the relief', () => {
    // Waterloo's foot lies below Ligny, but the relief draws it above.
    const { labels, list, key } = setup([
      { id: 'Q48314', x: 700, y: 400, label: 'Battle of Waterloo', lift: 60 },
      { id: 'Q207318', x: 700, y: 385, label: 'Battle of Ligny' },
      { id: 'Q10', x: 700, y: 480, label: 'Congress of Vienna' },
    ]);
    labels.land(null);
    labels.update(0);
    list.dispatchEvent(new Event('focus'));
    const from = (id: string, arrow: string) => {
      key(list, 'Home');
      while (list.getAttribute('aria-activedescendant') !== `xl-${id}`) key(list, 'ArrowDown');
      key(list, arrow);
      return list.getAttribute('aria-activedescendant');
    };
    expect(from('Q207318', 'ArrowDown')).toBe('xl-Q10');
    expect(from('Q207318', 'ArrowUp')).toBe('xl-Q48314');
  });

  it('pin the opening at the landing, with its line and the source it rests on', () => {
    const { events, labels, root } = setup([
      { id: 'Q48314', x: 700, y: 400, label: 'Battle of Waterloo', lock: true },
    ]);
    events.focal = { qid: 48314 };
    labels.land(openings.find((opening) => opening.qid === 'Q48314')!);
    labels.update(0);
    const plate = plate$(root, true);
    expect(shown(plate)).toBe(true);
    expect(byClass(plate, 'xl-line').textContent).toMatch(/^At Waterloo/);
    expect(byClass(plate, 'xl-source').href).toMatch(/wikipedia\.org\/wiki\/Battle_of_Waterloo/);
  });

  it('date an opening as its lock does where its sources date it more finely than the index', () => {
    const { events, labels, root, click } = setup([
      { id: 'Q8094772', x: 700, y: 400, label: '1883 eruption of Krakatoa' },
    ]);
    // The index knows the eruption only to its year.
    const described = events.description(0)!;
    events.description = () => ({ ...described, prec: 9 });
    labels.land(null);
    click(700, 400);
    labels.update(0);
    expect(byClass(plate$(root, true), 'xl-date').textContent).toBe('27 August 1883');
    // Once the index knows its day, or its days, as finely, the index's span stands.
    events.description = () => ({ ...described, t0: DAY, t1: DAY + 4, prec: 11 });
    labels.update(16);
    expect(byClass(plate$(root, true), 'xl-date').textContent).toBe('18–22 June 1815');
  });

  it('list the marks in view in one listbox, the keyboard moving and pinning among them', () => {
    const { events, labels, root, list, key } = setup();
    labels.land(null);
    labels.update(0);
    const options = list.children as FakeElement[];
    expect(options.map((option) => option.textContent)).toEqual([
      'Battle of Ligny, 18 June 1815',
      'Year Without a Summer, 18 June 1815',
      'Battle of Waterloo, 18 June 1815',
      'Congress of Vienna, 18 June 1815',
    ]);
    expect([list.getAttribute('role'), list.tabIndex]).toEqual(['listbox', 0]);
    list.dispatchEvent(new Event('focus'));
    // The mark nearest the view's center first, shown at once.
    labels.update(16);
    expect(list.getAttribute('aria-activedescendant')).toBe('xl-Q48314');
    expect([events.hovered, shown(plate$(root, false))]).toEqual(['Q48314', true]);
    const right = key(list, 'ArrowRight');
    expect(list.getAttribute('aria-activedescendant')).toBe('xl-Q10');
    // The arrow keys stay with the listbox: the view does not pan.
    expect([right.defaultPrevented, right.cancelBubble]).toEqual([true, true]);
    key(list, 'ArrowUp');
    expect(list.getAttribute('aria-activedescendant')).toBe('xl-Q11');
    key(list, 'Enter');
    labels.update(32);
    expect(labels.pinned).toBe(11);
    list.dispatchEvent(new Event('blur'));
    labels.update(48);
    expect([list.getAttribute('aria-activedescendant'), events.hovered]).toEqual([null, null]);
  });

  it('ring the pinned plate when the keyboard stands on its mark, and name the listbox', () => {
    const { labels, root, list, click, key } = setup();
    labels.land(null);
    click(700, 400);
    labels.update(0);
    const caption = byClass(root, 'xl-focus');
    expect(shown(caption)).toBe(false);
    list.dispatchEvent(new Event('focus'));
    labels.update(16);
    // The listbox starts on the pinned mark, whose plate alone stands.
    expect(list.getAttribute('aria-activedescendant')).toBe('xl-Q48314');
    const [pinned, hovered] = [plate$(root, true), plate$(root, false)];
    expect([shown(pinned), pinned.classList.contains('is-active'), shown(hovered)]).toEqual([
      true,
      true,
      false,
    ]);
    expect([shown(caption), caption.getAttribute('aria-hidden')]).toEqual([true, 'true']);
    key(list, 'ArrowRight');
    labels.update(32);
    expect(pinned.classList.contains('is-active')).toBe(false);
    expect([shown(hovered), hovered.classList.contains('is-active')]).toEqual([true, true]);
    list.dispatchEvent(new Event('blur'));
    labels.update(48);
    expect([pinned.classList.contains('is-active'), shown(caption)]).toEqual([false, false]);
  });

  it('name the listbox while it has the focus, though no mark is in view', () => {
    const { labels, root, list } = setup([]);
    labels.land(null);
    list.dispatchEvent(new Event('focus'));
    labels.update(0);
    expect(list.getAttribute('aria-activedescendant')).toBeNull();
    expect(shown(byClass(root, 'xl-focus'))).toBe(true);
  });

  it('keep plates clear of the listbox’s name while it shows', () => {
    const { labels, root, list, pointer } = setup([
      { id: 'Q48314', x: 700, y: 40, label: 'Battle of Waterloo' },
    ]);
    // Where the browser lays the name out, at the top of the view.
    Object.assign(byClass(root, 'xl-focus'), {
      getBoundingClientRect: () => ({ left: 680, right: 800, top: 28, bottom: 50 }),
    });
    labels.land(null);
    pointer('pointermove', 700, 40);
    labels.update(0);
    labels.update(tunables.hoverQueue);
    expect(plate$(root, false).getAttribute('data-side')).toBe('right');
    list.dispatchEvent(new Event('focus'));
    labels.update(tunables.hoverQueue + 16);
    // The keyboard stands on the mark: its plate leaves the side the name covers.
    expect(plate$(root, false).getAttribute('data-side')).not.toBe('right');
  });

  it('keep their options while only their marks move, ordering them anew as the list takes focus', () => {
    const moving = SHOWN.map((on) => ({ ...on }));
    const { labels, list, key } = setup(moving);
    labels.land(null);
    labels.update(0);
    const before = [...list.children];
    const names = () =>
      (list.children as FakeElement[]).map((option) => option.textContent.split(',')[0]);
    expect(names()).toEqual([
      'Battle of Ligny',
      'Year Without a Summer',
      'Battle of Waterloo',
      'Congress of Vienna',
    ]);
    // The globe turns and Ligny passes Vienna: the same elements stand, in the same order.
    moving[1]!.x = 1000;
    labels.update(16);
    expect(list.children.every((option, i) => option === before[i])).toBe(true);
    // Focused, the listbox orders them as their marks stand now.
    list.dispatchEvent(new Event('focus'));
    expect(names()).toEqual([
      'Year Without a Summer',
      'Battle of Waterloo',
      'Congress of Vienna',
      'Battle of Ligny',
    ]);
    key(list, 'End');
    expect(list.getAttribute('aria-activedescendant')).toBe('xl-Q207318');
  });

  it('keep the keyboard on an event as its mark turns from hollow to solid', () => {
    // A war whose place its battle lends it, drawn hollow while split, the battle listed first.
    const shown: OnScreen[] = [
      { id: 'Q209312', x: 800, y: 380, label: 'Eighth Russo-Turkish War' },
      { id: 'Q743046/outline', x: 800, y: 380, label: 'Russo-Turkish Wars' },
    ];
    const { labels, list, key } = setup(shown);
    labels.land(null);
    labels.update(0);
    list.dispatchEvent(new Event('focus'));
    key(list, 'End');
    expect(list.getAttribute('aria-activedescendant')).toBe('xl-Q743046-outline');
    key(list, 'Enter');
    expect(labels.pinned).toBe(743046);
    // Pinned, the war stands solid in its hollow mark's place: the keyboard stays with it.
    shown[1] = { id: 'Q743046', x: 800, y: 380, label: 'Russo-Turkish Wars' };
    labels.update(16);
    expect(list.getAttribute('aria-activedescendant')).toBe('xl-Q743046');
  });

  it('list a war pinned while split before the worker describes it, by its hollow mark’s label', () => {
    const shown: OnScreen[] = [
      { id: 'Q209312', x: 800, y: 380, label: 'Eighth Russo-Turkish War' },
      { id: 'Q743046/outline', x: 800, y: 380, label: 'Russo-Turkish Wars', undescribed: true },
    ];
    const { labels, list, key } = setup(shown);
    labels.land(null);
    labels.update(0);
    list.dispatchEvent(new Event('focus'));
    key(list, 'End');
    key(list, 'Enter');
    // Solid now, the war is still named by the worker's label for its hollow mark.
    shown[1] = { ...shown[1]!, id: 'Q743046', labelled: 'Q743046/outline' };
    labels.update(16);
    const option = (list.children as FakeElement[]).find((o) => o.id === 'xl-Q743046');
    expect(option?.textContent).toBe('Russo-Turkish Wars, 18 June 1815');
    expect(list.getAttribute('aria-activedescendant')).toBe('xl-Q743046');
  });

  it('stop picking once Explore leaves, the plates going', () => {
    const { events, labels, root, click, pointer } = setup();
    labels.land(null);
    click(700, 400);
    labels.update(0);
    labels.leave();
    expect(shown(plate$(root, true))).toBe(false);
    pointer('pointermove', 640, 380);
    click(640, 380);
    labels.update(1000);
    expect([events.hovered, labels.pinned]).toEqual([null, 48314]);
  });
});

describe('the nearest mark the way an arrow points', () => {
  const marks = [
    { id: 'ahead', x: 200, y: 0 },
    { id: 'near but aside', x: 60, y: 50 },
    { id: 'behind', x: -10, y: 0 },
  ];

  it('prefers a mark straight ahead to a nearer one well aside', () => {
    expect(nearestToward({ x: 0, y: 0 }, marks, 'ArrowRight')).toBe('near but aside');
    expect(
      nearestToward({ x: 0, y: 0 }, [marks[0]!, { id: 'aside', x: 40, y: 90 }], 'ArrowRight'),
    ).toBe('ahead');
  });

  it('finds none where none lies that way', () => {
    expect(nearestToward({ x: 0, y: 0 }, marks, 'ArrowUp')).toBeNull();
  });
});
