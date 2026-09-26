// Entry of prototype-look.html: the surface look's harness, exposed to Playwright as
// window.lookHarness once its first frames have drawn.
import { PRESETS, runLookPage } from './lookPage';

const root = document.getElementById('stage');
const status = document.getElementById('status');
const buttons = document.getElementById('views');
if (!root || !status || !buttons) throw new Error('missing page elements');

runLookPage(root, status)
  .then((harness) => {
    window.lookHarness = harness;
    for (const name of Object.keys(PRESETS)) {
      const button = document.createElement('button');
      button.textContent = name;
      button.addEventListener('click', () => harness.view(name));
      buttons.appendChild(button);
    }
  })
  .catch((error: unknown) => {
    status.textContent = String(error);
    window.lookHarness = {
      ready: false,
      params: {},
      view: () => {},
      timeFrames: () => NaN,
      error: String(error),
    };
    throw error;
  });
