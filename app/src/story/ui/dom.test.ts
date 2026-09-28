import { describe, expect, it } from 'vitest';
import { onPress, passFocus } from './dom';

/** A control under onPress that counts its presses and knows whether it still has focus. */
function control() {
  const state = { presses: 0, focused: true };
  const element = Object.assign(new EventTarget(), {
    blur: () => {
      state.focused = false;
    },
  });
  onPress(element as unknown as HTMLElement, () => {
    state.presses += 1;
  });
  // A click's detail counts the pointer's clicks; one the keyboard makes has none.
  const press = (detail: number) => element.dispatchEvent(new CustomEvent('click', { detail }));
  // Enter's keydown, first or repeated while held; whether the control cancels its press.
  const enter = (repeat: boolean) => {
    const keydown = Object.assign(new Event('keydown', { cancelable: true }), {
      key: 'Enter',
      repeat,
    });
    element.dispatchEvent(keydown);
    return keydown.defaultPrevented;
  };
  return { state, press, enter };
}

describe('a pressed control', () => {
  it('lets focus go after a pointer press, and keeps it after a keyboard press', () => {
    const [pointer, keyboard] = [control(), control()];
    pointer.press(1);
    keyboard.press(0);
    expect([pointer.state, keyboard.state]).toEqual([
      { presses: 1, focused: false },
      { presses: 1, focused: true },
    ]);
  });

  it('is pressed once by a held Enter, its repeats cancelled', () => {
    const { enter } = control();
    expect([enter(false), enter(true), enter(true)]).toEqual([false, true, true]);
  });
});

describe('a control going out of reach', () => {
  /** A plaque with a link inside it, and a knob, on one page, each taking its focus when asked. */
  function page() {
    const doc: { activeElement: object | null } = { activeElement: null };
    const control = (parts: object[] = []) => {
      const c = {
        ownerDocument: doc,
        contains: (node: object) => node === c || parts.includes(node),
        focus: () => {
          doc.activeElement = c;
        },
      };
      return c;
    };
    const link = control();
    const [plaque, knob] = [control([link]), control()];
    const pass = () => passFocus(plaque as unknown as HTMLElement, knob as unknown as HTMLElement);
    return { doc, plaque, link, knob, pass };
  }

  it('hands the focus it holds to its heir, and takes none it does not hold', () => {
    const [held, elsewhere] = [page(), page()];
    held.plaque.focus();
    held.pass();
    elsewhere.pass();
    expect([held.doc.activeElement === held.knob, elsewhere.doc.activeElement]).toEqual([
      true,
      null,
    ]);
  });

  it('hands on the focus of anything inside it too', () => {
    const inside = page();
    inside.link.focus();
    inside.pass();
    expect(inside.doc.activeElement === inside.knob).toBe(true);
  });
});
