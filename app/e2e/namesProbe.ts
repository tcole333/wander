// Test-only, served by Vite for e2e/names.spec.ts: boots the walk on the fixture at ?data=<origin>,
// whose release names the state names, so the look cuts them; waits for their glyphs, lettered from
// the first frame on; and checks what the look draws of them:
// - the fixture's own: once the world clock stands in 1815 and the borders' runtime draws that
//   step, its chunk of names is in and the layer draws names of it over Europe;
// - letters: on a source of its own, two names over the Sahara, an outer one in capitals and an
//   inner Vietnamese one in small capitals, each rendered with the names off and on, as the
//   composer's first pass draws, linear and before the bloom: within 0.3 em of each letter's
//   middle some pixel brightens (the floor) and some darkens (the rim), and past everything the
//   look may draw above and below the name nothing changes;
// - light: no name's pixel reaches the bloom's threshold;
// - the mask: the floor drawn flat magenta at each letter's middle;
// - samplers: the look's program with the names reads at most 13.
// The marks are off for the synthetic names, so none takes their places. Once it has measured, it
// stops the walk.
import { FloatType, Mesh, RGBAFormat, Vector2, Vector3, WebGLRenderTarget } from 'three';
import type { Camera, Material, Object3D, WebGLRenderer } from 'three';
import { clockBordersOf, type BordersDrawn } from '../src/borders/clockBorders';
import type { StepNames } from '../src/borders/clockNames';
import { NAME_FLAG, NAMES_FIELDS, namesChunk } from '../src/data/names';
import type { Release } from '../src/data/release';
import { layoutName, NAME_CAP_EM } from '../src/look/nameLayout';
import { dayFromHistorical } from '../src/story/dates';
import { worldClock } from '../src/time/worldClock';
import { bootWalk } from '../src/walk/boot';

/** How a name changes the ground: per letter, the most it brightens and darkens; and beside it. */
export interface NameChange {
  text: string;
  letters: { bright: number; dark: number }[];
  /** The most any pixel changes a band's reach above and below the name. */
  beside: number;
  /** The brightest pixel of the name, linear luminance. */
  brightest: number;
  /** Letters whose middle the mask draws magenta. */
  masked: number;
}

export interface NamesProbe {
  renderer: string;
  samplers: { count: number; names: string[] };
  /** The fixture's names the layer drew over Europe in 1815. */
  fixture: string[];
  synthetic: NameChange[];
}

declare global {
  interface Window {
    namesProbe?: Promise<NamesProbe>;
  }
}

const SAMPLER_TYPES = new Set([
  0x8b5e, 0x8b5f, 0x8b60, 0x8b62, 0x8dc1, 0x8dc4, 0x8dc5, 0x8dca, 0x8dcb, 0x8dcc, 0x8dcf, 0x8dd2,
  0x8dd3, 0x8dd4, 0x8dd7,
]);
const DEG = Math.PI / 180;
/** The synthetic names: text, plane, anchor and em in degrees. */
const SYNTHETIC = [
  { text: 'TESTING', plane: 'outer', at: [6, 24], em: 0.55 },
  { text: 'Đại Việt', plane: 'inner', at: [17, 24], em: 0.45 },
] as const;

const nextFrame = () => new Promise((done) => requestAnimationFrame(done));
const luminance = (p: Float32Array, i: number) =>
  0.2126 * (p[i] ?? 0) + 0.7152 * (p[i + 1] ?? 0) + 0.0722 * (p[i + 2] ?? 0);

async function probe(dataHost: string): Promise<NamesProbe> {
  const release = (await (await fetch(`${dataHost}/release.json`)).json()) as Release;
  const page = await bootWalk(document.body, release, { lobby: false });
  const names = page.look.names;
  if (!names) throw new Error('the look draws no state names');
  const globe = findMesh(page.museum.scene, page.look.material);
  let drawn: { renderer: WebGLRenderer; camera: Camera } | null = null;
  globe.onAfterRender = (renderer, _scene, camera) => (drawn = { renderer, camera });
  const settle = async () => {
    for (let i = 0; i < 3; i++) await nextFrame();
    while (!page.ready() || !drawn || !names.glyphs) await nextFrame();
  };
  const go = async (lon: number, lat: number, viewKm: number) => {
    page.control.go({ lon, lat, viewKm, tilt: 0, heading: 0 }, true);
    await settle();
  };

  // The fixture's own names, as the borders' runtime brings 1815's step and its chunk, driven
  // here as a mode drives it: the page stands in its lobby, with no mode running.
  await go(15, 48, 3000);
  const borders = clockBordersOf(page.look.material);
  const day = dayFromHistorical({ year: 1815, month: 7, day: 1 });
  for (let i = 0; i < 1200 && names.shown.drawn.length === 0; i++) {
    worldClock.set(day);
    borders?.update({ wanted: true, previews: false, viewKm: 3000, strength: 1 });
    await nextFrame();
  }
  const fixture = names.shown.drawn.map((name) => name.text);

  // The synthetic names, on a source of the probe's own, with the marks off.
  if (page.look.marks) page.look.marks.params.marks = false;
  const row = (name: number, [lon, lat]: readonly [number, number], em: number, inner: boolean) => [
    name,
    0,
    0,
    Math.round(lon * 100),
    Math.round(lat * 100),
    0,
    Math.round(em * 1e4),
    Math.round(em * 6 * 1e3),
    1_000_000,
    inner ? NAME_FLAG.inner : 0,
    name,
  ];
  const chunk = namesChunk({
    version: 1,
    first: 0,
    years: [1815],
    fields: [...NAMES_FIELDS],
    names: SYNTHETIC.map(({ text }) => [text, text]),
    place: SYNTHETIC.flatMap(({ at, em, plane }, n) => row(n, at, em, plane === 'inner')),
  });
  const source = {
    drawn: { from: null, to: { step: 0, preview: false }, mix: 1, strength: 1, inner: 1 },
    namesAt: (): StepNames => ({ chunk, number: 0, index: 0 }),
  } satisfies { drawn: BordersDrawn; namesAt: (step: number) => StepNames };
  names.follow(source);
  await go(12, 24, 3000);
  // Past every name's fade in.
  for (let i = 0; i < 40; i++) await nextFrame();
  const { renderer, camera } = drawn as unknown as { renderer: WebGLRenderer; camera: Camera };
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const size = renderer.getDrawingBufferSize(new Vector2());
  const ratio = renderer.getPixelRatio();
  const target = new WebGLRenderTarget(size.x, size.y, { type: FloatType, format: RGBAFormat });
  const render = (params: { names: boolean; namesMask: boolean }) => {
    Object.assign(names.params, params);
    const pixels = new Float32Array(size.x * size.y * 4);
    renderer.setRenderTarget(target);
    renderer.render(page.museum.scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, size.x, size.y, pixels);
    renderer.setRenderTarget(null);
    return pixels;
  };
  // On first, and what it drew: turned off, the layer lets its fades go.
  const on = render({ names: true, namesMask: false });
  const shown = new Map(names.shown.drawn.map((name) => [name.text, name]));
  const mask = render({ names: true, namesMask: true });
  const off = render({ names: false, namesMask: false });
  Object.assign(names.params, { names: true, namesMask: false });
  target.dispose();

  const glyphs = names.glyphs;
  if (!glyphs) throw new Error('the names have no glyphs');
  const synthetic = SYNTHETIC.map(({ text, plane, at }): NameChange => {
    const name = shown.get(text);
    const laid = layoutName(text, plane, 6, glyphs[plane]);
    if (!name || !laid) return { text, letters: [], beside: Infinity, brightest: 0, masked: 0 };
    // The name runs east along its parallel: its letters' middles, device px, y up.
    const emPx = name.emPx * ratio;
    const middle = project(globe, camera, at, size);
    const left = middle.x - (laid.length / 2) * emPx;
    const around = (cx: number, cy: number, half: number) => {
      const indices: number[] = [];
      for (let y = Math.round(cy - half); y <= Math.round(cy + half); y++) {
        for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) {
          if (x >= 0 && y >= 0 && x < size.x && y < size.y) indices.push((y * size.x + x) * 4);
        }
      }
      return indices;
    };
    const letters = laid.letters.map(({ glyph, u }) => {
      let [bright, dark] = [0, 0];
      const cx = left + (u + glyph.advance / 2) * emPx;
      for (const i of around(cx, middle.y, 0.3 * emPx + 1)) {
        const lit = luminance(off, i);
        if (lit <= 1e-4) continue;
        bright = Math.max(bright, luminance(on, i) / lit - 1);
        dark = Math.max(dark, 1 - luminance(on, i) / lit);
      }
      return { bright, dark };
    });
    let beside = 0;
    for (const dy of [-1, 1]) {
      const cy = middle.y + dy * (0.5 * NAME_CAP_EM + 1.1) * emPx;
      for (const i of around(middle.x, cy, 0.1 * emPx)) {
        beside = Math.max(beside, Math.abs(luminance(on, i) - luminance(off, i)));
      }
    }
    // The brightest pixel the name itself brightens.
    let brightest = 0;
    for (const i of around(middle.x, middle.y, (laid.length / 2) * emPx)) {
      if (luminance(on, i) > luminance(off, i) + 0.01)
        brightest = Math.max(brightest, luminance(on, i));
    }
    const masked = laid.letters.filter(({ glyph, u }) => {
      const cx = left + (u + glyph.advance / 2) * emPx;
      return around(cx, middle.y, 0.3 * emPx).some(
        (i) => (mask[i] ?? 0) > 0.5 && (mask[i + 1] ?? 1) < 0.1 && (mask[i + 2] ?? 0) > 0.5,
      );
    }).length;
    return { text, letters, beside, brightest, masked };
  });

  const report = {
    renderer: rendererName(gl),
    samplers: fragmentSamplers(renderer),
    fixture,
    synthetic,
  };
  page.dispose();
  return report;
}

/** A place's position in the render target, device px, y up. */
function project(
  globe: Object3D,
  camera: Camera,
  [lon, lat]: readonly [number, number],
  size: Vector2,
): { x: number; y: number } {
  const [cl, sl] = [Math.cos(lat * DEG), Math.sin(lat * DEG)];
  const p = globe
    .localToWorld(new Vector3(cl * Math.sin(lon * DEG), sl, cl * Math.cos(lon * DEG)))
    .project(camera);
  return { x: ((p.x + 1) / 2) * size.x, y: ((p.y + 1) / 2) * size.y };
}

function findMesh(root: Object3D, material: Material): Mesh {
  let found: Mesh | null = null;
  root.traverse((o) => {
    if (o instanceof Mesh && o.material === material) found = o;
  });
  if (!found) throw new Error('no globe mesh');
  return found;
}

/** The names' look program: the active samplers its fragment stage declares. */
function fragmentSamplers(renderer: WebGLRenderer): { count: number; names: string[] } {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  for (const { program } of (renderer.info.programs ?? []) as { program: WebGLProgram }[]) {
    const fragment = (gl.getAttachedShaders(program) ?? []).find(
      (shader) => gl.getShaderParameter(shader, gl.SHADER_TYPE) === gl.FRAGMENT_SHADER,
    );
    const source = fragment ? (gl.getShaderSource(fragment) ?? '') : '';
    if (!source.includes('lookStateNames')) continue;
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
  throw new Error('no program draws the state names');
}

function rendererName(gl: WebGL2RenderingContext): string {
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
}

const dataHost = new URLSearchParams(location.search).get('data');
window.namesProbe = dataHost
  ? probe(dataHost)
  : Promise.reject(new Error('name the data server with ?data=<origin>'));
void window.namesProbe.then(
  () => (document.title = 'names probe: done'),
  (error: unknown) => (document.title = `names probe failed: ${String(error)}`),
);
