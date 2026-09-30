// One mark and one sound knob for the whole visit. The lobby and walk keep this layer mounted
// through both flights; only the knob's position changes, beside Credits or over Meanwhile.
import type { SoundSwitch } from '../contract';
import { button, el } from './dom';
import { SoundKnob } from './soundKnob';

export class WalkChrome {
  readonly element = el('div', 'wu wu-chrome');
  readonly mark: HTMLButtonElement;
  readonly #knob: SoundKnob;

  constructor(root: HTMLElement, sound: SoundSwitch, back: () => void) {
    this.mark = button('wu-mark', 'Wander — return to lobby', back);
    this.mark.title = 'Return to lobby (Escape)';
    const rule = el('span', 'wu-mark-rule');
    rule.append(el('span'), el('i', undefined, '✦'), el('span'));
    this.mark.append(
      el('span', 'wu-mark-word', 'WANDER'),
      rule,
      el('span', 'wu-mark-sub', 'AN INTERACTIVE HISTORY'),
    );
    this.#knob = new SoundKnob(sound);
    this.element.append(this.mark, this.#knob.element);
    root.append(this.element);
  }

  /** The mark and the knob, which what stands under the layer keeps clear of. */
  get parts(): readonly HTMLElement[] {
    return [this.mark, this.#knob.element];
  }

  show(): void {
    this.element.classList.add('is-shown');
  }

  /**
   * Takes the focus the plaque gives up at the dive. The layer is not a control, so Space still
   * reaches the walk's play and pause; Tab leads on to the mark and the knob.
   */
  focus(): void {
    this.element.tabIndex = -1;
    this.element.focus({ preventScroll: true });
  }

  lobby(on: boolean): void {
    this.element.classList.toggle('in-lobby', on);
    this.mark.disabled = on;
  }

  update(): void {
    this.#knob.update();
  }

  dispose(): void {
    this.element.remove();
  }
}
