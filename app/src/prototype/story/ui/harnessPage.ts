// The walk UI's harness (prototype-walk-ui.html, dev only): the real Tambora story and the walk's
// UI over a dark stand-in for the globe, driven by a stub director on timers. An ember marks where
// the beat's focal place falls on screen, to check the card never covers it. The card's images come
// from the global bake's local data server (npm run data -- --profile global), or another with
// ?data= (page/dataOrigin.ts), never the live data host, whose edge would keep a 404 for hours for
// an image not yet published.
//
// Keys: Space plays or pauses, the arrows step, B breaks out. Query: ?beat=<n> starts at beat n
// (1-8). window.__walkUi serves scripts: jump(beat) lands at once, walk is the stub director.
import storyText from '../../../../../stories/tambora/story.md?raw';
import storyLock from '../../../../../stories/tambora/story.lock.json';
import { DATA_SERVERS, dataOverride } from '../../../page/dataOrigin';
import { withLock } from '../../../story/lock';
import { meanwhileFromLock } from '../../../story/meanwhile';
import { parseStory } from '../../../story/story';
import { createWalkUi } from '../../../story/ui/walkUi';
import { WalkChrome } from '../../../story/ui/chrome';
import { HarnessWalk } from './harnessWalk';

declare global {
  interface Window {
    __walkUi?: { walk: HarnessWalk; jump(beat: number): void };
  }
}

const story = withLock(parseStory(storyText), storyLock);
const start = Math.max(0, Number(new URLSearchParams(location.search).get('beat') ?? 1) - 1);
const walk = new HarnessWalk(story, Math.min(start, story.beats.length - 1));
// A stand-in for the walk's sound, so the sound knob stands where it does in the walk.
const sound = {
  muted: false,
  toggle() {
    this.muted = !this.muted;
  },
};
const dataHost = dataOverride(location) ?? DATA_SERVERS.global ?? '';
const ui = createWalkUi(document.body, walk, meanwhileFromLock(storyLock), dataHost);
const chrome = new WalkChrome(document.body, sound, () => {});
chrome.show();
window.__walkUi = { walk, jump: (beat) => walk.jump(beat) };

addEventListener('keydown', (event) => {
  const actions: Record<string, () => void> = {
    ' ': () => walk.togglePlay(),
    ArrowRight: () => walk.next(),
    ArrowLeft: () => walk.back(),
    b: () => walk.breakOut(),
  };
  const action = actions[event.key];
  if (!action) return;
  event.preventDefault();
  action();
});

const KM_PER_DEG = 111.195;
const focal = document.getElementById('focal');
let last = performance.now();
const frame = (now: number) => {
  walk.update(now, Math.min(0.1, (now - last) / 1000));
  last = now;
  const state = walk.state();
  ui.update(state, walk.view);
  chrome.update();
  // Where the focal place falls in a flat view of the stub's camera, tilt ignored.
  const beat = state.story.beats[state.beat];
  const at = beat?.focal.at ?? beat?.camera.target;
  if (focal && at) {
    const { lon, lat, viewKm } = walk.view;
    const pxPerKm = innerWidth / viewKm;
    const east = (at[0] - lon) * Math.cos((lat * Math.PI) / 180) * KM_PER_DEG;
    const north = (at[1] - lat) * KM_PER_DEG;
    focal.style.transform = `translate(${innerWidth / 2 + east * pxPerKm}px, ${innerHeight / 2 - north * pxPerKm}px)`;
  }
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
