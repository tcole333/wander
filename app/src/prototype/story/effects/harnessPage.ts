// Entry of prototype-walk-effects.html (dev only): the walk's story effects on the look
// prototype's globe, set up as main.ts sets it up, with a stub walk state instead of the director.
// ?beat=<index> picks the beat and flies there with its camera; ?day=<yyyy-mm-dd> sets story time
// (the beat's date otherwise); the bar changes both. window.__walkFx serves screenshot scripts.
import storyText from '../../../../../stories/tambora/story.md?raw';
import { Mesh, PerspectiveCamera, WebGLRenderer } from 'three';
import type { Release } from '../../../data/release';
import { loadSurfaceLayer } from '../../../data/surfaceLayer';
import { ClearanceField } from '../../../globe/clearance';
import { CameraRig, maxViewKm, type Relief } from '../../../view/cameraRig';
import { addParams, applyQuery, GUI } from '../../app/panel';
import { ViewControl } from '../../../view/viewControl';
import { drawnView, reliefForWidth, type ViewState } from '../../../view/viewState';
import type { Params } from '../../../contract';
import { createSurfaceStreamer } from '../../../stream/streamer';
import { createSurfaceLook } from '../../../look/surfaceLook';
import { createMuseumScene } from '../../../scene/museumScene';
import type { WalkState } from '../../../story/contract';
import { dayFromIso, formatDay } from '../../../story/dates';
import { parseStory, type StoryBeat } from '../../../story/story';
import { createWalkEffects } from '../../../story/effects/walkEffects';

const DATA_HOSTS = { region: 'http://127.0.0.1:8792', global: 'http://127.0.0.1:8793' };
/** The slider's span: the story's dates, from the rumbling to the cholera. */
const SPAN: [string, string] = ['1815-03-01', '1818-01-01'];
const IDLE_MS = 1000;

declare global {
  interface Window {
    __walkFx?: {
      ready(): boolean;
      /** Flies to a beat's camera (or jumps there) and sets story time to its date. */
      beat(index: number, instant?: boolean): void;
      /** Sets story time, as a day number or an ISO date. */
      day(day: number | string): void;
      state(): { beat: number; day: string; view: ViewState; flying: boolean };
      error?: string;
    };
  }
}

function beatView(beat: StoryBeat): ViewState {
  const { target, viewKm, tilt, heading } = beat.camera;
  return { lon: target[0], lat: target[1], viewKm, tilt, heading };
}

function relief(params: Params): Relief {
  const flat = params.flatRelief === true;
  return {
    kLand: flat ? 0 : Number(params.kLand),
    kSeaEff: flat || params.bathymetry !== true ? 0 : Number(params.kSea),
  };
}

async function main(): Promise<void> {
  const query = new URLSearchParams(location.search);
  const story = parseStory(storyText);
  const asked = query.get('data');
  const data = asked === 'region' ? 'region' : 'global';
  const release = (await (await fetch(`${DATA_HOSTS[data]}/release.json`)).json()) as Release;

  const renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  document.body.prepend(renderer.domElement);
  const museum = createMuseumScene(renderer);
  museum.setSize(innerWidth, innerHeight, Math.min(devicePixelRatio, 2));
  const [streamer, layer] = await Promise.all([
    createSurfaceStreamer(renderer, release),
    loadSurfaceLayer(release),
  ]);
  const look = createSurfaceLook(streamer.pools, release.surface);
  const rig = new CameraRig(new ClearanceField(layer));
  const globe = new Mesh(streamer.geometry, look.material);
  globe.frustumCulled = false;
  globe.castShadow = true;
  globe.receiveShadow = true;
  globe.customDepthMaterial = look.depthMaterial;
  museum.globeMount.add(globe);

  const labels = document.getElementById('labels');
  if (!labels) throw new Error('missing #labels');
  const effects = createWalkEffects(story, look, labels);
  museum.globeMount.add(effects.group);
  for (const params of [effects.params, look.params, museum.params]) applyQuery(params, query);

  const first = Math.min(story.beats.length - 1, Math.max(0, Number(query.get('beat') ?? 1)));
  const firstBeat = story.beats[first];
  if (!firstBeat) throw new Error('the story has no beats');
  const askedDay = query.get('day');
  const state: WalkState = {
    story,
    beat: first,
    mode: 'paused',
    flight: null,
    day: askedDay ? dayFromIso(askedDay) : firstBeat.day,
    advanceIn: null,
  };

  const camera = new PerspectiveCamera(30, innerWidth / innerHeight, 0.01, 100);
  const control = new ViewControl(beatView(firstBeat));
  control.maxKm = maxViewKm(camera);
  control.go(control.goal, true);
  control.attach(renderer.domElement);

  const ui = buildUi(story.beats, state, (index) => goBeat(index, false));
  const goBeat = (index: number, instant: boolean) => {
    const beat = story.beats[index];
    if (!beat) return;
    state.beat = index;
    state.day = beat.day;
    control.go(beatView(beat), instant);
    ui.refresh();
  };
  const setDay = (day: number) => {
    state.day = day;
    ui.refresh();
  };
  ui.onDay(setDay);
  if (query.get('ui') === '0') document.body.classList.add('clean');
  else addParams(new GUI({ title: 'Walk effects' }), effects.params);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    museum.setSize(innerWidth, innerHeight, Math.min(devicePixelRatio, 2));
  });

  let last = performance.now();
  let idleSince = Infinity;
  window.__walkFx = {
    ready: () => performance.now() - idleSince >= IDLE_MS,
    beat: goBeat,
    day: (day) => setDay(typeof day === 'string' ? dayFromIso(day) : day),
    state: () => ({
      beat: state.beat,
      day: formatDay(state.day),
      view: control.current,
      flying: control.flying,
    }),
  };

  renderer.setAnimationLoop((now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    control.maxKm = maxViewKm(camera);
    control.step(now, dt);
    const view = control.current;
    // Relief follows the zoom, as in the prototype: x8 wide, x2 close.
    const k = reliefForWidth(view.viewKm, 2, 8);
    look.params.kLand = k;
    look.params.kSea = k;
    const surfaceRelief = relief(look.params);
    const drawn = drawnView(view);
    [museum.params.lon, museum.params.lat] = rig.gimbalFacing(camera, drawn, surfaceRelief);
    museum.update(camera, now / 1000);
    rig.place(camera, drawn, surfaceRelief, museum.globeMount, Number(museum.params.hideAltitude));
    const viewport = { width: innerWidth, height: innerHeight };
    streamer.update(camera, viewport, museum.globeMount);
    state.flight = control.flying ? 0.5 : null;
    effects.update(state, camera, museum.globeMount, viewport, now / 1000);
    look.update(now / 1000);
    museum.render(camera);

    const s = streamer.stats();
    const busy = s.inFlight + s.decoding + s.uploading > 0;
    idleSince = busy || !control.settled ? Infinity : Math.min(idleSince, now);
  });
}

interface Ui {
  refresh(): void;
  onDay(listener: (day: number) => void): void;
}

function buildUi(beats: StoryBeat[], state: WalkState, pick: (index: number) => void): Ui {
  const bar = document.getElementById('beats');
  const slider = document.getElementById('day') as HTMLInputElement | null;
  const label = document.getElementById('date');
  const buttons = beats.map((beat, i) => {
    const button = document.createElement('button');
    button.textContent = `${i + 1} ${beat.title}`;
    button.addEventListener('click', () => pick(i));
    bar?.append(button);
    return button;
  });
  if (slider) {
    slider.min = String(dayFromIso(SPAN[0]));
    slider.max = String(dayFromIso(SPAN[1]));
  }
  let listener: (day: number) => void = () => {};
  slider?.addEventListener('input', () => listener(Number(slider.value)));
  const step = (days: number) => () => listener(Math.round(state.day) + days);
  document.getElementById('back')?.addEventListener('click', step(-1));
  document.getElementById('forward')?.addEventListener('click', step(1));
  addEventListener('keydown', (event) => {
    const index = Number(event.key) - 1;
    if (event.target instanceof HTMLInputElement || !(index >= 0 && index < beats.length)) return;
    pick(index);
  });
  const refresh = () => {
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === state.beat)));
    if (slider) slider.value = String(state.day);
    if (label) label.textContent = formatDay(state.day);
  };
  refresh();
  return {
    refresh,
    onDay(next) {
      listener = next;
    },
  };
}

main().catch((error: unknown) => {
  console.error(error);
  window.__walkFx = {
    ready: () => false,
    beat: () => {},
    day: () => {},
    state: () => {
      throw error;
    },
    error: String(error),
  };
});
