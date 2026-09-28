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
  return { state, press };
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
});

describe('a control going out of reach', () => {
  /** A plaque and a knob on one page, each taking the page's focus when asked. */
  function page() {
    const doc: { activeElement: object | null } = { activeElement: null };
    const control = () => {
      const c = {
        ownerDocument: doc,
        focus: () => {
          doc.activeElement = c;
        },
      };
      return c;
    };
    const [plaque, knob] = [control(), control()];
    const pass = () => passFocus(plaque as unknown as HTMLElement, knob as unknown as HTMLElement);
    return { doc, plaque, knob, pass };
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
});
