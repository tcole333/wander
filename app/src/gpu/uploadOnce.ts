// Sources explicitly known to be immutable. These hooks run once after the GL upload, never
// during a later draw. The walk reloads on context loss; in-place restoration would need fresh
// sources. Do not use these for partial uploads, pool staging, or fields edited by story time.
import {
  InterleavedBufferAttribute,
  type BufferGeometry,
  type CanvasTexture,
  type Texture,
} from 'three';

export function releaseCanvasAfterUpload(texture: CanvasTexture): CanvasTexture {
  texture.onUpdate = () => {
    const canvas = texture.image;
    // Drop the native backing store as well as the JS reference (not just the canvas element).
    canvas.width = 0;
    canvas.height = 0;
    (texture as Texture).image = null;
    texture.onUpdate = null;
  };
  return texture;
}

/** Only geometry never edited, cloned or raycast on the CPU after construction. */
export function releaseGeometryAfterUpload(geometry: BufferGeometry): void {
  // Frustum/shadow culling must not try to derive bounds from the discarded positions later.
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  for (const value of [...Object.values(geometry.attributes), geometry.index]) {
    if (!value) continue;
    const attribute = value instanceof InterleavedBufferAttribute ? value.data : value;
    attribute.onUpload(() => {
      // slice, not subarray: even a zero-length view would keep the old backing buffer alive.
      // Keep count/itemSize and the typed-array kind; three caches the GL type and size at upload.
      attribute.array = attribute.array.slice(0, 0);
    });
  }
}
