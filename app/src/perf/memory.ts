// A point-in-time account, never a frame-loop observer. Owners lend references only for the
// duration of a sample; the report keeps numbers, not the resources it counted.
import { Texture, type BufferGeometry, type Material, type Object3D } from 'three';
import type { DecodedWst } from '../surface/wst';

export type MemoryKind = 'arrayBuffers' | 'audioSamples' | 'canvasPixels' | 'imagePixels';
export type MemoryTotals = Record<MemoryKind, number>;
const empty = (): MemoryTotals => ({
  arrayBuffers: 0,
  audioSamples: 0,
  canvasPixels: 0,
  imagePixels: 0,
});

export class MemoryAccount {
  readonly owners: Record<string, MemoryTotals> = {};
  readonly details: Record<string, unknown> = {};
  readonly #buffers = new Set<ArrayBufferLike>();
  readonly #objects = new Set<object>();

  bytes(owner: string, kind: MemoryKind, bytes: number): void {
    (this.owners[owner] ??= empty())[kind] += bytes;
  }

  /** Counts the entire backing allocation once, including a subarray's unused prefix/suffix. */
  array(owner: string, data: ArrayBufferLike | ArrayBufferView | null | undefined): void {
    this.bytes(owner, 'arrayBuffers', 0);
    if (!data) return;
    const buffer = ArrayBuffer.isView(data) ? data.buffer : data;
    if (this.#buffers.has(buffer)) return;
    this.#buffers.add(buffer);
    this.bytes(owner, 'arrayBuffers', buffer.byteLength);
  }

  audio(owner: string, buffer: AudioBuffer): void {
    if (this.#objects.has(buffer)) return;
    this.#objects.add(buffer);
    // Do not call getChannelData: that can materialize another JS-visible copy in the browser.
    this.bytes(owner, 'audioSamples', buffer.length * buffer.numberOfChannels * 4);
  }

  texture(owner: string, texture: Texture): void {
    this.bytes(owner, 'arrayBuffers', 0);
    this.bytes(owner, 'canvasPixels', 0);
    if (this.#objects.has(texture.source)) return;
    this.#objects.add(texture.source);
    const image = texture.image as { data?: ArrayBufferView; width: number; height: number } | null;
    if (image?.data) this.array(owner, image.data);
    if (image && 'getContext' in image) {
      this.bytes(owner, 'canvasPixels', image.width * image.height * 4);
    }
    for (const mip of texture.mipmaps ?? []) {
      if ('data' in mip && ArrayBuffer.isView(mip.data)) this.array(owner, mip.data);
    }
  }

  geometry(owner: string, geometry: BufferGeometry): void {
    if (geometry.index) this.array(owner, geometry.index.array);
    for (const attribute of Object.values(geometry.attributes)) this.array(owner, attribute.array);
  }

  object(owner: string, root: Object3D): void {
    root.traverse((object) => {
      const draw = object as Object3D & {
        geometry?: BufferGeometry;
        material?: Material | Material[];
      };
      if (draw.geometry) this.geometry(`${owner}.geometry`, draw.geometry);
      for (const material of [draw.material ?? []].flat()) {
        const values: unknown[] = Object.values(material);
        if ('uniforms' in material) {
          const uniforms = material.uniforms as Record<string, { value: unknown }>;
          values.push(...Object.values(uniforms).map((u) => u.value));
        }
        for (const value of values) {
          if (value instanceof Texture) this.texture(`${owner}.textures`, value as Texture);
        }
      }
    });
  }

  tile(owner: string, tile: DecodedWst): void {
    for (const data of [
      ...tile.heightMips,
      ...tile.channelMips,
      tile.edges,
      tile.grid,
      tile.compressed,
    ]) {
      this.array(owner, data);
    }
  }

  report() {
    const totals = empty();
    for (const row of Object.values(this.owners)) {
      for (const kind of Object.keys(totals) as MemoryKind[]) totals[kind] += row[kind];
    }
    return { owners: this.owners, totals, details: this.details };
  }
}
