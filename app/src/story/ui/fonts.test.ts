// The page's faces: the boot waits for them, but a face that fails or never arrives holds it no
// longer than FACE_WAIT_MS, and is left to its fallback.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FACE_WAIT_MS, loadFaces } from './fonts';

/** document.fonts, answering every load with `load`. */
function stubFonts(load: () => Promise<FontFace[]>): void {
  vi.stubGlobal('document', { fonts: { load } });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the faces', () => {
  it('stop holding the boot once FACE_WAIT_MS has passed', async () => {
    vi.useFakeTimers();
    stubFonts(() => new Promise(() => {}));
    let done = false;
    void loadFaces('Tambora').then(() => (done = true));
    await vi.advanceTimersByTimeAsync(FACE_WAIT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it('let the boot go on when one fails', async () => {
    stubFonts(() => Promise.reject(new Error('the face did not arrive')));
    await expect(loadFaces('Tambora')).resolves.toBeUndefined();
  });
});
