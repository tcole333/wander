import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { FxRelease } from '../../data/release';
import { parseRoute, type RouteData } from '../../data/route';
import { createRouteUniforms } from '../../look/routeHook';
import { readFixtureFile, readStageRecord } from '../../test/fixture';
import type { WalkState } from '../contract';
import { dayFromIso } from '../dates';
import { parseStory } from '../story';
import { dirOf } from './geo';
import { routeFrame, WalkRoutes } from './route';

const story = parseStory(
  readFileSync(new URL('../../../../stories/magellan/story.md', import.meta.url), 'utf8'),
);
const fx = readStageRecord<FxRelease>('fx');
const bytes = readFixtureFile(fx['magellan/route']!.key).buffer;
const route = parseRoute(bytes);
const on = (id: string, date?: string): WalkState => {
  const beat = story.beats.findIndex((b) => b.id === id);
  return {
    story,
    beat,
    day: date ? dayFromIso(date) : story.beats[beat]!.day,
    mode: 'paused',
    flight: null,
    flying: false,
    advanceIn: null,
  };
};

describe('story time to route geometry, from the actual fx build', () => {
  it('draws no track or fleet before departure', () => {
    const frame = routeFrame(route, dayFromIso('1519-09-19'), 7);
    expect(frame.head).toEqual({ index: -1, fraction: 0 });
    expect(frame.fleet).toBeNull();
  });

  it('draws the sailed track to the mid-Pacific fleet, with a seven-day glowing tail', () => {
    const day = dayFromIso('1521-02-01');
    const frame = routeFrame(route, day, 7);
    expect(frame.head.index).toBeGreaterThan(300);
    expect(frame.head.index).toBeLessThan(route.pts.length - 1);
    const p = route.pts[frame.head.index]!;
    expect(p.slice(0, 3)).toEqual([-152, -13, day - route.epochDay]);
    expect(frame.fleet!.distanceTo(dirOf([-152, -13]))).toBeLessThan(1e-12);
    const a = route.pts[frame.tail.index]!;
    const b = route.pts[frame.tail.index + 1]!;
    expect(a[2] + frame.tail.fraction * (b[2] - a[2])).toBeCloseTo(day - route.epochDay - 7, 8);
  });

  it('shortens on a scrub back and returns to exactly the same forward geometry', () => {
    const feb = routeFrame(route, dayFromIso('1521-02-01'), 7);
    const dec = routeFrame(route, dayFromIso('1520-12-13'), 7);
    expect(dec.head.index).toBeLessThan(feb.head.index);
    expect(dec.fleet!.distanceTo(feb.fleet!)).toBeGreaterThan(0.5);
    expect(routeFrame(route, dayFromIso('1521-02-01'), 7)).toEqual(feb);
  });

  it('keeps the fleet at Cebu throughout the stay at Mactan, then ends at Sanlúcar', () => {
    const before = routeFrame(route, dayFromIso('1521-04-20'), 7);
    const mactan = routeFrame(route, dayFromIso('1521-04-27'), 7);
    expect(mactan.fleet!.distanceTo(dirOf([123.92, 10.29]))).toBeLessThan(1e-12);
    expect(before.fleet!.distanceTo(mactan.fleet!)).toBeLessThan(1e-12);
    const ended = routeFrame(route, dayFromIso('1523-01-01'), 7);
    expect(ended.head.index).toBe(route.pts.length - 1);
    const end = route.pts.at(-1)!;
    expect(ended.fleet!.distanceTo(dirOf([end[0], end[1]]))).toBeLessThan(1e-12);
  });

  it('interpolates a partial segment across the dateline along the short great circle', () => {
    const crossing = route.pts.findIndex(
      (p, i) => i > 0 && Math.abs(p[0] - route.pts[i - 1]![0]) > 180,
    );
    expect(crossing).toBeGreaterThan(0);
    const a = route.pts[crossing - 1]!;
    const b = route.pts[crossing]!;
    const frame = routeFrame(route, route.epochDay + (a[2] + b[2]) / 2, 7);
    const expected = dirOf([a[0], a[1]])
      .add(dirOf([b[0], b[1]]))
      .normalize();
    expect(frame.head.index).toBe(crossing - 1);
    expect(frame.head.fraction).toBeCloseTo(0.5, 8);
    expect(frame.fleet!.distanceTo(expected)).toBeLessThan(1e-10);
    expect(frame.fleet!.z).toBeLessThan(-0.9);
  });

  it('uses the last control on an equal-date run, without dividing by zero', () => {
    const tiny: RouteData = {
      v: 1,
      epochDay: 0,
      labels: [],
      pts: [
        [0, 0, 0, 3],
        [1, 0, 1, 3],
        [2, 0, 1, 3],
        [3, 0, 2, 3],
      ],
    };
    expect(routeFrame(tiny, 1, 7).head).toEqual({ index: 2, fraction: 0 });
    expect(routeFrame(tiny, 1, 7).fleet).toEqual(dirOf([2, 0]));
  });
});

describe('the route core and material hook', () => {
  it('loads each named dataset once, then sends time, fleet and beat fades to the inlay', async () => {
    const uniforms = createRouteUniforms();
    const fetch = vi.fn(() => Promise.resolve(bytes));
    const effects = new WalkRoutes(story, { dataHost: 'https://data.test', fx }, uniforms, fetch);
    await Promise.all([effects.load(), effects.load()]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(`https://data.test/${fx['magellan/route']!.key}`);
    effects.update(on('pacific'), 0.25, 1);
    const state = () => Array.from(uniforms.lookRouteState.value.image.data as Float32Array);
    expect(state()[3]).toBeCloseTo(0.5);
    effects.update(on('pacific'), 0.25, 1);
    const forward = state();
    expect(forward[2]).toBe(7);
    expect(forward[3]).toBe(1);
    expect(new Vector3(...forward.slice(4, 7)).distanceTo(dirOf([-152, -13]))).toBeLessThan(1e-7);
    effects.update(on('pacific', '1520-12-13'), 0.016, 1);
    expect(state()[0]).toBeLessThan(forward[0]!);
    effects.update(on('pacific'), 0.016, 1);
    expect(state()).toEqual(forward);
    effects.update(on('san-julian'), 0.25, 1);
    expect(state()[3]).toBe(1);
    // An effect omitted from a beat still fades out; Magellan now keeps it at every port.
    const hidden = on('san-julian');
    hidden.story = { ...story, beats: story.beats.map((b) => ({ ...b, effects: [] })) };
    effects.update(hidden, 0.25, 1);
    expect(state()[3]).toBeCloseTo(0.5);
    effects.update(hidden, 0.25, 1);
    expect(uniforms.lookRouteCount.value).toBe(0);
    effects.update(on('pacific', '1519-09-19'), 1, 1);
    expect(uniforms.lookRouteCount.value).toBe(0);
    effects.update(on('pacific'), 1, 1);
    effects.hide();
    expect(uniforms.lookRouteCount.value).toBe(0);
    effects.update(on('pacific'), 0.25, 1);
    expect(state()[3]).toBeCloseTo(0.5);
    effects.dispose();
  });

  it('does not fetch for stories without routes or resurrect an effect disposed during a load', async () => {
    const uniforms = createRouteUniforms();
    const noRoutes = { ...story, beats: story.beats.map((b) => ({ ...b, effects: [] })) };
    const fetch = vi.fn(() => Promise.resolve(bytes));
    const absent = new WalkRoutes(noRoutes, { dataHost: '', fx }, uniforms, fetch);
    await absent.load();
    expect(fetch).not.toHaveBeenCalled();
    let finish!: (bytes: ArrayBuffer) => void;
    const effects = new WalkRoutes(
      story,
      { dataHost: '', fx },
      uniforms,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const loading = effects.load();
    effects.dispose();
    finish(bytes);
    await loading;
    effects.update(on('pacific'), 1, 1);
    expect(uniforms.lookRouteCount.value).toBe(0);
    expect(uniforms.lookRouteState.value.image.width).toBe(1);
    absent.dispose();
  });

  it('logs a missing or bad route once and leaves the rest of the walk running', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const uniforms = createRouteUniforms();
    const fetch = vi.fn(() => Promise.resolve(new ArrayBuffer(0)));
    try {
      const missing = new WalkRoutes(story, { dataHost: '' }, uniforms, fetch);
      await missing.load();
      await missing.load();
      expect(fetch).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
      const bad = new WalkRoutes(story, { dataHost: '', fx }, uniforms, fetch);
      await bad.load();
      expect(warn).toHaveBeenCalledTimes(2);
      expect(uniforms.lookRouteCount.value).toBe(0);
      missing.dispose();
      bad.dispose();
    } finally {
      warn.mockRestore();
    }
  });
});
