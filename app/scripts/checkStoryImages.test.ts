import { afterEach, expect, it, vi } from 'vitest';
import type { Release } from '../src/data/release';
import bundled from '../src/generated/release.json';
import { stories } from '../src/story/catalog';
import { APP_ORIGIN, checkRelease, firstStoryImages, releaseKeys } from './checkRelease';
import { objectHeaders } from './objectHeaders';

afterEach(() => vi.unstubAllGlobals());

it('checks the image on each opening card, not the first hash in the sorted release', async () => {
  const release: Release = bundled;
  const images = stories.map(
    ({ story }) =>
      story.beats[0]!.image.locked!.files.find(
        (file) => file.w === 256 && file.key.endsWith('.jpg'),
      )!.key,
  );
  expect(firstStoryImages().toSorted()).toEqual(images.toSorted());
  expect(
    releaseKeys(release)
      .data.filter((key) => key.startsWith('img/'))
      .toSorted(),
  ).toEqual(images.toSorted());
  const fetch = vi.fn((url: string) => {
    const key = url.slice(release.dataHost.length + 1);
    return Promise.resolve(
      new Response(new Uint8Array(1), {
        headers: {
          ...objectHeaders(key),
          'Access-Control-Allow-Origin': '*',
        },
      }),
    );
  });
  vi.stubGlobal('fetch', fetch);
  expect(await checkRelease(release)).toEqual([]);
  expect(fetch.mock.calls[0]?.[0]).toBe(`${release.dataHost}/rel/${release.id}.json`);
  for (const key of images)
    expect(fetch).toHaveBeenCalledWith(`${release.dataHost}/${key}`, {
      method: 'GET',
      headers: { Origin: APP_ORIGIN },
    });
});

it('rejects an omitted opening image before touching the data host', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const images = firstStoryImages();
  const release = {
    ...bundled,
    media: { images: bundled.media.images.filter((key) => key !== images[0]) },
  };
  expect(await checkRelease(release)).toEqual([
    `${images[0]}: the release omits a story's first image`,
  ]);
  expect(fetch).not.toHaveBeenCalled();
});
