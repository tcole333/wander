import { describe, expect, it } from 'vitest';
import { onPress } from './dom';

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
