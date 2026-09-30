// The border steps' GPU array (streaming.md 3.3, 5.5): the look's RG8 array of 1024² layers, a
// slot of six faces per step (two on the full tier, one on lite) and a two-layer ring of 16 preview
// cells, allocated at boot with renderer.initTexture and touched once by warm(), since ANGLE may
// zero-fill it lazily. Writes are upload parts for the streamer's queue: a band of 128 rows of one
// face, or a cell of two previews, each through a staging texture three knows nothing of, so
// copyTextureToTexture takes its texSubImage3D path, as the surface pools' writes do
// (gpu/gpuPool.ts).
import {
  DataTexture,
  GLSL3,
  RawShaderMaterial,
  RGFormat,
  UnsignedByteType,
  Vector3,
  WebGLRenderTarget,
  type DataArrayTexture,
  type WebGLRenderer,
} from 'three';
import type { Tier } from '../config/tunables';
import {
  BAND_BYTES,
  BAND_ROWS,
  BORDER_FACES,
  CELL_BYTES,
  PREVIEW_H,
  PREVIEW_W,
  STEP_TEXELS,
} from '../data/borders';
import { drawFullscreen, FULLSCREEN_VERTEX } from '../gpu/fullscreen';
import type { UploadPart } from '../gpu/uploadQueue';
import { cellPlace, RING_CELLS, STEP_SLOTS, stepLayers } from '../look/bordersHook';
import type { MemoryAccount } from '../perf/memory';

/** What the steps' runtime writes through: the array's slots and cells, as upload parts. */
export interface BorderGpu {
  readonly slots: number;
  readonly cells: number;
  /** A band of a step's field: `texels` holds BAND_ROWS rows of `face` from `row`, R and G. */
  band(slot: number, face: number, row: number, texels: Uint8Array): UploadPart;
  /** A ring cell's two previews, R and G interleaved, row 0 the northmost. */
  cell(cell: number, texels: Uint8Array): UploadPart;
  inspectMemory?(account: MemoryAccount): void;
}

export class BorderArray implements BorderGpu {
  readonly slots: number;
  readonly cells = RING_CELLS;
  readonly #renderer: WebGLRenderer;
  readonly #texture: DataArrayTexture;
  readonly #tier: Tier;
  readonly #bandStaging = staging(STEP_TEXELS, BAND_ROWS);
  readonly #cellStaging = staging(PREVIEW_W, PREVIEW_H);
  readonly #origin = new Vector3();

  /** Allocates `texture`, the look's step array (createStepUniforms), on the GPU. */
  constructor(renderer: WebGLRenderer, texture: DataArrayTexture, tier: Tier) {
    const layers = stepLayers(tier);
    const { width, height, depth } = texture.image;
    if (width !== STEP_TEXELS || height !== STEP_TEXELS || depth !== layers) {
      throw new RangeError(`a ${width}×${height}×${depth} array holds no ${tier} step slots`);
    }
    this.#renderer = renderer;
    this.#texture = texture;
    this.#tier = tier;
    this.slots = STEP_SLOTS[tier];
    renderer.initTexture(texture);
  }

  band(slot: number, face: number, row: number, texels: Uint8Array): UploadPart {
    check('slot', slot, this.slots - 1);
    check('face', face, BORDER_FACES - 1);
    check('row', row, STEP_TEXELS - BAND_ROWS);
    if (row % BAND_ROWS !== 0) throw new RangeError(`a band starts on a band's row, not ${row}`);
    if (texels.length !== BAND_BYTES) throw new RangeError(`a band of ${texels.length} bytes`);
    const layer = slot * BORDER_FACES + face;
    return {
      bytes: BAND_BYTES,
      write: () => this.#write(this.#bandStaging, texels, 0, row, layer),
    };
  }

  cell(cell: number, texels: Uint8Array): UploadPart {
    check('cell', cell, this.cells - 1);
    if (texels.length !== CELL_BYTES) throw new RangeError(`a cell of ${texels.length} bytes`);
    const { layer, x, y } = cellPlace(this.#tier, cell);
    return { bytes: CELL_BYTES, write: () => this.#write(this.#cellStaging, texels, x, y, layer) };
  }

  /** One draw into a 1×1 target that reads every layer (streaming.md 5.5, Allocation). */
  warm(): void {
    const target = new WebGLRenderTarget(1, 1, { depthBuffer: false });
    const material = new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: warmFragment(stepLayers(this.#tier)),
      uniforms: { field: { value: this.#texture } },
    });
    drawFullscreen(this.#renderer, material, target);
    material.dispose();
    target.dispose();
  }

  /** The staging textures' CPU side, empty between writes: `borders.slots` and `.previews`. */
  inspectMemory(account: MemoryAccount): void {
    account.texture('borders.slots', this.#bandStaging);
    account.texture('borders.previews', this.#cellStaging);
  }

  #write(source: DataTexture, texels: Uint8Array, x: number, y: number, layer: number): void {
    source.image.data = texels;
    this.#renderer.copyTextureToTexture(
      source,
      this.#texture,
      null,
      this.#origin.set(x, y, layer),
      0,
      0,
    );
    source.image.data = null;
  }
}

function staging(width: number, height: number): DataTexture {
  const texture = new DataTexture(null, width, height, RGFormat, UnsignedByteType);
  texture.flipY = false;
  texture.unpackAlignment = 1;
  return texture;
}

function check(name: string, value: number, max: number): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${name} must be an integer in 0..${max}, got ${value}`);
  }
}

function warmFragment(layers: number): string {
  return /* glsl */ `
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray field;
out vec4 color;
void main() {
  vec4 sum = vec4(0.0);
  for (int layer = 0; layer < ${layers}; layer++) sum += texelFetch(field, ivec3(0, 0, layer), 0);
  color = sum;
}`;
}
