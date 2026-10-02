// Test-only, served by Vite for e2e/marks.spec.ts: boots the walk with Explore's marks on the
// fixture at ?data=<origin> and checks, in the browser, what the look draws of them. Each check
// renders the scene as the composer's first pass does, linear and before the bloom, into a float
// target, once with the marks off and once on:
// - samplers: the look's program with marks reads at most 13 of the 16 a fragment stage is sure
//   of (12 and the state names' table), as many as without them, since there the routes' cells
//   head their index table;
// - sea names: the atlas with the glyph shelf letters its names exactly as the atlas without;
// - coverage: every mark placed in view changes the pixels of its disc;
// - the limb: marks past it change nothing anywhere;
// - light: at the lamp's own reflection, at world view and at 3,000 km, no mark but the focal one
//   reaches the bloom's threshold (1.05), and the focal one's ember passes it;
// - seals over relief, tilted over Tambora on the fixture's finest tiles: a seal on its flank
//   covers the ellipse of its disc laid flat at its anchor's height, which the probe reads from
//   the tile itself, and a seal behind the summit changes no pixel, though seen from the other side
//   it does.
// Once it has measured, it stops the walk.
import { FloatType, Mesh, RGBAFormat, Vector2, Vector3, WebGLRenderTarget } from 'three';
import type { Camera, Material, Object3D, WebGLRenderer } from 'three';
import type { Release } from '../src/data/release';
import type { SurfaceLayer } from '../src/data/surfaceLayer';
import { SeaNameLayer } from '../src/look/seaNames';
import { PACES } from '../src/marks/families';
import { MARK_GLYPHS } from '../src/marks/glyphs';
import type { MarkSpec } from '../src/marks/marks';
import { HEIGHT_LEVELS, MARK_ROW, TABLE_WIDTH } from '../src/marks/marks.glsl';
import { dirOf, EARTH_M, tangents } from '../src/story/effects/geo';
import type { LonLat } from '../src/story/story';
import { faceOf, faceSt, lonLatToDir, tileOf } from '../src/surface/cube';
import { halfValue } from '../src/surface/half';
import { decodeWst, MIP_SIZES } from '../src/surface/wst';
import { bootWalk } from '../src/walk/boot';

export interface MarksProbe {
  renderer: string;
  samplers: { count: number; names: string[] };
  seaNames: { boxesSame: boolean; namesSame: boolean; shelfRows: number };
  covered: { id: string; change: number }[];
  pastLimb: { placed: number; change: number };
  light: {
    pose: string;
    /** The cluster's marks placed in view, beside the focal one. */
    cluster: number;
    ground: number;
    marks: number;
    focal: number;
  }[];
  relief: {
    /**
     * The seal on Tambora's flank: its anchor's height in meters as its tile holds it, how far
     * that lifts it on screen (device px), how far its changed pixels' center lies from its anchor
     * so lifted, and the share of its disc laid flat there (0.85 of its radius) that changed and of
     * its changed pixels that lie past 1.3 of its radius.
     */
    slope: { height: number; lift: number; offset: number; inside: number; outside: number };
    /**
     * A seal behind the summit seen from the south over it, placed in view, and the most it
     * changes any pixel; and the most it changes seen from the north.
     */
    behind: { placed: boolean; hidden: number; shown: number };
  };
}

declare global {
  interface Window {
    marksProbe?: Promise<MarksProbe>;
  }
}

const SAMPLER_TYPES = new Set([
  0x8b5e, 0x8b5f, 0x8b60, 0x8b62, 0x8dc1, 0x8dc4, 0x8dc5, 0x8dca, 0x8dcb, 0x8dcc, 0x8dcf, 0x8dd2,
  0x8dd3, 0x8dd4, 0x8dd7,
]);
const GLYPHS = Object.keys(MARK_GLYPHS);

const luminance = (p: Float32Array, i: number) =>
  0.2126 * (p[i] ?? 0) + 0.7152 * (p[i + 1] ?? 0) + 0.0722 * (p[i + 2] ?? 0);

const nextFrame = () => new Promise((done) => requestAnimationFrame(done));

async function probe(dataHost: string): Promise<MarksProbe> {
  const release = (await (await fetch(`${dataHost}/release.json`)).json()) as Release;
  // The fixture's event index brings Explore, its marks and the lobby, whose opening holds the
  // view; the probe poses the view itself.
  const page = await bootWalk(document.body, release, { lobby: false });
  const marks = page.look.marks;
  if (!marks) throw new Error('the look has no marks');
  const globe = findMesh(page.museum.scene, page.look.material);
  let drawn: { renderer: WebGLRenderer; camera: Camera } | null = null;
  globe.onAfterRender = (renderer, _scene, camera) => (drawn = { renderer, camera });
  const settle = async () => {
    for (let i = 0; i < 3; i++) await nextFrame();
    while (!page.ready() || !drawn) await nextFrame();
  };
  await settle();
  const { renderer, camera } = drawn as unknown as { renderer: WebGLRenderer; camera: Camera };
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const size = renderer.getDrawingBufferSize(new Vector2());
  const ratio = renderer.getPixelRatio();
  const target = new WebGLRenderTarget(size.x, size.y, { type: FloatType, format: RGBAFormat });
  const render = (on: boolean) => {
    marks.params.marks = on;
    const pixels = new Float32Array(size.x * size.y * 4);
    renderer.setRenderTarget(target);
    renderer.render(page.museum.scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, size.x, size.y, pixels);
    renderer.setRenderTarget(null);
    marks.params.marks = true;
    return pixels;
  };
  /** Each placed mark's pixels within `reach` of its radius, as indices into the readback. */
  const discs = (reach: number) =>
    marks.placed().map((mark) => {
      const indices: number[] = [];
      const radius = mark.rPx * reach * ratio;
      const [cx, cy] = [mark.x * ratio, size.y - mark.y * ratio];
      for (let y = Math.floor(cy - radius); y <= cy + radius; y++) {
        for (let x = Math.floor(cx - radius); x <= cx + radius; x++) {
          if (x < 0 || y < 0 || x >= size.x || y >= size.y) continue;
          if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= radius) indices.push((y * size.x + x) * 4);
        }
      }
      return { id: mark.id, indices };
    });
  const change = (a: Float32Array, b: Float32Array, indices: Iterable<number>) => {
    let most = 0;
    for (const i of indices) most = Math.max(most, Math.abs(luminance(a, i) - luminance(b, i)));
    return most;
  };

  // The camera and the lamp in the globe frame.
  const local = (at: Vector3) => globe.worldToLocal(at.clone());
  const eye = () => local(camera.getWorldPosition(new Vector3()));
  const lamp = () => {
    let spot: Object3D | undefined;
    page.museum.scene.traverse((o) => {
      if ((o as { isSpotLight?: boolean }).isSpotLight) spot = o;
    });
    return local(spot?.getWorldPosition(new Vector3()) ?? new Vector3(-4.2, 5.2, 9.5));
  };

  // Coverage: marks across the view, one of each family.
  const view = eye().normalize();
  const center = lonLatOf(view);
  const known: MarkSpec[] = [
    [0, 0],
    [-14, 10],
    [12, 8],
    [-8, -14],
    [16, -12],
    [4, 22],
  ].map(([dx, dy], i) => spec(`known-${i}`, [center[0] + (dx ?? 0), center[1] + (dy ?? 0)], i));
  marks.set('probe', known);
  let off = render(false);
  let on = render(true);
  const covered = discs(0.8).map(({ id, indices }) => ({ id, change: change(off, on, indices) }));

  // The limb: marks on the far side and just past the limb change nothing.
  const pastLimbMarks = [95, 110, 140, 179].map((angle, i) => {
    const axis = new Vector3(0, 1, 0).cross(view).normalize();
    const dir = view.clone().applyAxisAngle(axis, (angle * Math.PI) / 180);
    return spec(`limb-${i}`, lonLatOf(dir), i);
  });
  marks.set('probe', pastLimbMarks);
  off = render(false);
  on = render(true);
  const whole = {
    *[Symbol.iterator]() {
      for (let i = 0; i < on.length; i += 4) yield i;
    },
  };
  const pastLimb = { placed: marks.placed().length, change: change(off, on, whole) };

  // Light: a cluster at the lamp's reflection, and the focal mark beside it, at world view; and
  // 3,000 km over the reflection, where the globe turns under the lamp as the view does, so the
  // reflection itself lies past the view's edge and the cluster goes as near it as the view holds.
  const inView = (dir: Vector3) => {
    const p = globe.localToWorld(dir.clone()).project(camera);
    return Math.abs(p.x) < 0.8 && Math.abs(p.y) < 0.7 && p.z < 1;
  };
  /** The place in view nearest `target` on the arc to it from `from`, which is in view. */
  const nearestInView = (from: Vector3, target: Vector3) => {
    const at = (t: number) => from.clone().lerp(target, t).normalize();
    let [lo, hi] = [0, 1];
    if (inView(at(1))) return at(1);
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inView(at(mid))) lo = mid;
      else hi = mid;
    }
    return at(lo);
  };
  const light: MarksProbe['light'] = [];
  for (const pose of ['world', '3000km'] as const) {
    if (pose === '3000km') {
      const [lon, lat] = lonLatOf(reflection(eye(), lamp()));
      page.control.go({ lon, lat, viewKm: 3000, tilt: 0, heading: 0 }, true);
      await settle();
    }
    const hot = lonLatOf(nearestInView(eye().normalize(), reflection(eye(), lamp())));
    const step = pose === 'world' ? 3 : 0.4;
    const cluster: MarkSpec[] = [];
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        cluster.push(spec(`hot-${i}-${j}`, [hot[0] + i * step, hot[1] + j * step], cluster.length));
      }
    }
    // The cluster and the focal mark are lit apart, so the ember, which near the limb a few steps
    // can bring within the cluster's discs, is never taken for a mark's light; Explore's own marks,
    // its opening's ember among them, are cleared.
    const lit = (specs: MarkSpec[]) => {
      marks.set('events', []);
      marks.set('probe', specs);
      const unlit = render(false);
      const shown = render(true);
      return { unlit, shown, placed: discs(1.6) };
    };
    /** The brightest pixel the marks made brighter, and the ground's brightest under them. */
    const brightest = ({ unlit, shown, placed }: ReturnType<typeof lit>) => {
      let [most, ground] = [0, 0];
      for (const { indices } of placed) {
        for (const i of indices) {
          ground = Math.max(ground, luminance(unlit, i));
          if (luminance(shown, i) > luminance(unlit, i) + 0.01) {
            most = Math.max(most, luminance(shown, i));
          }
        }
      }
      return { most, ground };
    };
    const hotMarks = brightest(lit(cluster));
    const placedCluster = marks.placed().length;
    const focal = brightest(
      lit([{ ...spec('focal', [hot[0], hot[1] - 4 * step], 0), focal: true }]),
    );
    light.push({
      pose,
      cluster: placedCluster,
      ground: hotMarks.ground,
      marks: hotMarks.most,
      focal: focal.most,
    });
  }

  // Seals over relief, tilted over Tambora. Each render sets the probe's marks and clears
  // Explore's, so only the seal tested differs; with no relief the seal casts its contact shadow
  // straight under itself, so its pixels center on it.
  const renderWith = (specs: MarkSpec[]) => {
    marks.set('events', []);
    marks.set('probe', specs);
    return render(true);
  };
  /** A globe-frame point in the readback's pixels, rows from the bottom. */
  const pixelOf = (local: Vector3) => {
    const ndc = globe.localToWorld(local.clone()).project(camera);
    return { x: ((ndc.x + 1) / 2) * size.x, y: ((ndc.y + 1) / 2) * size.y };
  };
  const seal = (id: string, at: LonLat): MarkSpec => ({
    id,
    at,
    glyph: 'battle',
    pace: 'governance',
    opacity: 1,
  });
  const relief = Number(marks.params.markRelief);
  marks.params.markRelief = 0;

  // On the flank: its anchor's height from the tile its table entry names, and its disc laid flat
  // there.
  page.control.go({ ...TAMBORA_SLOPE.view, heading: 0 }, true);
  await settle();
  const bare = renderWith([]);
  const sealed = renderWith([seal('slope', TAMBORA_SLOPE.at)]);
  const table = marks.uniforms.lookMarkTable.value.image.data as Float32Array;
  const entry = MARK_ROW * TABLE_WIDTH * 4;
  const r = table[entry + 3] ?? 0;
  const [u = 0, v = 0, packed = -1] = table.subarray(entry + 12, entry + 15);
  const height = await heightOf(
    page.streamer.layer,
    TAMBORA_SLOPE.at,
    packed % HEIGHT_LEVELS,
    u,
    v,
  );
  const anchor = dirOf(TAMBORA_SLOPE.at);
  const kLand = Number(page.look.params.kLand);
  const top = anchor.clone().multiplyScalar(1 + (kLand * Math.max(height, 0)) / EARTH_M);
  const drawnAt = pixelOf(top);
  const sea = pixelOf(anchor);
  const { east, north } = tangents(TAMBORA_SLOPE.at);
  const outline = (k: number) =>
    Array.from({ length: 64 }, (_, i) => {
      const a = (2 * Math.PI * i) / 64;
      return pixelOf(
        top
          .clone()
          .addScaledVector(east, k * r * Math.cos(a))
          .addScaledVector(north, k * r * Math.sin(a)),
      );
    });
  const [inner, outer] = [outline(0.85), outline(1.3)];
  const reach = Math.hypot((outer[0]?.x ?? 0) - drawnAt.x, (outer[0]?.y ?? 0) - drawnAt.y);
  let [sum, sumX, sumY, innerAll, innerChanged, beyond] = [0, 0, 0, 0, 0, 0];
  for (let y = Math.floor(drawnAt.y - 2 * reach); y <= drawnAt.y + 2 * reach; y++) {
    for (let x = Math.floor(drawnAt.x - 2 * reach); x <= drawnAt.x + 2 * reach; x++) {
      if (x < 0 || y < 0 || x >= size.x || y >= size.y) continue;
      const i = (y * size.x + x) * 4;
      const changed = colorChange(bare, sealed, i) > 0.02;
      const p = { x: x + 0.5, y: y + 0.5 };
      if (inside(p, inner)) {
        innerAll += 1;
        if (changed) innerChanged += 1;
      }
      if (!changed) continue;
      sum += 1;
      sumX += p.x;
      sumY += p.y;
      if (!inside(p, outer)) beyond += 1;
    }
  }
  const slope = {
    height,
    lift: Math.hypot(drawnAt.x - sea.x, drawnAt.y - sea.y),
    offset: sum > 0 ? Math.hypot(sumX / sum - drawnAt.x, sumY / sum - drawnAt.y) : Infinity,
    inside: innerAll > 0 ? innerChanged / innerAll : 0,
    outside: sum > 0 ? beyond / sum : 1,
  };

  // Behind the summit: seen from the south over it, then from the north.
  const changeFrom = async (heading: number) => {
    page.control.go({ ...TAMBORA_BEHIND.view, heading }, true);
    await settle();
    const without = renderWith([]);
    const withSeal = renderWith([seal('behind', TAMBORA_BEHIND.at)]);
    const placed = marks.placed().some(({ id }) => id === 'behind');
    let most = 0;
    for (let i = 0; i < without.length; i += 4)
      most = Math.max(most, colorChange(without, withSeal, i));
    return { placed, most };
  };
  const south = await changeFrom(0);
  const fromNorth = await changeFrom(180);
  const behind = { placed: south.placed, hidden: south.most, shown: fromNorth.most };
  marks.params.markRelief = relief;

  marks.set('probe', []);
  target.dispose();

  const report = {
    renderer: rendererName(gl),
    samplers: fragmentSamplers(renderer),
    covered,
    pastLimb,
    light,
    relief: { slope, behind },
  };
  // The last readback drained the GPU's queue, so the walk stops with nothing left to draw.
  page.dispose();
  return { ...report, seaNames: await seaNamesAlike() };
}

/** Tambora's flank, and a view tilted over it from the south. */
const TAMBORA_SLOPE = {
  at: [118.03, -8.29] as LonLat,
  view: { lon: 118.0, lat: -8.32, viewKm: 100, tilt: 55 },
};
/**
 * A place on Tambora's northern foot, and a view low over it, 12 degrees above the horizon: from
 * the south the summit stands in front of it, far more than a seal's radius above it.
 */
const TAMBORA_BEHIND = {
  at: [118.0, -8.14] as LonLat,
  view: { lon: 118.0, lat: -8.14, viewKm: 50, tilt: 78 },
};

/**
 * The height in meters the look reads for a seal at `at` from the level-`level` tile at (u, v):
 * the tile fetched and decoded here, its heights' mip 2 sampled bilinearly, as the look's
 * textureLod does, and its codes turned to meters as the vertex stage does.
 */
async function heightOf(
  layer: Pick<SurfaceLayer, 'url' | 'surface'>,
  at: LonLat,
  level: number,
  u: number,
  v: number,
): Promise<number> {
  const dir = lonLatToDir(...at);
  const face = faceOf(dir);
  const [s, t] = faceSt(face, dir);
  const tile = { face, level, x: tileOf(s, level), y: tileOf(t, level) };
  const decoded = await decodeWst(await (await fetch(layer.url(tile))).arrayBuffer(), tile);
  const mip = decoded.heightMips[2];
  const n = MIP_SIZES[2];
  const at2 = (i: number, j: number) =>
    halfValue(mip[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))] ?? 0);
  const [x, y] = [u * n - 0.5, v * n - 0.5];
  const [i, j] = [Math.floor(x), Math.floor(y)];
  const [fx, fy] = [x - i, y - j];
  const code =
    decoded.header.codeMid +
    (1 - fy) * ((1 - fx) * at2(i, j) + fx * at2(i + 1, j)) +
    fy * ((1 - fx) * at2(i, j + 1) + fx * at2(i + 1, j + 1));
  const q = layer.surface.qLand[level] ?? NaN;
  const c2 = layer.surface.c200[level] ?? NaN;
  return (code >= c2 ? code : c2 + 4 * (code - c2)) * q;
}

/** The most any of a pixel's channels changed from `a` to `b`. */
function colorChange(a: Float32Array, b: Float32Array, i: number): number {
  return Math.max(
    Math.abs((a[i] ?? 0) - (b[i] ?? 0)),
    Math.abs((a[i + 1] ?? 0) - (b[i + 1] ?? 0)),
    Math.abs((a[i + 2] ?? 0) - (b[i + 2] ?? 0)),
  );
}

/** Whether `p` lies inside the polygon `ring`. */
function inside(p: { x: number; y: number }, ring: readonly { x: number; y: number }[]): boolean {
  let within = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      within = !within;
    }
  }
  return within;
}

function spec(id: string, at: LonLat, i: number): MarkSpec {
  return {
    id,
    at,
    glyph: GLYPHS[i % GLYPHS.length] ?? 'battle',
    pace: PACES[i % PACES.length] ?? 'nature',
    opacity: 1,
  };
}

/** Where on the unit globe the lamp's reflection lies for an eye at `eye`. */
function reflection(eye: Vector3, lamp: Vector3): Vector3 {
  const p = eye.clone().normalize().add(lamp.clone().normalize()).normalize();
  for (let k = 0; k < 8; k++) {
    const toEye = eye.clone().sub(p).normalize();
    const toLamp = lamp.clone().sub(p).normalize();
    p.copy(toEye.add(toLamp).normalize());
  }
  return p;
}

function lonLatOf(dir: Vector3): LonLat {
  const d = dir.clone().normalize();
  const DEG = 180 / Math.PI;
  return [Math.atan2(d.x, d.z) * DEG, Math.asin(Math.max(-1, Math.min(1, d.y))) * DEG];
}

function findMesh(root: Object3D, material: Material): Mesh {
  let found: Mesh | null = null;
  root.traverse((o) => {
    if (o instanceof Mesh && o.material === material) found = o;
  });
  if (!found) throw new Error('no globe mesh');
  return found;
}

/** The look's program: the active samplers its fragment stage declares, counted by array size. */
function fragmentSamplers(renderer: WebGLRenderer): { count: number; names: string[] } {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  for (const { program } of (renderer.info.programs ?? []) as { program: WebGLProgram }[]) {
    const fragment = (gl.getAttachedShaders(program) ?? []).find(
      (shader) => gl.getShaderParameter(shader, gl.SHADER_TYPE) === gl.FRAGMENT_SHADER,
    );
    const source = fragment ? (gl.getShaderSource(fragment) ?? '') : '';
    if (!source.includes('lookMarksApply')) continue;
    const declared = new Set(
      [...source.matchAll(/uniform\s+(?:(?:lowp|mediump|highp)\s+)?\w*sampler\w*\s+(\w+)/g)].map(
        (m) => m[1],
      ),
    );
    const names: string[] = [];
    let count = 0;
    const active = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < active; i++) {
      const info = gl.getActiveUniform(program, i);
      if (!info || !SAMPLER_TYPES.has(info.type)) continue;
      const base = info.name.replace(/\[0\]$/, '');
      if (!declared.has(base)) continue;
      names.push(base);
      count += info.size;
    }
    return { count, names };
  }
  throw new Error('no program cuts the marks');
}

function rendererName(gl: WebGL2RenderingContext): string {
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
}

/** The atlas with the marks' glyph shelf letters its names as the atlas without it does. */
async function seaNamesAlike(): Promise<MarksProbe['seaNames']> {
  const plain = new SeaNameLayer();
  const marked = new SeaNameLayer(MARK_GLYPHS);
  await Promise.all([plain.ready, marked.ready]);
  const bytes = (layer: SeaNameLayer) =>
    (layer.uniforms.lookSeaAtlas.value.image as { data: Uint8Array; height: number }).data;
  const [a, b] = [bytes(plain), bytes(marked)];
  let namesSame = a.length < b.length;
  for (let i = 0; namesSame && i < a.length; i++) namesSame = a[i] === b[i];
  const result = {
    boxesSame: JSON.stringify(plain.boxes) === JSON.stringify(marked.boxes),
    namesSame,
    shelfRows: (b.length - a.length) / 2048,
  };
  plain.dispose();
  marked.dispose();
  return result;
}

const dataHost = new URLSearchParams(location.search).get('data');
window.marksProbe = dataHost
  ? probe(dataHost)
  : Promise.reject(new Error('name the data server with ?data=<origin>'));
void window.marksProbe.then(
  (report) => (document.title = `marks probe: ${report.covered.length} marks covered`),
  (error: unknown) => (document.title = `marks probe failed: ${String(error)}`),
);
