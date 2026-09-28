// The Tambora walk's UI in the DOM (CreateWalkUi in ../contract.ts): the beat card, the time ruler
// with the story's controls on it (rulerCraft.ts), Meanwhile,
// the Resume plaque, the climate legend (climateLegend.ts) and the borders' year plate
// (bordersPlate.ts), in the instrument's materials: aged vellum in brass, dark cast brass and
// engraved gilt, lit by the scene's lamp from the upper left and under its lens (walkUi.css, its
// materials in tokens.css). Libre Baskerville for display and Source Serif 4 for reading. The mark
// and sound knob belong to the page's persistent chrome.ts, shared with the lobby.
import '@fontsource/libre-baskerville/400.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/400-italic.css';
import '@fontsource/source-serif-4/600.css';
import './tokens.css';
import './walkUi.css';
import type { CreateWalkUi, WalkUi } from '../contract';
import { BordersPlate } from './bordersPlate';
import { BeatCard } from './card';
import { ClimateLegend } from './climateLegend';
import { button, el, passFocus } from './dom';
import { MeanwhilePanel } from './meanwhile';
import { CraftRuler } from './rulerCraft';

export const createWalkUi: CreateWalkUi = (root, walk, meanwhile, dataHost): WalkUi => {
  const layer = el('div', 'wu wu-story');
  const card = new BeatCard(dataHost);
  const ruler = new CraftRuler(walk, walk.state().story);
  const panel = new MeanwhilePanel(walk, meanwhile);
  const resume = button('wu-resume wu-lit', 'Resume story', () => walk.resume());
  resume.textContent = 'Resume story';
  const legend = new ClimateLegend();
  const plate = new BordersPlate();
  layer.append(plate.element, card.element, panel.element, legend.element, ruler.element, resume);
  root.append(layer);

  let away: boolean | null = null;
  return {
    update(state, view, climate, borders) {
      card.update(state);
      ruler.update(state);
      panel.update(state, view);
      legend.update(state.flight === null ? climate : null);
      plate.update(borders);
      if ((state.mode === 'breakout') !== away) {
        away = state.mode === 'breakout';
        resume.classList.toggle('is-shown', away);
        resume.tabIndex = away ? 0 : -1;
        if (!away) passFocus(resume, ruler.play);
      }
    },
    rulerUnit: () => ruler.unit,
    cardReach: () => card.element.offsetLeft + card.element.offsetWidth,
    leave() {
      layer.inert = true;
    },
    dispose() {
      card.dispose();
      ruler.dispose();
      layer.remove();
    },
  };
};
