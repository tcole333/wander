// ?markDemo on the dev page (prototype.html): the lobby's glows as marks, cut into the look with the
// event glyphs, the three pace layers' families taken in turn, each mark in a glyph of its own
// family (eventSymbols.ts), and one place in eight hollow or soft; a few more on the Alps' valleys,
// for a close view among ridges; and a specimen tray in the Sahara, each family's row of four of
// its glyphs over a row of the states (a hovered hollow parent with its extent, a soft mark, a
// plain one, a hollow one). ?markVariant=0-3 picks the families' materials, ?marks=0 turns the
// marks off (the GPU time's baseline), and ?markStress=<n> sets n marks spread over the view
// instead. The page boots without the event index while the demo runs (main.ts), so Explore sets
// no event marks beside the demo's. window.__markDemo serves scripts/exploreShots.ts.
import {
  HalfFloatType,
  Mesh,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type Material,
  type WebGLRenderer,
} from 'three';
import type { MuseumScene, Params } from '../../contract';
import { EVENT_CLASS_SYMBOLS } from '../../marks/eventSymbols';
import { PACES, type Pace } from '../../marks/families';
import type { GlyphId } from '../../marks/symbols';
import type { MarkLayer, MarkSpec, PlacedMark } from '../../marks/marks';
import { lobbyPlaces } from '../../lobby/places';
import { GpuTimer } from '../../perf/gpuTimer';
import { nearestRank } from '../../perf/frameStats';
import type { LonLat } from '../../story/story';
import type { StorySource } from '../../walk/boot';

export interface MarkDemoApi {
  marks(): MarkSpec[];
  placed(): readonly PlacedMark[];
  hit(x: number, y: number): string | null;
  /** Makes one mark the focal one, or none. */
  focus(id: string | null): void;
  /** Hovers one mark, or none. */
  hover(id: string | null): void;
  /** Sets marks params, such as markVariant or marks (off for the GPU time's baseline). */
  set(params: Params): void;
  /** Replaces the demo's marks with n spread over a cap `radiusDeg` about `center`; 0 restores them. */
  stress(n: number, center?: LonLat, radiusDeg?: number): void;
  /**
   * The GPU time of drawing the scene into a target of the canvas's size, `samples` times with
   * the marks on and as many off, in turn, so both share the GPU's clocks; null without timer
   * queries.
   */
  gpuAB(samples: number): Promise<{ on: GpuTimes; off: GpuTimes } | null>;
}

/**
 * GPU ms of one scene draw: its fastest twentieth, where other work sharing the GPU has added
 * least, and its median.
 */
export interface GpuTimes {
  p05: number;
  p50: number;
  samples: number;
}

declare global {
  interface Window {
    __markDemo?: MarkDemoApi;
  }
}

/** Each family's glyphs, as the event classes give them. */
const FAMILY_GLYPHS: Record<Pace, GlyphId[]> = { nature: [], governance: [], infrastructure: [] };
for (const { pace, glyph } of Object.values(EVENT_CLASS_SYMBOLS)) {
  if (!FAMILY_GLYPHS[pace].includes(glyph)) FAMILY_GLYPHS[pace].push(glyph);
}

/** The family's `k`th glyph, round again past its last. */
function glyphOf(pace: Pace, k: number): GlyphId {
  const glyphs = FAMILY_GLYPHS[pace];
  return glyphs[k % glyphs.length] ?? 'battle';
}

/** The `i`th mark's family, the families taken in turn, and a glyph of that family. */
function inTurn(i: number): { pace: Pace; glyph: GlyphId } {
  const pace = PACES[i % PACES.length] ?? 'nature';
  return { pace, glyph: glyphOf(pace, Math.floor(i / PACES.length)) };
}
/**
 * Demo marks near the 300 km mountain view, which looks north over the Alps: on the valley floors
 * and lakes of their southern side, which face the camera, and behind the main ridge, where the
 * relief should hide them.
 */
const ALPS: LonLat[] = [
  [8.29, 46.12],
  [7.32, 45.74],
  [8.95, 46.0],
  [8.6, 46.64],
  [9.83, 46.5],
  [7.36, 46.23],
  [7.75, 46.02],
  [8.03, 46.43],
];

/** The specimen tray: its columns' longitudes and its rows' latitudes, north to south. */
const TRAY = { lons: [19.75, 21.25, 22.75, 24.25], lats: [26, 24.5, 23, 21.5] } as const;

function specimenMarks(): MarkSpec[] {
  const marks: MarkSpec[] = [];
  PACES.forEach((pace, row) =>
    TRAY.lons.forEach((lon, col) =>
      marks.push({
        id: `specimen-${pace}-${col}`,
        at: [lon, TRAY.lats[row] ?? 0],
        glyph: glyphOf(pace, col),
        pace,
        opacity: 1,
      }),
    ),
  );
  const states: (Partial<MarkSpec> & { pace: Pace })[] = [
    { pace: 'nature', hollow: true, hover: true, ringRad: 0.011 },
    { pace: 'governance', soft: true },
    { pace: 'infrastructure' },
    { pace: 'governance', hollow: true },
  ];
  states.forEach((state, col) =>
    marks.push({
      id: `specimen-state-${col}`,
      at: [TRAY.lons[col] ?? 0, TRAY.lats[3]],
      glyph: glyphOf(state.pace, col),
      opacity: 1,
      ...state,
    }),
  );
  return marks;
}

function demoMarks(glows: readonly StorySource[]): MarkSpec[] {
  const places = [...lobbyPlaces(glows.map(({ glows: at }) => at)), ...ALPS];
  const demo = places.map((at, i) => ({
    id: `demo-${i}`,
    at,
    ...inTurn(i),
    opacity: 1,
    hollow: i % 8 === 5,
    soft: i % 8 === 6,
    ringRad: i % 8 === 5 ? 0.04 : undefined,
    score: places.length - i,
  }));
  return [...demo, ...specimenMarks()];
}

/** n marks on a golden-angle spiral over a cap `radiusDeg` about `center`. */
function stressMarks(n: number, [lon, lat]: LonLat, radiusDeg: number): MarkSpec[] {
  const marks: MarkSpec[] = [];
  const DEG = Math.PI / 180;
  for (let i = 0; i < n; i++) {
    const angle = radiusDeg * Math.sqrt((i + 0.5) / n) * DEG;
    const bearing = i * Math.PI * (3 - Math.sqrt(5));
    const lat1 = Math.asin(
      Math.sin(lat * DEG) * Math.cos(angle) +
        Math.cos(lat * DEG) * Math.sin(angle) * Math.cos(bearing),
    );
    const lon1 =
      lon * DEG +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angle) * Math.cos(lat * DEG),
        Math.cos(angle) - Math.sin(lat * DEG) * Math.sin(lat1),
      );
    marks.push({
      id: `stress-${i}`,
      at: [((lon1 / DEG + 540) % 360) - 180, lat1 / DEG],
      ...inTurn(i),
      opacity: 1,
    });
  }
  return marks;
}

/** Sets the demo's marks on `marks` and serves window.__markDemo. */
export function startMarkDemo(
  marks: MarkLayer,
  sources: readonly StorySource[],
  museum: MuseumScene,
  globe: Material,
  query: URLSearchParams,
): void {
  const demo = demoMarks(sources);
  let current = demo;
  let focal: string | null = null;
  let hovered: string | null = null;
  const show = () =>
    marks.set(
      'demo',
      current.map((mark) => ({
        ...mark,
        focal: mark.id === focal,
        hover: mark.hover === true || mark.id === hovered,
      })),
    );
  const stress = Number(query.get('markStress') ?? 0);
  if (stress > 0) current = stressMarks(stress, [75, 15], 80);
  show();

  window.__markDemo = {
    marks: () => current,
    placed: () => marks.placed(),
    hit: (x, y) => marks.hit(x, y),
    focus(id) {
      focal = id;
      show();
    },
    hover(id) {
      hovered = id;
      show();
    },
    set(params) {
      Object.assign(marks.params, params);
    },
    stress(n, center = [75, 15], radiusDeg = 80) {
      current = n > 0 ? stressMarks(n, center, radiusDeg) : demo;
      show();
    },
    gpuAB: (samples) => timeDraws(museum, globe, marks, samples),
  };
}

/**
 * Times drawing the museum's scene on the GPU as its composer's first pass does, into a float
 * target of the canvas's size: after each frame, samples of DRAWS draws each, the marks on and off
 * in turn. The renderer and camera are the walk's own, taken as it draws the globe.
 */
async function timeDraws(
  museum: MuseumScene,
  globe: Material,
  marks: MarkLayer,
  samples: number,
): Promise<{ on: GpuTimes; off: GpuTimes } | null> {
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
  const PER_FRAME = 4;
  const was = marks.params.marks;
  const times: Record<string, number[]> = { on: [], off: [] };
  let frame = 0;
  const count = () => Math.min(times.on?.length ?? 0, times.off?.length ?? 0);
  try {
    const started = performance.now();
    while (count() < samples && performance.now() - started < 60_000) {
      await new Promise((done) => requestAnimationFrame(done));
      renderer.setRenderTarget(target);
      // Which goes first swaps each frame, as a sample's place in the frame changes its time.
      const first = frame++ % 2 === 0 ? 'on' : 'off';
      for (let i = 0; i < PER_FRAME; i++) {
        const label = i % 2 === 0 ? first : first === 'on' ? 'off' : 'on';
        marks.params.marks = label === 'on';
        timer.begin(label);
        for (let d = 0; d < DRAWS; d++) renderer.render(museum.scene, camera);
        timer.end();
      }
      renderer.setRenderTarget(null);
      marks.params.marks = was ?? true;
      for (const { label, ms } of timer.poll()) times[label]?.push(ms / DRAWS);
    }
  } finally {
    marks.params.marks = was ?? true;
    renderer.setRenderTarget(null);
    target.dispose();
    timer.dispose();
  }
  const summary = (ms: number[]): GpuTimes => ({
    p05: nearestRank(ms, 0.05),
    p50: nearestRank(ms, 0.5),
    samples: ms.length,
  });
  return { on: summary(times.on ?? []), off: summary(times.off ?? []) };
}
