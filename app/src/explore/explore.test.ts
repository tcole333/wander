import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, PerspectiveCamera, Scene, Vector3 } from 'three';
import type { EventReply } from '../events/runtime';
import type { MarkLayer, MarkSpec } from '../marks/marks';
import { MemoryAccount } from '../perf/memory';
import { FrameContext } from '../scene/frameContext';
import { dayFromIso } from '../story/dates';
import { lonLatToDir, toThree } from '../surface/cube';
import { pageOf, releaseOf } from '../test/events';
import { WorldClock } from '../time/worldClock';
import { ViewControl } from '../view/viewControl';
import type { WalkAudio } from '../audio/walkAudio';
import { startExplore, waterloo, worldViewOn, type EventsSource } from './explore';

// The real clock, flight and view control, with the ruler and its layer standing in for the DOM.
const drawn = vi.hoisted(() => ({
  rulers: 0,
  disposed: 0,
  layers: [] as FakeLayer[],
  /** The part that throws as it is built, if any. */
  broken: null as 'ruler' | 'flight' | 'worker' | null,
  /** The event clients started, standing in for the worker. */
  clients: [] as FakeClient[],
}));
interface FakeLayer {
  className: string;
  children: unknown[];
  inert: boolean;
  removed: boolean;
  dataset: Record<string, string>;
  append(...nodes: unknown[]): void;
  remove(): void;
}
/** The event client, answering each query with Waterloo's mark. */
interface FakeClient {
  asked: { focalQids?: number[] }[];
  disposed: boolean;
  query(query: { focalQids?: number[] }): void;
  drain(now: number): EventReply[];
  idle(): boolean;
  dispose(): void;
}
vi.mock('../events/client', () => ({
  EventClient: {
    create() {
      if (drawn.broken === 'worker') throw new Error('the worker cannot start');
      const classes = ['battle'];
      const client: FakeClient = {
        asked: [],
        disposed: false,
        query(query) {
          client.asked.push(query);
        },
        drain(now) {
          if (client.asked.length === 0) return [];
          const plan = { needs: [], resident: [], bytes: 4096, complete: true };
          const fade = { phase: 'steady' as const, from: 1, to: 1, start: now, duration: 0 };
          const [lon, lat] = [4.41222, 50.67806];
          const mark = {
            row: 39,
            qid: 48314,
            at: [lon, lat] as [number, number],
            x: 0,
            y: 0,
            anchorVisible: true,
            score: 900,
            cls: 0,
            t0: 662717,
            t1: 662717,
            prec: 11,
            flags: 0,
            unc: 0,
            parent: -1,
            focal: true,
            context: false,
            fade,
          };
          const result = { markers: [mark], labels: [], outlines: [], missingFocal: [] };
          return [
            { type: 'state', plan, classes },
            { type: 'result', generation: client.asked.length, result, plan },
          ];
        },
        idle: () => true,
        dispose() {
          client.disposed = true;
        },
      };
      drawn.clients.push(client);
      return client;
    },
  },
}));
vi.mock('../story/ui/rulerCraft', () => ({
  CraftRuler: class {
    element = { ruler: true };
    // What the ruler engraves at the world view's span: years, labelled every decade.
    unit = 'year';
    yearStep = 10;
    constructor() {
      if (drawn.broken === 'ruler') throw new Error('the ruler cannot be drawn');
      drawn.rulers++;
    }
    dispose() {
      drawn.disposed++;
    }
  },
}));
vi.mock('../view/freeFlight', async (importOriginal) => {
  const { FreeFlight } = await importOriginal<typeof import('../view/freeFlight')>();
  return {
    FreeFlight: class extends FreeFlight {
      constructor(...path: ConstructorParameters<typeof FreeFlight>) {
        if (drawn.broken === 'flight') throw new Error('the flight cannot be planned');
        super(...path);
      }
    },
  };
});
vi.mock('../story/ui/dom', () => ({
  el: (_tag: string, className = '') => {
    const layer: FakeLayer = {
      className,
      children: [],
      inert: false,
      removed: false,
      dataset: {},
      append(...nodes) {
        this.children.push(...nodes);
      },
      remove() {
        this.removed = true;
      },
    };
    drawn.layers.push(layer);
    return layer;
  },
}));

const DT = 1 / 60;
const WORLD_KM = 30000;

/** The look's marks as Explore's events set them. */
function marksLayer() {
  const layer = {
    specs: [] as MarkSpec[],
    strength: 1,
    set(_source: string, specs: readonly MarkSpec[]) {
      layer.specs = [...specs];
    },
    placed: () => layer.specs.map((s) => ({ id: s.id, x: 100, y: 100, rPx: 8, alpha: 1 })),
  };
  return layer;
}

/** The frame the boot places, the camera 9 radii above (lon, lat). */
function frameOver(lon: number, lat: number): FrameContext {
  const scene = new Scene();
  const globe = new Group();
  scene.add(globe);
  const cam = new PerspectiveCamera(30, 1440 / 900, 0.01, 100);
  cam.position.copy(new Vector3(...toThree(lonLatToDir(lon, lat)))).multiplyScalar(10);
  cam.lookAt(0, 0, 0);
  scene.add(cam);
  scene.updateMatrixWorld(true);
  const frame = new FrameContext();
  frame.place(cam, globe, { width: 1440, height: 900 });
  return frame;
}

function setup(arrive: 'fly' | 'jump' = 'fly', events: EventsSource | null = null) {
  Object.assign(drawn, { rulers: 0, disposed: 0, layers: [], broken: null, clients: [] });
  const clock = new WorldClock();
  const control = new ViewControl({ lon: 75, lat: 15, viewKm: WORLD_KM, tilt: 0, heading: 0 });
  control.maxKm = WORLD_KM;
  // As a story leaves them, stepping its beats.
  control.arrowKeys = false;
  const leaveSound = vi.fn();
  const append = vi.fn();
  const sound = { leave: leaveSound } as unknown as WalkAudio;
  const root = { append } as unknown as HTMLElement;
  const mode = startExplore({ root, control, sound, arrive, clock, events });
  let now = 0;
  const tick = () => {
    now += DT * 1000;
    mode.beforeCamera(now, DT);
    control.step(now, DT);
  };
  return { clock, control, leaveSound, append, mode, tick };
}

beforeEach(() => {
  vi.stubGlobal('window', {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Explore', () => {
  it('opens the clock on Waterloo, the ruler showing 200 years around it', () => {
    const { clock, append } = setup();
    expect(clock.state()).toEqual({ day: dayFromIso('1815-06-18'), spanDays: 200 * 365.2425 });
    expect(drawn.rulers).toBe(1);
    const layer = drawn.layers[0]!;
    expect(layer.className).toBe('wu wu-explore wu-mode');
    expect(append).toHaveBeenCalledWith(layer);
    expect(window.__worldTime?.state()).toBe(clock.state());
  });

  it('flies to the world view over the opening and lands once', () => {
    const { control, mode, tick } = setup();
    const landed = vi.fn();
    mode.landed(landed);
    for (let frame = 0; frame < 600 && !landed.mock.calls.length; frame++) tick();
    expect(landed).toHaveBeenCalledTimes(1);
    expect(control.current.lon).toBeCloseTo(waterloo().at[0], 6);
    // Waterloo's 50.7°N is held to 35°N, so the event stands on the lit face.
    expect(control.current.lat).toBeCloseTo(35, 6);
    expect(control.current.viewKm).toBeCloseTo(WORLD_KM, 3);
    tick();
    expect(landed).toHaveBeenCalledTimes(1);
  });

  it('lands at once when the visitor takes the view during the dive', () => {
    const { control, mode, tick } = setup();
    const landed = vi.fn();
    mode.landed(landed);
    tick();
    control.onInput();
    expect(landed).toHaveBeenCalledTimes(1);
    const view = { ...control.current };
    tick();
    expect(control.current).toEqual(view);
  });

  it('starts where the view stands on the dev page, keeping the arrow keys', () => {
    const { control, mode, tick } = setup('jump');
    expect(control.arrowKeys).toBe(true);
    const landed = vi.fn();
    mode.landed(landed);
    const view = { ...control.current };
    tick();
    expect(control.current).toEqual(view);
    expect(landed).not.toHaveBeenCalled();
  });

  it("tells its sound the clock's day, the ruler's engraving and the dive's flight", () => {
    const { clock, mode, tick } = setup();
    const heard = (flying: boolean) => ({
      clock: { day: clock.state().day, unit: 'year', yearStep: 10 },
      flying,
    });
    expect(mode.audio()).toEqual(heard(true));
    tick();
    expect(mode.audio()).toEqual(heard(true));
    const landed = vi.fn();
    mode.landed(landed);
    for (let frame = 0; frame < 600 && !landed.mock.calls.length; frame++) tick();
    expect(mode.audio()).toEqual(heard(false));
    window.__worldTime?.seek(dayFromIso('1066-10-14'));
    expect(mode.audio()).toMatchObject({ clock: { day: dayFromIso('1066-10-14') } });
    expect(mode.audio()).toEqual(heard(false));
  });

  it('tells its sound the dive has landed once the visitor takes the view', () => {
    const { control, mode, tick } = setup();
    tick();
    control.onInput();
    expect(mode.audio()).toMatchObject({ flying: false });
  });

  it('gives its sound nothing to follow once it has left', () => {
    const { mode, tick } = setup();
    tick();
    mode.leave();
    expect(mode.audio()).toBeNull();
    tick();
    expect(mode.audio()).toBeNull();
  });

  it('leaves, then releases its ruler, layer and script hook', () => {
    const { mode, leaveSound, tick } = setup();
    const landed = vi.fn();
    mode.landed(landed);
    tick();
    mode.leave();
    expect(drawn.layers[0]!.inert).toBe(true);
    expect(leaveSound).toHaveBeenCalledTimes(1);
    for (let frame = 0; frame < 600; frame++) tick();
    expect(landed).not.toHaveBeenCalled();
    mode.end();
    expect(drawn.disposed).toBe(1);
    expect(drawn.layers[0]!.removed).toBe(true);
    expect(window.__worldTime).toBeUndefined();
  });

  it.each(['ruler', 'flight'] as const)(
    'leaves the page, the view control and the script hook alone when the %s fails',
    (part) => {
      Object.assign(drawn, { rulers: 0, disposed: 0, layers: [], broken: part });
      const control = new ViewControl({ lon: 75, lat: 15, viewKm: WORLD_KM, tilt: 0, heading: 0 });
      control.maxKm = WORLD_KM;
      control.arrowKeys = false;
      const onInput = control.onInput;
      const append = vi.fn();
      const root = { append } as unknown as HTMLElement;
      const sound = { leave: vi.fn() } as unknown as WalkAudio;
      expect(() => startExplore({ root, control, sound, arrive: 'fly' })).toThrow(part);
      expect(append).not.toHaveBeenCalled();
      expect(drawn.rulers - drawn.disposed).toBe(0);
      expect(control.arrowKeys).toBe(false);
      expect(control.onInput).toBe(onInput);
      expect(window.__worldTime).toBeUndefined();
    },
  );

  describe('with events', () => {
    const source = () => {
      const marks = marksLayer();
      const events = {
        release: releaseOf([pageOf([])]),
        dataHost: 'https://example.invalid',
        marks: marks as unknown as MarkLayer,
      };
      return { marks, events };
    };

    it('marks the opening focal, counting the marks drawn in view on its layer', () => {
      const { marks, events } = source();
      const { mode } = setup('fly', events);
      const [client] = drawn.clients;
      expect(marks.strength).toBe(0);
      mode.afterPlace(frameOver(4.4, 35), 0);
      expect(client!.asked[0]!.focalQids).toEqual([48314]);
      expect(marks.specs).toMatchObject([{ id: 'Q48314', glyph: 'battle', focal: true }]);
      mode.ui({ lon: 4.4, lat: 35, viewKm: 30000, tilt: 0, heading: 0 }, 0);
      expect(drawn.layers[0]!.dataset.exploreMarks).toBe('1');
      expect(window.__exploreEvents?.focal()).toBe('Q48314');
      expect(window.__exploreEvents?.placed().map((m) => m.id)).toEqual(['Q48314']);
      // The worker's answer holds it, so its mark is the index's rather than the lock's.
      expect(window.__exploreEvents?.event('Q48314')).toMatchObject({ row: 39, focal: true });
      const account = new MemoryAccount();
      mode.inspectMemory(account);
      expect(account.owners['explore.events']?.arrayBuffers).toBe(4096);
    });

    it('stops asking as it leaves, then ends the worker and takes the marks off', () => {
      const { marks, events } = source();
      const { mode } = setup('fly', events);
      const [client] = drawn.clients;
      mode.afterPlace(frameOver(4.4, 35), 0);
      mode.leave();
      mode.afterPlace(frameOver(40, 0), 16);
      expect(client!.asked).toHaveLength(1);
      mode.end();
      expect(client!.disposed).toBe(true);
      expect(marks.specs).toEqual([]);
      expect(window.__exploreEvents).toBeUndefined();
    });

    it('fails the dive, leaving nothing behind, when the event worker cannot start', () => {
      const { events } = source();
      const control = new ViewControl({ lon: 75, lat: 15, viewKm: WORLD_KM, tilt: 0, heading: 0 });
      control.maxKm = WORLD_KM;
      const append = vi.fn();
      const root = { append } as unknown as HTMLElement;
      const sound = { leave: vi.fn() } as unknown as WalkAudio;
      Object.assign(drawn, { rulers: 0, disposed: 0, layers: [], broken: 'worker', clients: [] });
      expect(() => startExplore({ root, control, sound, arrive: 'fly', events })).toThrow('worker');
      expect(append).not.toHaveBeenCalled();
      expect(drawn.rulers - drawn.disposed).toBe(0);
      expect(events.marks.strength).toBe(1);
      expect(window.__exploreEvents).toBeUndefined();
    });
  });

  it('holds the dive view within 35 degrees of the equator', () => {
    expect(worldViewOn([10, -60], 1)).toMatchObject({ lon: 10, lat: -35 });
    expect(worldViewOn([10, 20], 1)).toMatchObject({ lon: 10, lat: 20 });
  });
});
