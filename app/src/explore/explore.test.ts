import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dayFromIso } from '../story/dates';
import { WorldClock } from '../time/worldClock';
import { ViewControl } from '../view/viewControl';
import type { WalkAudio } from '../audio/walkAudio';
import { startExplore, WATERLOO, worldViewOn } from './explore';

// The real clock, flight and view control, with the ruler and its layer standing in for the DOM.
const drawn = vi.hoisted(() => ({
  rulers: 0,
  disposed: 0,
  layers: [] as FakeLayer[],
  /** The part that throws as it is built, if any. */
  broken: null as 'ruler' | 'flight' | null,
}));
interface FakeLayer {
  className: string;
  children: unknown[];
  inert: boolean;
  removed: boolean;
  append(...nodes: unknown[]): void;
  remove(): void;
}
vi.mock('../story/ui/rulerCraft', () => ({
  CraftRuler: class {
    element = { ruler: true };
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

function setup(arrive: 'fly' | 'jump' = 'fly') {
  Object.assign(drawn, { rulers: 0, disposed: 0, layers: [], broken: null });
  const clock = new WorldClock();
  const control = new ViewControl({ lon: 75, lat: 15, viewKm: WORLD_KM, tilt: 0, heading: 0 });
  control.maxKm = WORLD_KM;
  // As a story leaves them, stepping its beats.
  control.arrowKeys = false;
  const leaveSound = vi.fn();
  const append = vi.fn();
  const sound = { leave: leaveSound } as unknown as WalkAudio;
  const root = { append } as unknown as HTMLElement;
  const mode = startExplore({ root, control, sound, arrive, clock });
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
    expect(control.current.lon).toBeCloseTo(WATERLOO.at[0], 6);
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

  it('holds the dive view within 35 degrees of the equator', () => {
    expect(worldViewOn([10, -60], 1)).toMatchObject({ lon: 10, lat: -35 });
    expect(worldViewOn([10, 20], 1)).toMatchObject({ lon: 10, lat: 20 });
  });
});
