// The look prototype (prototype.html, dev only): the dev shell over the walk's boot (walk/boot.ts),
// with presets to fly between, a HUD, a lil-gui panel over every part's params, and hooks for
// scripts.
//
// Query: ?data=fixture|region|global|<origin> (a local bake's server by name, or any data server's
// origin; global when its server answers), ?view=<preset>, ?ui=0 (no panel or HUD, for
// screenshots), and any module param by name (?kLand=10, ?exposure=1.1, ?refinePx=1). The climate's
// alternate for the owner's choice lives here only: ?climateRangeK=6 saturates at ±6 K.
// window.__proto serves scripts (scripts/prototypeShots.ts).
//
// ?story=tambora|magellan walks the story instead of the presets, as the boot plays it. The panel hides
// behind a small gear at the top right. window.__walk serves scripts (scripts/walkShots.ts).
// Without a story the page starts in Explore (explore/explore.ts) where the view stands, its
// crafted ruler driving world time from 10,000 BCE through 2000 CE and the border steps following
// it, with the lobby, mark and sound knob for the way back; window.__worldTime serves
// scripts/exploreClockShots.ts, and window.__borders scripts/bordersShots.ts and bordersVideos.ts.
// On any page, window.__bordersTiming (bordersTiming.ts) times the borders on the GPU.
// A story's page shows Explore's plaque in its lobby wherever the release names its event index,
// as the production page does. ?memory=1 installs window.__wanderMemory() (perf/memoryHook.ts),
// and ?opening=Q… opens Explore on that opening (explore/openings.ts), as on the production page.
//
// Where the look draws the state names, window.__names serves scripts (scripts/namesShots.ts): what
// the last draw drew and the names' params, and the panel gains a Names folder; ?names=0 and
// ?namesMask=1 apply.
//
// ?markDemo boots in Explore with its marks cut into the look and sets the demo's (markDemo.ts),
// without the event index, so Explore's own event marks stay off; the panel gains a Marks folder,
// and ?marks=0 and the other marks params apply. The marks compile only where Explore stands, so
// ?markDemo with ?story stops the page, naming the conflict.
import type { Params } from '../../contract';
import type { NamesShown } from '../../look/stateNames';
import type { Release } from '../../data/release';
import { DATA_SERVERS, memoryRequested } from '../../page/dataOrigin';
import type { WalkState } from '../../story/contract';
import type { DirectedWalk, FlightRecord } from '../../story/director';
import { stories, storyNamed } from '../../story/catalog';
import type { LonLat } from '../../story/story';
import type { ViewControl } from '../../view/viewControl';
import type { ViewState } from '../../view/viewState';
import { bootWalk, WORLD, type StoryParts, type WalkStats } from '../../walk/boot';
import { serveBordersTiming } from './bordersTiming';
import { startMarkDemo } from './markDemo';
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
      /**
       * True once the flight to the beat is over and the streamer has been idle for a while, with
       * the beat's border step drawn where it lists borders.
       */
      landed(): boolean;
      flights(): readonly FlightRecord[];
      /** The story effects' params, as the panel's Story effects folder sets them. */
      effects(): Params;
    };
    __names?: {
      /** What the last draw drew. */
      shown(): NamesShown;
      /** The names' params (stateNames.ts, defaultNameParams). */
      params: Params;
    };
  }
}

async function main(): Promise<void> {
  const query = new URLSearchParams(location.search);
  const showUi = query.get('ui') !== '0';
  const source = storyNamed(query.get('story'));
  if (source && query.has('markDemo')) {
    throw new Error('?markDemo runs in Explore, where the marks compile: drop ?story');
  }
  const data = await pickData(query.get('data'));
  const releaseUrl = `${DATA_SERVERS[data] ?? data}/release.json`;
  const response = await fetch(releaseUrl);
  if (!response.ok) throw new Error(`${releaseUrl}: HTTP ${response.status}`);
  const release = (await response.json()) as Release;
  // The mark demo draws its marks alone: without the event index, Explore sets none beside them.
  if (query.has('markDemo')) delete release.events;

  const asked = query.get('view') ?? 'world';
  let preset = asked in PRESETS ? asked : 'world';
  const page = await bootWalk(document.body, release, {
    story: source ?? 'explore',
    stories,
    lobby: false,
    view: PRESETS[preset],
    tune: (params) => applyQuery(params, query),
  });
  if (memoryRequested(location)) {
    const { installMemoryHook } = await import('../../perf/memoryHook');
    installMemoryHook(page);
  }
  const { museum, look, streamer, control, cameraParams } = page;
  if (look.marks) {
    applyQuery(look.marks.params, query);
    if (query.has('markDemo')) startMarkDemo(look.marks, stories, museum, look.material, query);
  }
  const names = look.names;
  if (names) {
    applyQuery(names.params, query);
    window.__names = { shown: () => names.shown, params: names.params };
  }
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
        ...(look.marks ? { marks: look.marks.params } : {}),
        ...(look.names ? { names: look.names.params } : {}),
        streamer: streamer.params,
        camera: { ...cameraParams, view: page.stats().view },
      },
      null,
      2,
    );
  // A story's page steps through its beats instead of the presets.
  if (source) {
    document.body.classList.add('story');
    document.getElementById('presets')?.remove();
  }
  if (showUi) {
    buildUi({ museum, look, streamer, cameraParams, control, go, settings, story: page.story });
  } else {
    document.body.classList.add('clean');
  }

  addEventListener('keydown', (event) => {
    if (source || event.target instanceof HTMLInputElement) return;
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
  if (source)
    serveWalk(
      () => page.story?.walk ?? null,
      ready,
      () => page.story?.effects.params,
    );
  serveBordersTiming(museum, look.material);

  const hud = document.getElementById('hud');
  if (hud && showUi) setInterval(() => (hud.textContent = describe(stats())), 250);
}

/**
 * window.__walk, for scripts: `ready` is the page's own check that the streamer is idle and the
 * beat has its border step.
 */
function serveWalk(
  current: () => DirectedWalk | null,
  ready: () => boolean,
  effects: () => Params | undefined,
): void {
  const walk = () => {
    const active = current();
    if (!active) throw new Error('No story is running');
    return active;
  };
  window.__walk = {
    state: () => {
      const { beat, mode, flight, flying, day, advanceIn } = walk().state();
      return { beat, mode, flight, flying, day, advanceIn };
    },
    next: () => walk().next(),
    back: () => walk().back(),
    goTo: (beat) => walk().goTo(beat),
    togglePlay: () => walk().togglePlay(),
    resume: () => walk().resume(),
    scrub: (day) => walk().scrub(day),
    breakOut: () => walk().breakOut(),
    flyTo: (target, viewKm) => walk().flyTo(target, viewKm),
    landed: () => current()?.state().flight === null && ready(),
    flights: () => current()?.flights() ?? [],
    effects: () => {
      const params = effects();
      if (!params) throw new Error('No story is running');
      return params;
    },
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
  look: { params: Params; marks: { params: Params } | null; names: { params: Params } | null };
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
  if (look.marks) addParams(gui.addFolder('Marks'), look.marks.params);
  if (look.names) addParams(gui.addFolder('Names'), look.names.params);
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
