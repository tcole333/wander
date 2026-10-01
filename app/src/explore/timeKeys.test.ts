// Explore's time keys over the fake DOM: each row of the routing table, against the real time.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dayFromIso, historicalCivil } from '../story/dates';
import { stubDocument, type FakeDocument, type FakeElement } from '../test/fakeDom';
import { ExploreTime, HISTORY, MAX_EXPLORE_DAYS, MIN_EXPLORE_DAYS } from '../time/exploreTime';
import { YEAR_DAYS } from '../time/overviewScale';
import { WorldClock } from '../time/worldClock';
import { bindTimeKeys, GLOBE_STOP, type TimeKeysRuler } from './timeKeys';

const WATERLOO = dayFromIso('1815-06-18');
const Y200 = 200 * YEAR_DAYS;

class FakeInput {}

/** A key as the browser gives it, from `target`. */
class Key extends Event {
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly repeat: boolean;
  constructor(
    type: string,
    readonly key: string,
    on: unknown,
    { shift = false, meta = false, ctrl = false, alt = false, repeat = false } = {},
  ) {
    super(type, { cancelable: true });
    [this.shiftKey, this.metaKey, this.ctrlKey, this.altKey, this.repeat] = [
      shift,
      meta,
      ctrl,
      alt,
      repeat,
    ];
    Object.defineProperty(this, 'target', { value: on });
  }
}

let document: FakeDocument;
let win: EventTarget;

beforeEach(() => {
  document = stubDocument();
  win = new EventTarget();
  vi.stubGlobal('addEventListener', win.addEventListener.bind(win));
  vi.stubGlobal('removeEventListener', win.removeEventListener.bind(win));
  for (const name of ['HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement'])
    vi.stubGlobal(name, FakeInput);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup() {
  const clock = new WorldClock();
  const time = new ExploreTime(clock, HISTORY, WATERLOO, { openYears: 200 });
  const counter = document.createElement('div');
  const plaque = document.createElement('div');
  const ruler = {
    plaque,
    counter,
    openEntry: vi.fn(),
    sayDate: vi.fn(),
    sayYears: vi.fn(),
  } as unknown as TimeKeysRuler & { openEntry: ReturnType<typeof vi.fn> };
  const control = { arrowKeys: true };
  const keys = bindTimeKeys(time, ruler, control);
  let now = 1000;
  const run = (ms = 3000) => {
    const until = now + ms;
    while (now < until) {
      time.tick(now);
      now += 1000 / 60;
      if (!time.moving && ms === 3000) break;
    }
  };
  /** Presses `key` on `on` (the body when nothing has the focus), and says whether it was taken. */
  const press = (key: string, on: unknown = document, options = {}) => {
    const event = new Key('keydown', key, on, options);
    win.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const release = (key: string, on: unknown = document) =>
    win.dispatchEvent(new Key('keyup', key, on));
  return { clock, time, ruler, control, keys, run, press, release, counter, plaque };
}

describe('Explore’s time keys', () => {
  it('step time to the next fine tick with nothing focused, and further with Shift', () => {
    const { clock, press, release, run } = setup();
    expect(press('ArrowRight')).toBe(true);
    release('ArrowRight');
    run();
    expect(historicalCivil(clock.state().day)).toEqual({ year: 1816, month: 1, day: 1 });
    press('ArrowRight', document, { shift: true });
    run();
    expect(historicalCivil(clock.state().day).year).toBe(1820);
    press('ArrowLeft');
    release('ArrowLeft');
    run();
    expect(historicalCivil(clock.state().day).year).toBe(1818);
  });

  it('show more or fewer years with Up and Down, keeping the date', () => {
    const { clock, press, run, ruler } = setup();
    press('ArrowUp');
    run();
    expect(clock.state()).toEqual({ day: WATERLOO, spanDays: 500 * YEAR_DAYS });
    press('ArrowDown');
    press('ArrowDown');
    run();
    expect(clock.state().spanDays).toBeCloseTo(100 * YEAR_DAYS, 6);
    expect(ruler.sayYears).toHaveBeenCalledTimes(3);
  });

  it('give the Years shown slider Left and Right for fewer and more, Home and End for its limits', () => {
    const { clock, press, run, counter } = setup();
    press('ArrowRight', counter);
    run();
    expect(clock.state()).toEqual({ day: WATERLOO, spanDays: 500 * YEAR_DAYS });
    press('Home', counter);
    run();
    expect(clock.state()).toEqual({ day: WATERLOO, spanDays: MIN_EXPLORE_DAYS });
    press('End', counter);
    run();
    expect(clock.state()).toEqual({ day: WATERLOO, spanDays: MAX_EXPLORE_DAYS });
  });

  it('move exactly a span with PageUp and PageDown, each undoing the other', () => {
    const { clock, press, run } = setup();
    press('PageDown');
    run();
    expect(clock.state().day).toBe(WATERLOO - Y200);
    press('PageUp');
    run();
    expect(clock.state().day).toBe(WATERLOO);
  });

  it('fly to history’s ends with Home and End, and back with Backspace', () => {
    const { clock, press, run, ruler } = setup();
    press('Home');
    run();
    expect(clock.state().day).toBe(HISTORY.start);
    press('End');
    run();
    expect(clock.state().day).toBe(HISTORY.end);
    press('Backspace');
    run();
    expect(clock.state().day).toBe(HISTORY.start);
    expect(ruler.sayDate).toHaveBeenCalledTimes(3);
  });

  it('open the date entry with a digit, from anywhere but a text field', () => {
    const { press, ruler, plaque } = setup();
    press('1');
    expect(ruler.openEntry).toHaveBeenLastCalledWith('1');
    press('7', plaque);
    expect(ruler.openEntry).toHaveBeenLastCalledWith('7');
    expect(press('5', new FakeInput())).toBe(false);
    expect(ruler.openEntry).toHaveBeenCalledTimes(2);
  });

  it('leave + and - to the globe, and every key with Meta, Ctrl or Alt', () => {
    const { clock, press, run } = setup();
    const before = clock.state();
    for (const key of ['+', '-', '=', '_']) expect(press(key)).toBe(false);
    for (const held of [{ meta: true }, { ctrl: true }, { alt: true }])
      expect(press('ArrowRight', document, held)).toBe(false);
    run();
    expect(clock.state()).toBe(before);
  });

  it('leave a key another part took alone: the listbox’s arrows', () => {
    const { clock, run } = setup();
    const taken = new Key('keydown', 'ArrowRight', document);
    taken.preventDefault();
    win.dispatchEvent(taken);
    run();
    expect(clock.state().day).toBe(WATERLOO);
  });

  it('give the globe the arrows only while its own stop has the focus', () => {
    const { clock, control, keys, press, run } = setup();
    expect(control.arrowKeys).toBe(false);
    const globe = keys.globe as unknown as FakeElement;
    expect(globe.getAttribute('aria-label')).toBe(GLOBE_STOP);
    expect(globe.tabIndex).toBe(0);
    globe.dispatchEvent(new Event('focus'));
    expect(control.arrowKeys).toBe(true);
    expect((keys.caption as unknown as FakeElement).classList.contains('is-shown')).toBe(true);
    expect(press('ArrowRight', globe)).toBe(false);
    run();
    expect(clock.state().day).toBe(WATERLOO);
    globe.dispatchEvent(new Event('blur'));
    expect(control.arrowKeys).toBe(false);
  });

  it('glide while an arrow is held, and ease on to a tick once it is let go', () => {
    const { clock, press, release, run } = setup();
    press('ArrowRight');
    run(1200);
    press('ArrowRight', document, { repeat: true });
    const glided = clock.state().day;
    expect(glided - WATERLOO).toBeGreaterThan(0.2 * Y200);
    release('ArrowRight');
    run();
    const { month, day } = historicalCivil(clock.state().day);
    expect([month, day]).toEqual([1, 1]);
    expect(clock.state().day).toBeGreaterThan(glided);
  });

  it('let go of everything once disposed', () => {
    const { clock, keys, press, run } = setup();
    keys.dispose();
    expect(press('ArrowRight')).toBe(false);
    run();
    expect(clock.state().day).toBe(WATERLOO);
  });
});
