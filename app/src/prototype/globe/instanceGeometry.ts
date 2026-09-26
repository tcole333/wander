// The streamed globe's geometry: the shared tile grid, drawn once per instance, with the instance
// words (instances.ts) bound as the integer attributes the surface vertex chunk reads. The buffer is
// allocated at full capacity up front, since three caches the instance count at first bind.
import {
  Box3,
  BufferAttribute,
  DynamicDrawUsage,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Sphere,
  Vector3,
} from 'three';
import { INSTANCE_WORDS } from '../../globe/instances';
import { buildTileGrid, type Segments } from '../../globe/tileGrid';

/** Radius past any displaced vertex at kLand up to 16 (Everest is 0.022). */
const BOUNDS_RADIUS = 1.05;

export interface InstanceGeometry {
  geometry: InstancedBufferGeometry;
  /** INSTANCE_WORDS per instance, `capacity` instances. */
  words: Uint32Array;
  capacity: number;
  /** Uploads the first `count` instances of `words` and draws that many. */
  commit(count: number): void;
}

export function createInstanceGeometry(segments: Segments, capacity: number): InstanceGeometry {
  const grid = buildTileGrid(segments);
  const geometry = new InstancedBufferGeometry();
  geometry.setIndex(new BufferAttribute(grid.index, 1));
  geometry.setAttribute('position', new BufferAttribute(grid.position, 3));
  geometry.setAttribute('normal', new BufferAttribute(grid.normal, 3, true));
  // A Uint32Array, so three binds both halves with vertexAttribIPointer.
  const words = new Uint32Array(capacity * INSTANCE_WORDS);
  const buffer = new InstancedInterleavedBuffer(words, INSTANCE_WORDS, 1);
  buffer.setUsage(DynamicDrawUsage);
  geometry.setAttribute('wanderNode', new InterleavedBufferAttribute(buffer, 4, 0));
  geometry.setAttribute('wanderPrev', new InterleavedBufferAttribute(buffer, 4, 4));
  geometry.instanceCount = 0;
  // The grid holds lattice integers, not positions, so three must never compute bounds from it.
  geometry.boundingSphere = new Sphere(new Vector3(), BOUNDS_RADIUS);
  geometry.boundingBox = new Box3(
    new Vector3().setScalar(-BOUNDS_RADIUS),
    new Vector3().setScalar(BOUNDS_RADIUS),
  );
  return {
    geometry,
    words,
    capacity,
    commit(count) {
      buffer.clearUpdateRanges();
      buffer.addUpdateRange(0, Math.max(1, count) * INSTANCE_WORDS);
      buffer.needsUpdate = true;
      geometry.instanceCount = count;
    },
  };
}
