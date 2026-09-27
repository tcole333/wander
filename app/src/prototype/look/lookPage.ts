// The surface look's harness (prototype-look.html): the release's tiles decoded and uploaded into
// the surface pools as meshProbe.ts does, then drawn with the look under the spike's lights, as
// (a) the whole globe at L1 for the spike's world and region views and
// (b) a cover of L4-L7 nodes around Sumbawa for its close view and a closer one on Tambora.
//
// Query: ?data=region|global|<origin> (global when its server answers, else region),
// ?view=world|region|close|tambora, and any look param by name (?flatRelief=true,
// ?normalStrength=0.8, ?bronze=%23a07030).
import {
  BufferAttribute,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { tunables } from '../../config/tunables';
import type { Release } from '../../data/release';
import { loadSurfaceLayer } from '../../data/surfaceLayer';
import { FIXED_SLOTS, SlotTable } from '../../gpu/slotTable';
import { createSurfacePools, surfaceParts } from '../../gpu/surfaceUploads';
import { UploadQueue } from '../../gpu/uploadQueue';
import { INSTANCE_WORDS } from '../../globe/instances';
import { l1Globe, packScenario, type PackedScenario } from '../../globe/meshScenarios';
import { ancestorAt } from '../../globe/seamFlags';
import { buildTileGrid, type TileGrid } from '../../globe/tileGrid';
import { tileKey, type Tile } from '../../surface/cube';
import { decodeTiles } from '../../workers/decodeTiles';
import type { Params, SurfaceLook } from '../../contract';
import { closeCover } from './closeCover';
import { createSpikeStage } from './spikeStage';
import { createSurfaceLook } from '../../look/surfaceLook';

const DEG = Math.PI / 180;
const TAMBORA: [number, number] = [118.0, -8.25];
const DATA_HOSTS = { region: 'http://127.0.0.1:8792', global: 'http://127.0.0.1:8793' };

/** The spike's camera states (story.json cameras, main.js composition), plus a closer one. */
interface Preset {
  lon: number;
  lat: number;
  /** MapLibre zoom, turned into a distance as the spike did; or the distance from the look point. */
  zoom?: number;
  distance?: number;
  compose: number;
  lookMix: number;
  lookY: number;
  az: number;
  el: number;
  mesh: 'globe' | 'cover';
}

export const PRESETS: Record<string, Preset> = {
  world: {
    lon: 75,
    lat: 15,
    zoom: 2.1,
    compose: 0.7,
    lookMix: 0,
    lookY: -0.12,
    az: -0.2,
    el: 0.1,
    mesh: 'globe',
  },
  region: {
    lon: 105,
    lat: -2,
    zoom: 2.8,
    compose: 0.78,
    lookMix: 0.35,
    lookY: -0.02,
    az: -0.16,
    el: 0.06,
    mesh: 'globe',
  },
  close: {
    lon: 118,
    lat: -8.25,
    zoom: 4.2,
    compose: 1,
    lookMix: 1,
    lookY: 0,
    az: -0.1,
    el: 0.42,
    mesh: 'cover',
  },
  tambora: {
    lon: 118,
    lat: -8.25,
    distance: 0.06,
    compose: 1,
    lookMix: 1,
    lookY: 0,
    az: -0.1,
    el: 0.5,
    mesh: 'cover',
  },
};

export interface LookHarness {
  ready: boolean;
  params: Params;
  view(name: string): void;
  /** Milliseconds per frame over `count` frames, each drawn and waited for on the GPU. */
  timeFrames(count: number): number;
  error?: string;
}

declare global {
  interface Window {
    lookHarness?: LookHarness;
  }
}

export async function runLookPage(root: HTMLElement, status: HTMLElement): Promise<LookHarness> {
  const query = new URLSearchParams(location.search);
  const host = await dataHost(query.get('data'));
  const release = (await (await fetch(`${host}/release.json`)).json()) as Release;
  const layer = await loadSurfaceLayer(release);
  status.textContent = `loading tiles from ${host}`;

  // What the page draws: the L1 globe, and the cover around Sumbawa.
  const globe = l1Globe();
  const coverNodes = closeCover({
    target: TAMBORA,
    base: 4,
    radiusDeg: 22,
    refineDeg: [0, 0, 0, 0, 8, 3.5, 1.2],
    available: (t) => layer.available(t),
  });
  const tiles = new Map<string, Tile>();
  for (const t of layer.tiles()) if (t.level <= 1) tiles.set(tileKey(t), t);
  // Each source, and its parent, which seam flags read across a change of source level.
  for (const { tile, source } of [...globe.nodes, ...coverNodes]) {
    for (const s of [source, source - 1]) {
      if (s < 0) continue;
      const src = ancestorAt(tile, s);
      tiles.set(tileKey(src), src);
    }
  }

  const renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(root.clientWidth, root.clientHeight);
  root.appendChild(renderer.domElement);

  // Tiles decoded in the workers and uploaded through the queue, into the slots the table gives.
  const slots = FIXED_SLOTS + [...tiles.values()].filter((t) => t.level > 1).length;
  const pools = createSurfacePools(renderer, slots);
  for (const pool of [pools.height, pools.shoreWater, pools.edges]) pool.warm();
  const table = new SlotTable({
    slots,
    quarantineFrames: tunables.slotQuarantine,
    fixedRoots: true,
  });
  const queue = new UploadQueue({
    stopMs: tunables.uploadStopMs,
    slowCallMs: tunables.uploadSlowCall,
  });
  const codeMids = new Map<string, number>();
  const errors = await decodeTiles(layer, [...tiles.values()], ({ key, tile }) => {
    const slot = table.reserve(key);
    if (slot === undefined) throw new Error(`no slot for ${key}`);
    codeMids.set(key, tile.header.codeMid);
    queue.enqueue({
      key,
      parts: surfaceParts(pools, slot, tile),
      onDone: () => table.publish(key),
    });
  });
  if (errors.length > 0) throw new Error(`decode failed: ${errors.map((e) => e.key).join(', ')}`);
  while (queue.length > 0) {
    queue.run(tunables.uploadIdle.full);
    table.endFrame();
  }
  const resident = (t: Tile) => {
    const slot = table.slotOf(tileKey(t));
    if (slot === undefined || table.stateOf(tileKey(t)) !== 'resident') {
      throw new Error(`${tileKey(t)} is not resident`);
    }
    return slot;
  };
  const codeMid = (t: Tile) => codeMids.get(tileKey(t)) ?? 0;

  const look = createSurfaceLook(pools, release.surface);
  applyQuery(look.params, query);
  const stage = createSpikeStage(renderer);
  const grid = buildTileGrid(32);
  const cover = { name: 'Sumbawa cover', nodes: coverNodes, partial: true };
  const meshes = {
    globe: surfaceMesh(grid, packScenario(globe, codeMid, resident), look),
    cover: surfaceMesh(grid, packScenario(cover, codeMid, resident), look),
  };
  stage.globeMount.add(meshes.globe, meshes.cover);

  const controls = new OrbitControls(stage.camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 0.01;
  controls.maxDistance = 9;

  const view = (name: string) => {
    const preset = PRESETS[name] ?? PRESETS.region;
    if (!preset) return;
    stage.gimbal(preset.lon, preset.lat);
    meshes.globe.visible = preset.mesh === 'globe';
    meshes.cover.visible = preset.mesh === 'cover';
    const height = root.clientHeight;
    const distance =
      preset.distance !== undefined
        ? preset.lookMix + preset.distance
        : zoomToDistance(preset.zoom ?? 3, preset.compose, stage.camera.fov, height);
    const dir = new Vector3(
      Math.sin(preset.az) * Math.cos(preset.el),
      Math.sin(preset.el),
      Math.cos(preset.az) * Math.cos(preset.el),
    );
    const target = new Vector3(0, preset.lookY, preset.lookMix);
    stage.camera.position.copy(target).addScaledVector(dir, distance - preset.lookMix);
    controls.target.copy(target);
    stage.camera.lookAt(target);
    status.textContent = `${name}: ${meshes.globe.visible ? 'L1 globe' : 'Sumbawa cover'}, ${
      tiles.size
    } tiles from ${host}`;
  };
  view(query.get('view') ?? 'region');

  addEventListener('resize', () => stage.setSize(root.clientWidth, root.clientHeight));
  const start = performance.now();
  renderer.setAnimationLoop((time: number) => {
    controls.update();
    look.update((time - start) / 1000);
    stage.render(time);
  });

  const timeFrames = (count: number) => {
    const gl = renderer.getContext();
    const pixel = new Uint8Array(4);
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    sync();
    const t0 = performance.now();
    for (let i = 0; i < count; i += 1) {
      stage.render(t0);
      sync();
    }
    return (performance.now() - t0) / count;
  };
  const harness: LookHarness = { ready: false, params: look.params, view, timeFrames };
  // Two frames: the first compiles the programs.
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  harness.ready = true;
  return harness;
}

/** The spike's zoomToDistance: MapLibre's globe radius at `zoom`, seen through the camera. */
function zoomToDistance(zoom: number, compose: number, fovDeg: number, heightPx: number): number {
  const radiusPx = (compose * (512 * 2 ** zoom)) / (2 * Math.PI);
  const t = Math.tan((fovDeg * DEG) / 2);
  return Math.sqrt(1 + (heightPx / 2 / (t * radiusPx)) ** 2);
}

function surfaceMesh(grid: TileGrid, packed: PackedScenario, look: SurfaceLook): Mesh {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(grid.position, 3));
  geometry.setAttribute('normal', new BufferAttribute(grid.normal, 3, true));
  geometry.setIndex(new BufferAttribute(grid.index, 1));
  // A Uint32Array, so three binds both halves with vertexAttribIPointer.
  const buffer = new InstancedInterleavedBuffer(packed.words, INSTANCE_WORDS, 1);
  geometry.setAttribute('wanderNode', new InterleavedBufferAttribute(buffer, 4, 0));
  geometry.setAttribute('wanderPrev', new InterleavedBufferAttribute(buffer, 4, 4));
  geometry.instanceCount = packed.instances.length;
  const mesh = new Mesh(geometry, look.material);
  mesh.customDepthMaterial = look.depthMaterial;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // The grid's attribute holds lattice indices, not positions, so no bounds hold.
  mesh.frustumCulled = false;
  return mesh;
}

async function dataHost(choice: string | null): Promise<string> {
  if (choice === 'region' || choice === 'global') return DATA_HOSTS[choice];
  if (choice) return choice;
  try {
    const response = await fetch(`${DATA_HOSTS.global}/release.json`, {
      signal: AbortSignal.timeout(1500),
    });
    if (response.ok) return DATA_HOSTS.global;
  } catch {
    // The global bake's server is not up.
  }
  return DATA_HOSTS.region;
}

/** Sets each look param the query names, parsed by the param's type. */
function applyQuery(params: Params, query: URLSearchParams): void {
  for (const [name, value] of Object.entries(params)) {
    const given = query.get(name);
    if (given === null) continue;
    if (typeof value === 'boolean') params[name] = given === 'true' || given === '1';
    else if (typeof value === 'number') params[name] = Number(given);
    else params[name] = given;
  }
}
