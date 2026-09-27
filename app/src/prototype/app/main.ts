// The look prototype (prototype.html, dev only): the dev shell over the walk's boot (walk/boot.ts),
// with presets to fly between, a HUD, a lil-gui panel over every part's params, and hooks for
// scripts.
//
// Query: ?data=fixture|region|global|<origin> (a local bake's server by name, or any data server's
// origin; global when its server answers), ?view=<preset>, ?ui=0 (no panel or HUD, for
// screenshots), and any module param by name (?kLand=10, ?exposure=1.1, ?refinePx=1).
// window.__proto serves scripts (scripts/prototypeShots.ts).
//
// ?story=tambora walks the story instead of the presets, as the boot plays it. The panel hides
// behind a small gear at the top right. window.__walk serves scripts (scripts/walkShots.ts).
import type { Params } from '../../contract';
import type { Release } from '../../data/release';
import { DATA_SERVERS } from '../../page/dataOrigin';
import type { WalkState } from '../../story/contract';
import type { DirectedWalk, FlightRecord } from '../../story/director';
import { meanwhileFromJson } from '../../story/meanwhile';
import { parseStory, type LonLat } from '../../story/story';
import type { ViewControl } from '../../view/viewControl';
import type { ViewState } from '../../view/viewState';
import {
  bootWalk,
  WORLD,
  type StoryParts,
  type StorySource,
  type WalkStats,
} from '../../walk/boot';
import { addParams, applyQuery, GUI, tuckAway } from './panel';

const TAMBORA = { lon: 118.0, lat: -8.25, heading: 0 };

/**
 * Keys 1-9 and 0 in this order. world's width is the widest the zoom allows; region and close are
 * the spike's REGION and CLOSE framings, for comparing like for like. The close views look down at
 * 25 degrees: at 45 the near rim hides Tambora's caldera floor, and its lit far wall reads as a
 * dome. The Himalaya reads as one range at 800 km; closer, its dissected flanks fill the frame.
 */
const PRESETS: Record<string, ViewState> = {
  world: WORLD,
  region: { lon: 105, lat: -2, viewKm: 16000, tilt: 0, heading: 0 },
  close: { ...TAMBORA, viewKm: 2700, tilt: 24 },
  sunda: { ...TAMBORA, viewKm: 1500, tilt: 20 },
  sumbawa: { ...TAMBORA, viewKm: 300, tilt: 45 },
  close100: { ...TAMBORA, viewKm: 100, tilt: 25 },
  close50: { ...TAMBORA, viewKm: 50, tilt: 25 },
  close30: { ...TAMBORA, viewKm: 30, tilt: 25 },
  himalaya: { lon: 86.5, lat: 28.5, viewKm: 800, tilt: 40, heading: 0 },
  mediterranean: { lon: 15, lat: 38, viewKm: 3000, tilt: 15, heading: 0 },
  magellan: { lon: -71, lat: -53.5, viewKm: 300, tilt: 45, heading: 0 },
};

/** The stories ?story= walks: the text, read by Vite, and Meanwhile's stand-in entries. */
const STORIES: Record<string, () => Promise<StorySource>> = {
  tambora: async () => {
    const [text, meanwhile] = await Promise.all([
      import('../../../../stories/tambora/story.md?raw'),
      import('../../story/meanwhile.tambora.json'),
    ]);
    return { story: parseStory(text.default), meanwhile: meanwhileFromJson(meanwhile.default) };
  },
};

/** The keys that fly to the presets, in order; the rest are on the preset bar alone. */
const PRESET_KEYS = '1234567890';

/** The camera params that drive kLand and kSea, shown in the look's folder. */
const RELIEF_BY_ZOOM = ['reliefByZoom', 'reliefNear', 'reliefFar'];

export interface ProtoStats extends WalkStats {
  data: string;
  preset: string;
}

declare global {
  interface Window {
    __proto?: {
      presets: string[];
      stats(): ProtoStats;
      /** True once the view has settled and the streamer has been idle for a while. */
      ready(): boolean;
      go(preset: string, instant?: boolean): void;
      /** Flies to any view, or jumps there. */
      view(view: ViewState, instant?: boolean): void;
      settings(): string;
      error?: string;
    };
    __walk?: {
      state(): Omit<WalkState, 'story'>;
      next(): void;
      back(): void;
      goTo(beat: number): void;
      togglePlay(): void;
      resume(): void;
      scrub(day: number): void;
      breakOut(): void;
      flyTo(target: LonLat, viewKm: number): void;
      /** True once the flight to the beat is over and the streamer has been idle for a while. */
      landed(): boolean;
      flights(): readonly FlightRecord[];
    };
  }
}

async function main(): Promise<void> {
  const query = new URLSearchParams(location.search);
  const showUi = query.get('ui') !== '0';
  const source = await loadStory(query.get('story'));
  const data = await pickData(query.get('data'));
  const releaseUrl = `${DATA_SERVERS[data] ?? data}/release.json`;
  const response = await fetch(releaseUrl);
  if (!response.ok) throw new Error(`${releaseUrl}: HTTP ${response.status}`);
  const release = (await response.json()) as Release;

  const asked = query.get('view') ?? 'world';
  let preset = asked in PRESETS ? asked : 'world';
  const page = await bootWalk(document.body, release, {
    story: source,
    view: PRESETS[preset],
    tune: (params) => applyQuery(params, query),
  });
  const { museum, look, streamer, control, cameraParams, story } = page;
  const go = (name: string, instant = false) => {
    const view = PRESETS[name];
    if (!view) return;
    preset = name;
    control.go(view, instant);
  };

  const settings = () =>
    JSON.stringify(
      {
        data,
        scene: withoutGimbal(museum.params),
        look: look.params,
        streamer: streamer.params,
        camera: { ...cameraParams, view: page.stats().view },
      },
      null,
      2,
    );
  // A story's page steps through its beats instead of the presets.
  if (story) {
    document.body.classList.add('story');
    document.getElementById('presets')?.remove();
  }
  if (showUi) {
    buildUi({ museum, look, streamer, cameraParams, control, go, settings, story });
  } else {
    document.body.classList.add('clean');
  }
  const walk = story?.walk ?? null;

  addEventListener('keydown', (event) => {
    if (walk || event.target instanceof HTMLInputElement) return;
    const name = Object.keys(PRESETS)[PRESET_KEYS.indexOf(event.key)];
    if (name) go(name);
  });

  const stats = (): ProtoStats => ({ ...page.stats(), data, preset });
  const ready = () => page.ready();
  window.__proto = {
    presets: Object.keys(PRESETS),
    stats,
    ready,
    go,
    view: (view, instant) => {
      preset = 'custom';
      control.go(view, instant);
    },
    settings,
  };
  if (walk) serveWalk(walk, ready);

  const hud = document.getElementById('hud');
  if (hud && showUi) setInterval(() => (hud.textContent = describe(stats())), 250);
}

async function loadStory(name: string | null): Promise<StorySource | null> {
  if (name === null) return null;
  const load = STORIES[name];
  if (!load) throw new Error(`no story '${name}'`);
  return load();
}

/** window.__walk, for scripts: `ready` is the page's own check that the streamer is idle. */
function serveWalk(walk: DirectedWalk, ready: () => boolean): void {
  window.__walk = {
    state: () => {
      const { beat, mode, flight, day, advanceIn } = walk.state();
      return { beat, mode, flight, day, advanceIn };
    },
    next: () => walk.next(),
    back: () => walk.back(),
    goTo: (beat) => walk.goTo(beat),
    togglePlay: () => walk.togglePlay(),
    resume: () => walk.resume(),
    scrub: (day) => walk.scrub(day),
    breakOut: () => walk.breakOut(),
    flyTo: (target, viewKm) => walk.flyTo(target, viewKm),
    landed: () => walk.state().flight === null && ready(),
    flights: () => walk.flights(),
  };
}

/** The scene's params without lat and lon, which the view drives. */
function withoutGimbal(params: Params): Params {
  const rest = { ...params };
  delete rest.lat;
  delete rest.lon;
  return rest;
}

function describe(s: ProtoStats): string {
  const levels = s.levels
    .map((count, level) => (count > 0 ? `L${level} ${count}` : ''))
    .filter(Boolean)
    .join('  ');
  const lat = `${Math.abs(s.view.lat).toFixed(2)}°${s.view.lat < 0 ? 'S' : 'N'}`;
  const lon = `${Math.abs(s.view.lon).toFixed(2)}°${s.view.lon < 0 ? 'W' : 'E'}`;
  return [
    `${s.fps.toFixed(0)} fps   p95 ${s.frameP95.toFixed(1)} ms`,
    `drawn ${s.drawn}   resident ${s.resident}   in flight ${s.inFlight + s.decoding + s.uploading}`,
    levels,
    `${lat} ${lon}   ${s.view.viewKm.toFixed(0)} km wide   ${s.altitudeKm.toFixed(0)} km up   tilt ${s.view.tilt.toFixed(0)}°`,
    `${s.data} bake`,
  ].join('\n');
}

interface UiParts {
  museum: { params: Params };
  look: { params: Params };
  streamer: { params: Params };
  cameraParams: Params;
  control: ViewControl;
  go: (name: string) => void;
  settings: () => string;
  story: StoryParts | null;
}

function buildUi(parts: UiParts): void {
  const { museum, look, streamer, cameraParams, control, go, settings, story } = parts;
  const bar = document.getElementById('presets');
  Object.keys(PRESETS).forEach((name, i) => {
    const button = document.createElement('button');
    button.textContent = `${PRESET_KEYS[i] ?? ''} ${name}`.trim();
    button.addEventListener('click', () => go(name));
    bar?.append(button);
  });

  const gui = new GUI({ title: 'Wander look' });
  const cameraFolder = gui.addFolder('Camera');
  addParams(cameraFolder, cameraParams, { skip: RELIEF_BY_ZOOM });
  // The goal is replaced as it moves, so the slider reads and writes it through accessors.
  const tilt = {
    get tilt() {
      return control.goal.tilt;
    },
    set tilt(value: number) {
      control.stop();
      control.goal = { ...control.goal, tilt: value };
    },
  };
  cameraFolder.add(tilt, 'tilt', 0, 80, 1).listen();
  addParams(gui.addFolder('Scene'), museum.params, { skip: ['lat', 'lon'] });
  // Relief exaggeration in one place: kLand and kSea follow the zoom, and are locked, while
  // reliefByZoom is on.
  const lookFolder = gui.addFolder('Surface look');
  const byZoom = addParams(lookFolder, cameraParams, { only: RELIEF_BY_ZOOM });
  const lookControls = addParams(lookFolder, look.params, { listen: ['kLand', 'kSea'] });
  const lockRelief = () => {
    for (const name of ['kLand', 'kSea']) {
      lookControls.get(name)?.disable(cameraParams.reliefByZoom === true);
    }
  };
  byZoom.get('reliefByZoom')?.onChange(lockRelief);
  lockRelief();
  addParams(gui.addFolder('Streamer').close(), streamer.params);
  // In a story the panel hides behind a gear, out of the walk's way.
  if (story) {
    addParams(gui.addFolder('Story effects'), story.effects.params);
    tuckAway(gui);
  }
  const copy = {
    'Copy settings': () => {
      const text = settings();
      navigator.clipboard.writeText(text).then(
        () => flash('Settings copied'),
        () => showText(text),
      );
    },
  };
  gui.add(copy, 'Copy settings');
}

function flash(message: string): void {
  const note = document.getElementById('note');
  if (!note) return;
  note.textContent = message;
  note.hidden = false;
  setTimeout(() => (note.hidden = true), 1600);
}

/** Where the clipboard is refused: the settings in a box to copy by hand. */
function showText(text: string): void {
  const box = document.createElement('textarea');
  box.id = 'settings';
  box.value = text;
  box.addEventListener('blur', () => box.remove());
  document.body.append(box);
  box.select();
  box.focus();
}

/**
 * A bake's name or an http(s) data server's origin: the one asked for, else global when it answers.
 * Anything else asked for throws, so the walk never quietly plays another bake.
 */
async function pickData(asked: string | null): Promise<string> {
  if (asked !== null) {
    if (Object.hasOwn(DATA_SERVERS, asked)) return asked;
    const url = URL.canParse(asked) ? new URL(asked) : null;
    if (url?.protocol === 'http:' || url?.protocol === 'https:') return url.origin;
    throw new Error(`no data server '${asked}'`);
  }
  try {
    const response = await fetch(`${DATA_SERVERS.global}/release.json`);
    if (response.ok) return 'global';
  } catch {
    // The global bake is not being served; the region bake is.
  }
  return 'region';
}

main().catch((error: unknown) => {
  console.error(error);
  const hud = document.getElementById('hud');
  if (hud) hud.textContent = `failed: ${String(error)}`;
  window.__proto = {
    presets: [],
    stats: () => {
      throw error;
    },
    ready: () => false,
    go: () => {},
    view: () => {},
    settings: () => '',
    error: String(error),
  };
});
