// Test-only, served by Vite for e2e/borders.spec.ts: boots the walk on the fixture at
// ?data=<origin>, whose release names the border steps, so the look holds them, fills its array
// with synthetic steps and previews through the runtime's own upload parts and decoder, and checks
// what the look draws of them. Each check renders the scene as the composer's first pass does,
// linear and before the bloom, into a float target, once with the borders off and once on, with the
// relief flat so every place sits where it projects. Slot 0 holds a step whose outer border runs
// along 20°E, soft north of 5°N, and whose inner border runs along 30°E; slot 1 a step with no
// border in reach. The ring holds a preview pair decoded from a chunk (25°E in R, 35°E in G), a
// cell of previews just clear of a border beside a cell just clear of the other side, and a cell
// whose border runs along 0° and the dateline.
import { FloatType, Mesh, RGBAFormat, Vector2, Vector3, WebGLRenderTarget } from 'three';
import type { Camera, Material, Object3D, WebGLRenderer } from 'three';
import { BorderArray } from '../src/borders/borderArray';
import { viewFades } from '../src/borders/clockBorders';
import {
  BAND_ROWS,
  BORDER_FACES,
  CELL_BYTES,
  decodePreviewPair,
  FACE_BANDS,
  PREVIEW_H,
  PREVIEW_W,
  STEP_TEXELS,
} from '../src/data/borders';
import type { Release } from '../src/data/release';
import { sourceVector, stepUniformsOf, type BorderSource } from '../src/look/bordersHook';
import { FACES } from '../src/surface/cube';
import { innerByte, outerByte, previewByte, previewChunk } from '../src/test/borderFiles';
import { bootWalk } from '../src/walk/boot';

export interface BordersProbe {
  renderer: string;
  samplers: { count: number; names: string[] };
  /** Median darkening along each line, 0 to 1, in each check. */
  world: { outer: number; inner: number };
  /** At 2,000 km; `soft` and `hard` along one stretch, soft and its hard twin. */
  close: { outer: number; inner: number; soft: number; hard: number };
  dissolve: { whole: number; half: number };
  previews: { r: { own: number; other: number }; g: { own: number; other: number } };
  dateline: { clear: number; border: number };
}

declare global {
  interface Window {
    bordersProbe?: Promise<BordersProbe>;
  }
}

const SAMPLER_TYPES = new Set([
  0x8b5e, 0x8b5f, 0x8b60, 0x8b62, 0x8dc1, 0x8dc4, 0x8dc5, 0x8dca, 0x8dcb, 0x8dcc, 0x8dcf, 0x8dd2,
  0x8dd3, 0x8dd4, 0x8dd7,
]);

/** Where the step's lines run, and where its outer line turns soft. */
const OUTER_LON = 20;
const INNER_LON = 30;
const SOFT_NORTH_OF = 5;
/** Where the decoded pair's lines run: R, then G. */
const PREVIEW_R_LON = 25;
const PREVIEW_G_LON = 35;
/** A field texel's angle at a face's middle: its tan mapping keeps texels nearly even. */
const TEXEL_RAD = (Math.PI / 4) * (2 / (STEP_TEXELS - 8));
const DEG = Math.PI / 180;

const nextFrame = () => new Promise((done) => requestAnimationFrame(done));
const luminance = (p: Float32Array, i: number) =>
  0.2126 * (p[i] ?? 0) + 0.7152 * (p[i + 1] ?? 0) + 0.0722 * (p[i + 2] ?? 0);

async function probe(dataHost: string): Promise<BordersProbe> {
  const release = (await (await fetch(`${dataHost}/release.json`)).json()) as Release;
  const page = await bootWalk(document.body, release, { lobby: false });
  const uniforms = stepUniformsOf(page.look.material);
  if (!uniforms) throw new Error('the look holds no border steps');
  page.look.params.flatRelief = true;
  page.cameraParams.reliefByZoom = false;
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

  // The synthetic steps and previews, written as the runtime writes them.
  const gpu = new BorderArray(renderer, uniforms.lookBorderField.value, 'full');
  writeStep(gpu, 0, stepTexel(true));
  // Its twin, hard all along, until the dissolve's check.
  writeStep(gpu, 1, stepTexel(false));
  const meridian = (lon: number) => (i: number) =>
    (-180 + ((i + 0.5) * 360) / PREVIEW_W - lon) / (360 / PREVIEW_W);
  const layers = [() => 7.875, () => -8, meridian(PREVIEW_R_LON), meridian(PREVIEW_G_LON)].map(
    (d) => previewLayer((i) => d(i)),
  );
  const chunk = await gzip(previewChunk([1800, 1805, 1810, 1815], layers));
  gpu.cell(2, (await decodePreviewPair(chunk, 2)).cell).write();
  const cells: [number, (column: number) => number][] = [
    [0, () => 0.75],
    [1, () => -0.75],
    [3, (i) => (i < PREVIEW_W / 2 ? 0.5 : -0.5)],
  ];
  for (const [cell, d] of cells) gpu.cell(cell, cellOf(d)).write();

  const size = renderer.getDrawingBufferSize(new Vector2());
  const target = new WebGLRenderTarget(size.x, size.y, { type: FloatType, format: RGBAFormat });
  const tier = 'full';
  /** Renders with the borders off and on, drawing `a`, `b` at `mix`, at the view's width. */
  const render = (viewKm: number, a: BorderSource, b: BorderSource = { kind: 'none' }, mix = 0) => {
    const shots: Float32Array[] = [];
    for (const strength of [0, 1]) {
      uniforms.lookBorderStrength.value = strength;
      uniforms.lookBorderInner.value = viewFades(viewKm).inner;
      sourceVector(tier, a, uniforms.lookBorderA.value);
      sourceVector(tier, b, uniforms.lookBorderB.value);
      uniforms.lookBorderMix.value = mix;
      const pixels = new Float32Array(size.x * size.y * 4);
      renderer.setRenderTarget(target);
      renderer.render(page.museum.scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, size.x, size.y, pixels);
      renderer.setRenderTarget(null);
      shots.push(pixels);
    }
    uniforms.lookBorderStrength.value = 0;
    const [off, on] = shots as [Float32Array, Float32Array];
    /** The median, over points along a meridian, of the most any pixel near each darkens. */
    return (lon: number, [south, north]: [number, number]) => {
      const most: number[] = [];
      for (let lat = south; lat <= north; lat += (north - south) / 40) {
        const p = globe.localToWorld(threeDir(lon, lat)).project(camera);
        if (p.z > 1 || Math.abs(p.x) > 0.95 || Math.abs(p.y) > 0.95) continue;
        const [cx, cy] = [((p.x + 1) / 2) * size.x, ((p.y + 1) / 2) * size.y];
        let dark = 0;
        for (let y = Math.round(cy) - 3; y <= Math.round(cy) + 3; y++) {
          for (let x = Math.round(cx) - 5; x <= Math.round(cx) + 5; x++) {
            if (x < 0 || y < 0 || x >= size.x || y >= size.y) continue;
            const i = (y * size.x + x) * 4;
            const lit = luminance(off, i);
            if (lit > 1e-3) dark = Math.max(dark, 1 - luminance(on, i) / lit);
          }
        }
        most.push(dark);
      }
      most.sort((x, y) => x - y);
      return most[Math.floor(most.length / 2)] ?? 0;
    };
  };
  const go = async (lon: number, lat: number, viewKm: number) => {
    page.control.go({ lon, lat, viewKm, tilt: 0, heading: 0 }, true);
    await settle();
  };
  const slot0: BorderSource = { kind: 'slot', slot: 0 };
  const slot1: BorderSource = { kind: 'slot', slot: 1 };
  const hard: [number, number] = [-10, SOFT_NORTH_OF - 2];

  await go(25, 5, 8000);
  let lines = render(8000, slot0);
  const world = { outer: lines(OUTER_LON, hard), inner: lines(INNER_LON, [-10, 20]) };

  await go(25, 5, 2000);
  lines = render(2000, slot0);
  const north: [number, number] = [SOFT_NORTH_OF + 1, 10];
  const close = {
    outer: lines(OUTER_LON, [-2, SOFT_NORTH_OF - 1]),
    inner: lines(INNER_LON, [-2, 10]),
    soft: lines(OUTER_LON, north),
    hard: render(2000, slot1)(OUTER_LON, north),
  };
  writeStep(gpu, 1, () => [255, 127]);
  const dissolve = {
    whole: lines(OUTER_LON, [-2, SOFT_NORTH_OF - 1]),
    half: render(2000, slot0, slot1, 0.5)(OUTER_LON, [-2, SOFT_NORTH_OF - 1]),
  };

  await go(30, 5, 3000);
  const band: [number, number] = [-5, 12];
  const r = render(3000, { kind: 'cell', cell: 2, channel: 0 });
  const g = render(3000, { kind: 'cell', cell: 2, channel: 1 });
  const previews = {
    r: { own: r(PREVIEW_R_LON, band), other: r(PREVIEW_G_LON, band) },
    g: { own: g(PREVIEW_G_LON, band), other: g(PREVIEW_R_LON, band) },
  };

  // Chukotka, the land the dateline crosses.
  await go(180, 67, 3000);
  const chukotka: [number, number] = [65.5, 68];
  const dateline = {
    clear: render(3000, { kind: 'cell', cell: 0, channel: 0 })(180, chukotka),
    border: render(3000, { kind: 'cell', cell: 3, channel: 0 })(180, chukotka),
  };
  target.dispose();

  return {
    renderer: rendererName(gl),
    samplers: fragmentSamplers(renderer),
    world,
    close,
    dissolve,
    previews,
    dateline,
  };
}

/** The step: R the outer distance to 20°E, G the inner to 30°E, soft north of 5°N if `soft`. */
function stepTexel(soft: boolean): Texel {
  return ([x, y, z]) => {
    const toward = (lon: number) => Math.asin(-x * Math.sin(lon * DEG) + y * Math.cos(lon * DEG));
    const outer = toward(OUTER_LON) / TEXEL_RAD;
    const inner = toward(INNER_LON) / TEXEL_RAD;
    const north = Math.asin(z) / DEG > SOFT_NORTH_OF;
    return [outerByte(outer), innerByte(Math.abs(inner) <= 8 ? inner : null, soft && north)];
  };
}

/** A step's R and G at a texel's direction in the globe frame. */
type Texel = (dir: [number, number, number]) => [number, number];

/** Writes a step into a slot, band by band, each texel's direction in the globe frame given. */
function writeStep(gpu: BorderArray, slot: number, texel: Texel): void {
  const texels = new Uint8Array(BAND_ROWS * STEP_TEXELS * 2);
  const dir: [number, number, number] = [0, 0, 0];
  const interior = STEP_TEXELS - 8;
  for (let face = 0; face < BORDER_FACES; face++) {
    const { c, u, v } = FACES[face] as (typeof FACES)[number];
    for (let band = 0; band < FACE_BANDS; band++) {
      for (let row = 0; row < BAND_ROWS; row++) {
        const j = band * BAND_ROWS + row;
        const b = Math.tan((Math.PI / 4) * (-1 + (2 * (j - 4) + 1) / interior));
        for (let i = 0; i < STEP_TEXELS; i++) {
          const a = Math.tan((Math.PI / 4) * (-1 + (2 * (i - 4) + 1) / interior));
          const px = c[0] + a * u[0] + b * v[0];
          const py = c[1] + a * u[1] + b * v[1];
          const pz = c[2] + a * u[2] + b * v[2];
          const length = Math.hypot(px, py, pz);
          dir[0] = px / length;
          dir[1] = py / length;
          dir[2] = pz / length;
          const [r, g] = texel(dir);
          texels[2 * (row * STEP_TEXELS + i)] = r;
          texels[2 * (row * STEP_TEXELS + i) + 1] = g;
        }
      }
      gpu.band(slot, face, band * BAND_ROWS, texels).write();
    }
  }
}

/** A preview whose distance in preview texels is a function of its column. */
function previewLayer(d: (column: number) => number): Uint8Array {
  const layer = new Uint8Array(PREVIEW_W * PREVIEW_H);
  for (let j = 0; j < PREVIEW_H; j++) {
    for (let i = 0; i < PREVIEW_W; i++) layer[j * PREVIEW_W + i] = previewByte(d(i));
  }
  return layer;
}

/** A cell whose two previews are both a function of the column. */
function cellOf(d: (column: number) => number): Uint8Array {
  const cell = new Uint8Array(CELL_BYTES);
  const layer = previewLayer(d);
  for (let t = 0; t < layer.length; t++) cell[2 * t] = cell[2 * t + 1] = layer[t] ?? 0;
  return cell;
}

async function gzip(raw: Uint8Array): Promise<ArrayBuffer> {
  const stream = new Blob([raw.slice().buffer]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

/** A longitude and latitude's direction in three.js axes, on the unit globe. */
function threeDir(lon: number, lat: number): Vector3 {
  const [cl, sl] = [Math.cos(lat * DEG), Math.sin(lat * DEG)];
  return new Vector3(cl * Math.sin(lon * DEG), sl, cl * Math.cos(lon * DEG));
}

function findMesh(root: Object3D, material: Material): Mesh {
  let found: Mesh | null = null;
  root.traverse((o) => {
    if (o instanceof Mesh && o.material === material) found = o;
  });
  if (!found) throw new Error('no globe mesh');
  return found;
}

/** The steps' look program: the active samplers its fragment stage declares. */
function fragmentSamplers(renderer: WebGLRenderer): { count: number; names: string[] } {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  for (const { program } of (renderer.info.programs ?? []) as { program: WebGLProgram }[]) {
    const fragment = (gl.getAttachedShaders(program) ?? []).find(
      (shader) => gl.getShaderParameter(shader, gl.SHADER_TYPE) === gl.FRAGMENT_SHADER,
    );
    const source = fragment ? (gl.getShaderSource(fragment) ?? '') : '';
    if (!source.includes('lookBorderGroove')) continue;
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
  throw new Error('no program draws the border steps');
}

function rendererName(gl: WebGL2RenderingContext): string {
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
}

const dataHost = new URLSearchParams(location.search).get('data');
window.bordersProbe = dataHost
  ? probe(dataHost)
  : Promise.reject(new Error('name the data server with ?data=<origin>'));
void window.bordersProbe.then(
  () => (document.title = 'borders probe: done'),
  (error: unknown) => (document.title = `borders probe failed: ${String(error)}`),
);
