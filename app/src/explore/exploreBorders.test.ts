// Explore's borders over a stand-in for the border steps' runtime: they are wanted with previews
// from the first frame and ease in over borderFade, at the view's width under the camera; the
// preview chunks load when the dive lands; leaving eases them out until they are no longer wanted;
// the script hook names the step drawn and turns them off and on; and ending empties the
// runtime.
import { PerspectiveCamera } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { BordersFrame, StepShown } from '../borders/clockBorders';
import { tunables } from '../config/tunables';
import { FrameContext } from '../scene/frameContext';
import { EARTH_KM } from '../story/effects/geo';
import { ExploreBorders, viewWidthKm, type StepsRuntime } from './exploreBorders';

/** A frame whose camera stands `altitude` globe radii above the surface, 16:10. */
function frameAt(altitude: number): FrameContext {
  const frame = new FrameContext();
  frame.cam = new PerspectiveCamera(30, 1.6);
  frame.camera.set(0, 0, 1 + altitude);
  frame.tanHalf = Math.tan(Math.PI / 12);
  return frame;
}

function setup() {
  const frames: BordersFrame[] = [];
  let shown: StepShown | null = null;
  const steps: StepsRuntime = {
    update: (frame) => frames.push(frame),
    loadPreviews: vi.fn(),
    end: vi.fn(),
    get shown() {
      return shown;
    },
  };
  const borders = new ExploreBorders(steps);
  const frame = frameAt(1);
  /** Runs `ms` of frames at 60 fps and returns the last one the runtime was given. */
  const run = (ms: number): BordersFrame => {
    for (let t = 0; t < ms; t += 1000 / 60) borders.update(frame, 1 / 60);
    return frames.at(-1) as BordersFrame;
  };
  return {
    borders,
    steps,
    frames,
    run,
    show: (next: StepShown | null) => (shown = next),
  };
}

describe("Explore's borders", () => {
  it('are wanted with previews from the first frame, and ease in over borderFade', () => {
    const { borders, frames, run } = setup();
    borders.update(frameAt(1), 0);
    expect(frames[0]).toMatchObject({ wanted: true, previews: true, strength: 0 });
    const half = run(tunables.borderFade / 2);
    expect(half.strength).toBeGreaterThan(0.3);
    expect(half.strength).toBeLessThan(0.7);
    expect(run(tunables.borderFade).strength).toBe(1);
  });

  it('follow the view’s width under the camera', () => {
    const { borders, frames } = setup();
    const frame = frameAt(0.5);
    borders.update(frame, 0);
    expect(frames[0]?.viewKm).toBeCloseTo(viewWidthKm(frame), 6);
    expect(viewWidthKm(frame)).toBeCloseTo(2 * 0.5 * Math.tan(Math.PI / 12) * 1.6 * EARTH_KM, 6);
  });

  it('load the preview chunks once the dive lands', () => {
    const { borders, steps } = setup();
    expect(steps.loadPreviews).not.toHaveBeenCalled();
    borders.landed();
    expect(steps.loadPreviews).toHaveBeenCalledTimes(1);
  });

  it('name the step drawn, or a preview standing in, to scripts', () => {
    const { borders, show } = setup();
    show({ year: 1815, strength: 1, preview: false });
    expect(borders.hook.shown()).toEqual({ year: 1815, strength: 1, preview: false });
    show({ year: 1830, strength: 1, preview: true });
    expect(borders.hook.shown()).toEqual({ year: 1830, strength: 1, preview: true });
    show(null);
    expect(borders.hook.shown()).toBeNull();
  });

  it('ease out as the lobby takes the view back, then are no longer wanted', () => {
    const { borders, run } = setup();
    run(tunables.borderFade);
    borders.leave();
    const easing = run(tunables.borderFade / 2);
    expect(easing).toMatchObject({ wanted: true });
    expect(easing.strength).toBeLessThan(1);
    expect(run(tunables.borderFade)).toMatchObject({ wanted: false, strength: 0 });
  });

  it('turn off and on again from the script hook', () => {
    const { borders, run } = setup();
    run(tunables.borderFade);
    borders.hook.show(false);
    expect(run(2 * tunables.borderFade)).toMatchObject({ wanted: false, strength: 0 });
    borders.hook.show(true);
    expect(run(2 * tunables.borderFade)).toMatchObject({ wanted: true, strength: 1 });
  });

  it('empty the runtime when Explore ends', () => {
    const { borders, steps } = setup();
    borders.end();
    expect(steps.end).toHaveBeenCalledTimes(1);
  });
});
