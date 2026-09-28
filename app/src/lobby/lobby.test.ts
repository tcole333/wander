import { readFileSync } from 'node:fs';
import { Group, PerspectiveCamera } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MuseumScene } from '../contract';
import { createWalk, type DirectedWalk } from '../story/director';
import { parseStory } from '../story/story';
import type { WalkChrome } from '../story/ui/chrome';
import { ViewControl } from '../view/viewControl';
import { createLobby } from './lobby';

// The real director, camera control, flights and lobby clock, with only the DOM and GPU replaced.
const drawn = vi.hoisted(() => ({
  choose: () => {},
  plaques: 0,
  glows: 0,
  shown: false,
  disposed: 0,
  glow: 0,
}));
vi.mock('./plaques', () => ({
  Plaques: class {
    element = {};
    constructor(_story: unknown, choose: () => void) {
      drawn.choose = choose;
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

const story = parseStory(
  readFileSync(new URL('../../../stories/tambora/story.md', import.meta.url), 'utf8'),
);
const DT = 1 / 60;

function setup(initial: 'lobby' | 'story' = 'lobby') {
  Object.assign(drawn, { plaques: 0, glows: 0, shown: false, disposed: 0, glow: 0 });
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const events = new EventTarget();
  vi.stubGlobal('addEventListener', events.addEventListener.bind(events));
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
  const begin = () => {
    walk = createWalk(story, control, { arrive: 'fly', ready: () => true });
    return walk;
  };
  const leave = vi.fn(() => walk?.breakOut());
  const finish = vi.fn(() => {
    walk?.dispose();
    walk = null;
  });
  const chrome = { lobby: vi.fn(), show: vi.fn(), mark: { focus: vi.fn() } };
  const lobby = createLobby({
    host: host as unknown as HTMLElement,
    story,
    places: [],
    museum: { params: {}, globeMount: new Group() } as unknown as MuseumScene,
    control,
    chrome: chrome as unknown as WalkChrome,
    initial,
    enter: begin,
    leave,
    finish,
    fail: (error) => {
      throw error;
    },
  });
  if (initial === 'story') walk = createWalk(story, control, { ready: () => true });
  const camera = new PerspectiveCamera();
  const tick = () => {
    now += DT * 1000;
    lobby.update(DT, camera);
    if (!lobby.returning) walk?.update(now, DT);
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
});
