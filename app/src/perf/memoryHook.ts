// Loaded only when a loopback production page asks for ?memory=1. No timers, retained resource
// registry, patched constructors, or work in a frame. E3 calls the hook after its forced GC.
import { unlockedSound } from '../audio/engine';
import type { WalkPage } from '../walk/boot';
import { MemoryAccount } from './memory';

export function installMemoryHook(walk: WalkPage): () => void {
  const sample = () => {
    const account = new MemoryAccount();
    unlockedSound()?.inspectMemory(account);
    walk.inspectMemory(account);
    const images = [...document.images].filter((image) => image.complete && image.naturalWidth > 0);
    const files = account.details.cardFiles as { key: string; w: number; h: number }[];
    const sizeOf = (image: HTMLImageElement) => {
      const file = files.find((file) => new URL(image.currentSrc).pathname === `/${file.key}`);
      // srcset's naturalWidth can be density-corrected; the lock names the encoded pixel size.
      return { width: file?.w ?? image.naturalWidth, height: file?.h ?? image.naturalHeight };
    };
    const seen = new Set<string>();
    for (const image of images) {
      if (seen.has(image.currentSrc)) continue;
      seen.add(image.currentSrc);
      const { width, height } = sizeOf(image);
      account.bytes('cards.attached', 'imagePixels', width * height * 4);
    }
    account.details.cards = images.map((image) => ({
      url: image.currentSrc,
      ...sizeOf(image),
    }));
    account.details.fonts = {
      faces: [...document.fonts]
        .filter((face) => face.status === 'loaded')
        .map((face) => ({
          family: face.family,
          weight: face.weight,
          style: face.style,
          unicodeRange: face.unicodeRange,
        })),
      resources: performance
        .getEntriesByType('resource')
        .filter((entry) => /\.(woff2?|ttf)(\?|$)/.test(entry.name))
        .map((entry) => ({
          url: entry.name,
          encodedBytes: (entry as PerformanceResourceTiming).encodedBodySize,
        })),
      decodedBytes: null,
    };
    return {
      version: 1,
      units: 'bytes',
      ...account.report(),
      coverage: [
        'ArrayBuffers: unique backing allocations, not view lengths; audio samples are separate (browser storage can overlap allocator categories).',
        'Canvas and attached image pixels: width × height × 4 estimates; browser/Skia caches, copies and GPU-backed canvases are not observable here.',
        'Fonts: loaded faces and encoded resource sizes only; decoded fonts and glyph caches have no byte API. Resource Timing may have evicted old entries.',
        'No resident surface byte cache or CPU height grids in milestone 1. Pending fetch/worker working buffers are not observable; compare settled samples.',
        'JS objects, browser image cache after detachment, audio nodes and fading sources, allocator slack and GL command/transfer buffers are outside this account. Do not equate its sum with process footprint.',
      ],
    };
  };
  window.__wanderMemory = sample;
  return () => {
    if (window.__wanderMemory === sample) delete window.__wanderMemory;
  };
}

declare global {
  interface Window {
    __wanderMemory?: () => unknown;
  }
}
