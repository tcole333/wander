// The page's faces: the boot waits for them, but a face that fails or never arrives holds it no
// longer than FACE_WAIT_MS, and is left to its fallback.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FACE_WAIT_MS, loadFaces } from './fonts';

/** document.fonts, answering every load with `load`; the faces it was given. */
function stubFonts(load: () => Promise<FontFace[]>): FontFace[] {
  const added: FontFace[] = [];
  vi.stubGlobal('document', { fonts: { load, add: (face: FontFace) => added.push(face) } });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  return added;
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

  it('declare the label family once, Latin and Latin Extended in 400 and 600, and load it whole', async () => {
    const loaded: string[] = [];
    vi.stubGlobal(
      'FontFace',
      class {
        constructor(
          readonly family: string,
          readonly source: string,
          readonly descriptors: FontFaceDescriptors,
        ) {}
        load() {
          loaded.push(this.source);
          return Promise.resolve(this);
        }
      },
    );
    const added = stubFonts(() => Promise.resolve([]));
    await loadFaces('Waterloo', { labels: true });
    await loadFaces('Waterloo', { labels: true });
    expect(added).toHaveLength(4);
    expect(new Set(added.map((face) => face.family))).toEqual(new Set(['Wander Label']));
    const faces = added.map(
      (face) => (face as unknown as { descriptors: FontFaceDescriptors }).descriptors,
    );
    expect(faces.map((face) => face.weight)).toEqual(['400', '400', '600', '600']);
    for (const face of faces) {
      expect(face.unicodeRange).not.toMatch(/U\+0400|U\+1EA0/);
    }
    expect(loaded).toHaveLength(8);
  });

  it('leave the label family undeclared unless asked', async () => {
    const added = stubFonts(() => Promise.resolve([]));
    await loadFaces('Tambora');
    expect(added).toEqual([]);
  });
});
