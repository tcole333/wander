import { Group, PerspectiveCamera } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WalkAudio } from '../audio/walkAudio';
import type { MuseumScene } from '../contract';
import { startExplore } from '../explore/explore';
import { openings } from '../explore/openings';
import { createWalk, type DirectedWalk } from '../story/director';
import { stories, storyNamed } from '../story/catalog';
import type { Story } from '../story/story';
import type { WalkChrome } from '../story/ui/chrome';
import { ViewControl } from '../view/viewControl';
import type { Choice, Mode } from '../walk/mode';
import { createLobby } from './lobby';

// The real director, Explore, camera control, flights and lobby clock, with only the DOM and GPU
// replaced.
const drawn = vi.hoisted(() => ({
  choose: (id = 'tambora'): void => {
    throw new Error(`No plaque for ${id}`);
  },
  ids: [] as string[],
  explore: false,
  plaques: 0,
  glows: 0,
  shown: false,
  disposed: 0,
  glow: 0,
}));
vi.mock('./plaques', () => ({
  Plaques: class {
    element = {};
    constructor(stories: readonly Story[], choose: (choice: Choice) => void, explore = false) {
      drawn.ids = stories.map((story) => story.id);
      drawn.explore = explore;
      drawn.choose = (id = 'tambora') =>
        choose(
          id === 'explore'
            ? { kind: 'explore' }
            : { kind: 'story', story: stories.find((story) => story.id === id)! },
        );
      drawn.plaques++;
    }
    reach = () => 386;
    show = () => (drawn.shown = true);
    leave = () => (drawn.shown = false);
    focus = () => {};
    dispose = () => drawn.disposed++;
  },
}));
vi.mock('./glows', async () => {
  const { Group } = await import('three');
  return {
    Glows: class {
      points = new Group();
      constructor() {
        drawn.glows++;
      }
      update(_camera: unknown, _mount: unknown, _elapsed: number, glow: number) {
        drawn.glow = glow;
      }
      dispose = () => drawn.disposed++;
    },
  };
});

vi.mock('../story/ui/rulerCraft', () => ({
  CraftRuler: class {
    element = {};
    dispose() {}
  },
}));
vi.mock('../explore/timeKeys', () => ({
  bindTimeKeys(_time: unknown, _ruler: unknown, control: { arrowKeys: boolean }) {
    control.arrowKeys = false;
    return { globe: {}, caption: {}, dispose() {} };
  },
}));
vi.mock('../explore/timeRuler', () => ({
  TimeRuler: class {
    element = { after() {} };
    panels = [];
    pin = null;
    unit = 'year';
    yearStep = 20;
    frame() {}
    dispose() {}
  },
}));
vi.mock('../story/ui/dom', () => ({
  el: () => ({ append() {}, prepend() {}, remove() {}, inert: false }),
}));

const story = storyNamed('tambora')!.story;
const DT = 1 / 60;
const WATERLOO = openings.find((opening) => opening.qid === 'Q48314')!;

/** The story mode as the boot makes it, less its effects, UI and sound. */
function storyMode(walk: DirectedWalk): Mode {
  return {
    landed: (cb) =>
      walk.subscribe((state) => {
        if (state.flight === null) cb();
      }),
    lensShift: () => 0,
    beforeCamera: (nowMs, dtS) => walk.update(nowMs, dtS),
    afterPlace() {},
    ui() {},
    audio: () => null,
    leave: () => walk.breakOut(),
    end: () => walk.dispose(),
    inspectMemory() {},
  };
}

function setup(initial: 'lobby' | 'story' | 'explore' = 'lobby') {
  Object.assign(drawn, { plaques: 0, glows: 0, shown: false, disposed: 0, glow: 0 });
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const events = new EventTarget();
  vi.stubGlobal('addEventListener', events.addEventListener.bind(events));
  vi.stubGlobal('window', {});
  const classes = new Set<string>();
  const host = {
    dataset: {} as Record<string, string>,
    classList: {
      add: (...names: string[]) => names.forEach((name) => classes.add(name)),
      remove: (...names: string[]) => names.forEach((name) => classes.delete(name)),
    },
    append() {},
  };
  const control = new ViewControl({ lon: 75, lat: 15, viewKm: 30000, tilt: 0, heading: 0 });
  control.maxKm = 30000;
  let walk: DirectedWalk | null = null;
  let mode: Mode | null = null;
  const sound = { leave: vi.fn() } as unknown as WalkAudio;
  const begin = (choice: Choice, arrive: 'fly' | 'jump' = 'fly'): Mode => {
    if (choice.kind === 'explore') {
      walk = null;
      mode = startExplore({
        root: host as unknown as HTMLElement,
        control,
        sound,
        arrive,
        opening: WATERLOO,
      });
      return mode;
    }
    walk = createWalk(choice.story, control, { arrive, ready: () => true });
    mode = storyMode(walk);
    return mode;
  };
  const leave = vi.fn(() => mode?.leave());
  const finish = vi.fn(() => {
    mode?.end();
    mode = null;
    walk = null;
  });
  const chrome = { lobby: vi.fn(), show: vi.fn(), focus: vi.fn(), mark: {} };
  const lobby = createLobby({
    host: host as unknown as HTMLElement,
    stories: stories.map(({ story }) => story),
    places: [],
    museum: { params: {}, globeMount: new Group() } as unknown as MuseumScene,
    control,
    chrome: chrome as unknown as WalkChrome,
    explore: true,
    initial,
    enter: (choice) => begin(choice),
    leave,
    finish,
    fail: (error) => {
      throw error;
    },
  });
  if (initial === 'story') begin({ kind: 'story', story }, 'jump');
  if (initial === 'explore') begin({ kind: 'explore' }, 'jump');
  const camera = new PerspectiveCamera();
  const tick = () => {
    now += DT * 1000;
    lobby.update(DT, camera);
    if (!lobby.returning) mode?.beforeCamera(now, DT);
    control.step(now, DT);
  };
  const until = (ready: () => boolean) => {
    for (let frame = 0; !ready() && frame < 1200; frame++) tick();
    expect(ready()).toBe(true);
  };
  const key = (consumed = false) => {
    const event = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' });
    if (consumed) event.preventDefault();
    events.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return {
    lobby,
    control,
    host,
    classes,
    chrome,
    leave,
    finish,
    tick,
    until,
    key,
    walk: () => walk!,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the lobby round trip', () => {
  it('reuses its plaques and glows for ten trips, disposes each walk, and starts on beat 1', () => {
    const s = setup();
    s.until(() => s.host.dataset.lobby === 'idle');
    for (let trip = 0; trip < 10; trip++) {
      const home = { ...s.control.current };
      drawn.choose();
      expect(s.walk().state()).toMatchObject({ beat: 0, mode: 'paused', flight: 0 });
      s.until(() => s.host.dataset.lobby === 'gone');
      s.walk().next();
      s.until(() => s.walk().state().flight === null);
      expect(s.walk().state().beat).toBe(1);
      s.walk().scrub(s.walk().state().day + 300);
      s.lobby.back();
      expect(s.control.enabled).toBe(false);
      s.lobby.back(); // A repeated press does not start another return.
      s.until(() => s.host.dataset.lobby === 'idle');
      expect(s.control.current).toEqual(home);
      expect(s.control.enabled).toBe(true);
      expect(s.control.arrowKeys).toBe(true);
      expect(s.classes.size).toBe(0);
      expect(drawn.shown).toBe(true);
      expect(drawn.glow).toBe(1);
    }
    expect(s.leave).toHaveBeenCalledTimes(10);
    expect(s.finish).toHaveBeenCalledTimes(10);
    expect([drawn.plaques, drawn.glows, drawn.disposed]).toEqual([1, 1, 0]);
    s.lobby.dispose();
    expect(drawn.disposed).toBe(2);
  });

  it('chooses either story after a return, with its own date and camera on a fresh beat 1', () => {
    const s = setup();
    s.until(() => s.host.dataset.lobby === 'idle');
    expect(drawn.ids).toEqual(['tambora', 'magellan']);
    for (const id of ['magellan', 'tambora', 'magellan']) {
      const chosen = storyNamed(id)!.story;
      const first = chosen.beats[0]!;
      drawn.choose(id);
      expect(s.walk().state()).toMatchObject({
        story: chosen,
        beat: 0,
        day: first.day,
        mode: 'paused',
      });
      s.until(() => s.host.dataset.lobby === 'gone');
      expect(s.control.current).toMatchObject({
        lon: first.camera.target[0],
        lat: first.camera.target[1],
        viewKm: first.camera.viewKm,
      });
      s.walk().next();
      s.until(() => s.walk().state().flight === null);
      expect(s.walk().state().day).toBe(chosen.beats[1]!.day);
      s.key();
      s.until(() => s.host.dataset.lobby === 'idle');
    }
    expect(s.finish).toHaveBeenCalledTimes(3);
    s.lobby.dispose();
  });

  it('can return before the dive draws, without a late arrival revealing the old walk', () => {
    const s = setup();
    s.until(() => s.host.dataset.lobby === 'idle');
    drawn.choose();
    expect(s.classes.has('lobby-ruler-down')).toBe(true);
    s.lobby.back();
    expect(s.host.dataset.lobby).toBe('returning');
    expect([...s.classes]).toEqual(['lobby-return']);
    s.until(() => s.host.dataset.lobby === 'idle');
    drawn.choose();
    s.until(() => s.host.dataset.lobby === 'gone');
    expect(s.walk().state().beat).toBe(0);
    s.lobby.dispose();
  });

  it('gives the dev page a lobby and lets a closer consume Escape first', () => {
    const s = setup('story');
    expect(s.host.dataset.lobby).toBe('gone');
    s.lobby.back();
    expect(s.leave).not.toHaveBeenCalled(); // Before boot's first frame, no story can leave yet.
    s.tick();
    s.key(true);
    expect(s.leave).not.toHaveBeenCalled();
    s.walk().breakOut();
    expect(s.key()).toBe(true);
    expect(s.host.dataset.lobby).toBe('returning');
    s.until(() => s.host.dataset.lobby === 'idle');
    expect(s.control.current.viewKm).toBe(30000);
    expect(s.key()).toBe(false);
    s.lobby.dispose();
    s.host.dataset.lobby = 'gone';
    s.key();
    expect(s.leave).toHaveBeenCalledTimes(1);
  });

  it('cancels a dive subscription on disposal', () => {
    const s = setup();
    s.until(() => s.host.dataset.lobby === 'idle');
    drawn.choose();
    s.lobby.dispose();
    s.walk().breakOut();
    expect(s.host.dataset.lobby).toBeUndefined();
    expect(s.classes.size).toBe(0);
  });

  it('shows Explore’s plaque, dives onto the opening and returns to the same home', () => {
    const s = setup();
    s.until(() => s.host.dataset.lobby === 'idle');
    expect(drawn.explore).toBe(true);
    for (let trip = 0; trip < 3; trip++) {
      const home = { ...s.control.current };
      drawn.choose('explore');
      expect(s.host.dataset.lobby).toBe('diving');
      // In Explore the arrow keys move time; the globe takes them from its own stop.
      expect(s.control.arrowKeys).toBe(false);
      s.until(() => s.host.dataset.lobby === 'gone');
      expect(s.control.current.lon).toBeCloseTo(WATERLOO.at[0], 6);
      expect(window.__worldTime?.state().day).toBe(WATERLOO.day);
      s.key();
      expect(s.host.dataset.lobby).toBe('returning');
      s.until(() => s.host.dataset.lobby === 'idle');
      expect(s.control.current).toEqual(home);
      expect(s.control.arrowKeys).toBe(true);
      expect(s.classes.size).toBe(0);
      expect(window.__worldTime).toBeUndefined();
    }
    expect(s.leave).toHaveBeenCalledTimes(3);
    expect(s.finish).toHaveBeenCalledTimes(3);
    s.lobby.dispose();
  });

  it('gives the dev page’s Explore a lobby to return to', () => {
    const s = setup('explore');
    expect(s.host.dataset.lobby).toBe('gone');
    s.tick();
    expect(window.__worldTime).toBeDefined();
    s.lobby.back();
    s.until(() => s.host.dataset.lobby === 'idle');
    expect(s.control.current.viewKm).toBe(30000);
    expect(window.__worldTime).toBeUndefined();
    s.lobby.dispose();
  });
});
