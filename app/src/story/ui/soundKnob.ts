// The sound knob at the top right, over Meanwhile: a small knurled brass knob, the ruler's knobs
// in miniature (rulerCraft.ts), with a speaker cut into its face and filled with niello. While
// sound is on the speaker sends out its waves; muted, a cross stands in their place and the knob
// falls into shadow. Pressing it mutes or unmutes, as the M key does (audio/walkAudio.ts). The
// Sound Cabinet's mute is the same knob.
import type { SoundSwitch } from '../contract';
import { button, svg } from './dom';
import { smallKnob } from './rulerCraft';

const CONE = 'M-10 -4 L-5 -4 L1 -9.5 L1 9.5 L-5 4 L-10 4 Z';
const WAVES = 'M4.5 -4.5 Q7.5 0 4.5 4.5 M7.5 -8 Q12.5 0 7.5 8';
const CROSS = 'M5 -4 L12 4 M12 -4 L5 4';
/** The knob's radius, px, as walkUi.css sizes it. */
const RADIUS = 17;

export class SoundKnob {
  readonly element: HTMLButtonElement;
  readonly #sound: SoundSwitch;
  #shown: boolean | null = null;

  constructor(sound: SoundSwitch) {
    this.#sound = sound;
    this.element = button('wu-sound wu-lit', 'Mute', () => {
      sound.toggle();
      this.update();
    });
    const body = smallKnob('wu-sound', RADIUS);
    body.classList.add('wu-sound-body');
    this.element.append(body, speaker());
    this.update();
  }

  /** Shows whether sound is on, which the M key changes too. */
  update(): void {
    const muted = this.#sound.muted;
    if (muted === this.#shown) return;
    this.#shown = muted;
    this.element.setAttribute('aria-pressed', String(muted));
    this.element.classList.toggle('is-muted', muted);
    this.element.title = muted ? 'Unmute (M)' : 'Mute (M)';
  }
}

/** The speaker, its waves and the cross, each cut twice: its lit lip, then the niello. */
function speaker(): SVGSVGElement {
  const face = svg('svg', {
    class: 'wu-sound-mark',
    viewBox: '-16 -16 32 32',
    'aria-hidden': 'true',
  });
  for (const [d, cls] of [
    [CONE, 'wu-niello'],
    [WAVES, 'wu-niello-line wu-sound-waves'],
    [CROSS, 'wu-niello-line wu-sound-cross'],
  ] as const) {
    face.append(
      svg('path', { d, class: `${cls} wu-lip`, transform: 'translate(0.5 0.8)' }),
      svg('path', { d, class: cls }),
    );
  }
  return face;
}
