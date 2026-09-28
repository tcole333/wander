// Sources explicitly known to be immutable. These hooks run once after the GL upload, never
// during a later draw. The walk reloads on context loss; in-place restoration would need fresh
// sources. Do not use these for partial uploads, pool staging, or fields edited by story time.
import type { CanvasTexture, Texture } from 'three';

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
