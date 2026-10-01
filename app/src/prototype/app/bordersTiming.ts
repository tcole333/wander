// window.__bordersTiming on the dev page: what the borders cost the GPU (#80's budgets,
// streaming.md 3.3). The scene is drawn into a target of the canvas's size, as the composer's first
// pass draws it, in each of a few passes in turn, after each frame, samples of three draws each, as
// scripts/exploreShots.ts times the marks. Where the look holds the border steps (the release names
// them) the passes are the borders off, at rest (one step slot) and mid-dissolve (two slots halfway
// into each other, and two previews halfway), each with the inner lines at full strength and the
// outer line at the view's size, and each again with the outer line at its near size (`restNear`,
// `slotsNear`, `previewsNear`), which the larger line far out is measured against. The renderer and
// camera are the page's own, taken as it draws the globe. It also gives the border array's size on
// the GPU. scripts/bordersVideos.ts reads it.
import {
  HalfFloatType,
  Mesh,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type Material,
  type WebGLRenderer,
} from 'three';
import type { MuseumScene } from '../../contract';
import {
  sourceVector,
  stepLayers,
  stepUniformsOf,
  type BorderSource,
  type StepUniforms,
} from '../../look/bordersHook';
import { nearestRank } from '../../perf/frameStats';
import { GpuTimer } from '../../perf/gpuTimer';
import type { GpuTimes } from './markDemo';

export interface BordersTimingApi {
  /** The border array on the GPU: its bytes, its layers, and what it holds. */
  array(): { bytes: number; layers: number; holds: 'full' | 'lite' };
  /** GPU ms of a scene draw in each pass, by name; null without timer queries. */
  gpu(samples: number): Promise<Record<string, GpuTimes> | null>;
}

declare global {
  interface Window {
    __bordersTiming?: BordersTimingApi;
  }
}

/** Each pass sets the borders' uniforms before its draws; `restore` puts back the frame's own. */
interface Passes {
  passes: Record<string, () => void>;
  restore: () => void;
}

/** Serves window.__bordersTiming where the look holds the border steps. */
export function serveBordersTiming(museum: MuseumScene, globe: Material): void {
  const steps = stepUniformsOf(globe);
  if (!steps) return;
  const { width, height, depth } = steps.lookBorderField.value.image;
  const holds = depth === stepLayers('full') ? 'full' : 'lite';
  window.__bordersTiming = {
    array: () => ({ bytes: width * height * depth * 2, layers: depth, holds }),
    gpu: (samples) => timeDraws(museum, globe, stepPasses(steps, holds), samples),
  };
}

/** What each pass of the steps draws: its two sources. */
const SOURCES: Record<string, [BorderSource, BorderSource]> = {
  rest: [{ kind: 'none' }, { kind: 'slot', slot: 0 }],
  slots: [
    { kind: 'slot', slot: 0 },
    { kind: 'slot', slot: 1 },
  ],
  previews: [
    { kind: 'cell', cell: 0, channel: 0 },
    { kind: 'cell', cell: 1, channel: 1 },
  ],
};

function stepPasses(uniforms: StepUniforms, tier: 'full' | 'lite'): Passes {
  const was = {
    strength: uniforms.lookBorderStrength.value,
    inner: uniforms.lookBorderInner.value,
    mix: uniforms.lookBorderMix.value,
    a: uniforms.lookBorderA.value.clone(),
    b: uniforms.lookBorderB.value.clone(),
    scale: uniforms.lookBorderScale.value,
  };
  const passes: Record<string, () => void> = {
    off: () => (uniforms.lookBorderStrength.value = 0),
  };
  for (const [name, [a, b]] of Object.entries(SOURCES)) {
    const draw = () => {
      uniforms.lookBorderStrength.value = 1;
      uniforms.lookBorderInner.value = 1;
      sourceVector(tier, a, uniforms.lookBorderA.value);
      sourceVector(tier, b, uniforms.lookBorderB.value);
      uniforms.lookBorderMix.value = name === 'rest' ? 1 : 0.5;
    };
    passes[name] = () => {
      draw();
      uniforms.lookBorderScale.value = was.scale;
    };
    passes[`${name}Near`] = () => {
      draw();
      uniforms.lookBorderScale.value = 1;
    };
  }
  return {
    passes,
    restore: () => {
      uniforms.lookBorderStrength.value = was.strength;
      uniforms.lookBorderInner.value = was.inner;
      uniforms.lookBorderMix.value = was.mix;
      uniforms.lookBorderA.value.copy(was.a);
      uniforms.lookBorderB.value.copy(was.b);
      uniforms.lookBorderScale.value = was.scale;
    },
  };
}

async function timeDraws(
  museum: MuseumScene,
  globe: Material,
  { passes, restore }: Passes,
  samples: number,
): Promise<Record<string, GpuTimes> | null> {
  let mesh: Mesh | null = null;
  museum.scene.traverse((object) => {
    if (object instanceof Mesh && object.material === globe) mesh = object;
  });
  const found = mesh as Mesh | null;
  if (!found) return null;
  const drawn = await new Promise<{ renderer: WebGLRenderer; camera: Camera }>((done) => {
    found.onAfterRender = (renderer, _scene, camera) => done({ renderer, camera });
  });
  found.onAfterRender = () => {};
  const { renderer, camera } = drawn;
  const timer = new GpuTimer(renderer.getContext() as WebGL2RenderingContext);
  if (!timer.available) return null;
  const size = renderer.getDrawingBufferSize(new Vector2());
  const target = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType });
  const DRAWS = 3;
  const names = Object.keys(passes);
  const times: Record<string, number[]> = Object.fromEntries(names.map((name) => [name, []]));
  const count = () => Math.min(...names.map((name) => times[name]?.length ?? 0));
  let frame = 0;
  try {
    const started = performance.now();
    while (count() < samples && performance.now() - started < 60_000) {
      await new Promise((done) => requestAnimationFrame(done));
      renderer.setRenderTarget(target);
      // Which goes first turns each frame, as a sample's place in the frame changes its time.
      for (let i = 0; i < names.length; i += 1) {
        const name = names[(i + frame) % names.length] ?? 'off';
        passes[name]?.();
        timer.begin(name);
        for (let d = 0; d < DRAWS; d++) renderer.render(museum.scene, camera);
        timer.end();
      }
      frame += 1;
      restore();
      renderer.setRenderTarget(null);
      for (const { label, ms } of timer.poll()) times[label]?.push(ms / DRAWS);
    }
  } finally {
    restore();
    renderer.setRenderTarget(null);
    target.dispose();
    timer.dispose();
  }
  return Object.fromEntries(
    names.map((name) => {
      const ms = times[name] ?? [];
      const summary: GpuTimes = {
        p05: nearestRank(ms, 0.05),
        p50: nearestRank(ms, 0.5),
        samples: ms.length,
      };
      return [name, summary];
    }),
  );
}
