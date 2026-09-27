// The Tambora walk's UI in the DOM (CreateWalkUi in ../contract.ts): the Wander mark, the beat
// card, the time ruler with the story's controls on it (rulerCraft.ts), the sound knob, Meanwhile,
// the Resume plaque and the climate legend (climateLegend.ts), in the instrument's materials: aged
// vellum in brass, dark cast brass and engraved gilt, lit by the scene's lamp from the upper left
// and under its lens (walkUi.css, its materials in tokens.css). Libre Baskerville for display and
// Source Serif 4 for reading.
import '@fontsource/libre-baskerville/400.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/400-italic.css';
import '@fontsource/source-serif-4/600.css';
import './tokens.css';
import './walkUi.css';
import type { CreateWalkUi, WalkUi } from '../contract';
import { BeatCard } from './card';
import { ClimateLegend } from './climateLegend';
import { button, el } from './dom';
import { MeanwhilePanel } from './meanwhile';
import { CraftRuler } from './rulerCraft';
import { SoundKnob } from './soundKnob';

export const createWalkUi: CreateWalkUi = (root, walk, meanwhile, sound): WalkUi => {
  const layer = el('div', 'wu');
  const card = new BeatCard();
  const ruler = new CraftRuler(walk, walk.state().story);
  const knob = new SoundKnob(sound);
  const panel = new MeanwhilePanel(walk, meanwhile);
  const resume = button('wu-resume wu-lit', 'Resume story', () => walk.resume());
  resume.textContent = 'Resume story';
  const legend = new ClimateLegend();
  layer.append(
    mark(),
    card.element,
    knob.element,
    panel.element,
    legend.element,
    ruler.element,
    resume,
  );
  root.append(layer);

  let away: boolean | null = null;
  return {
    update(state, view, climate) {
      card.update(state);
      ruler.update(state);
      knob.update();
      panel.update(state, view);
      legend.update(state.flight === null ? climate : null);
      if ((state.mode === 'breakout') !== away) {
        away = state.mode === 'breakout';
        resume.classList.toggle('is-shown', away);
        resume.tabIndex = away ? 0 : -1;
      }
    },
    rulerUnit: () => ruler.unit,
    dispose() {
      card.dispose();
      ruler.dispose();
      layer.remove();
    },
  };
};

/** The spike's wordmark: WANDER over a rule and its line. */
function mark(): HTMLElement {
  const header = el('header', 'wu-mark');
  const rule = el('div', 'wu-mark-rule');
  rule.append(el('span'), el('i', undefined, '✦'), el('span'));
  header.append(
    el('div', 'wu-mark-word', 'WANDER'),
    rule,
    el('div', 'wu-mark-sub', 'AN INTERACTIVE HISTORY'),
  );
  return header;
}
