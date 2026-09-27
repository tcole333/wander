// The production entry (index.html): the Tambora walk over the streamed globe, starting on its
// first beat, from the data host the bundled release names (generated/release.json, which
// npm run publish-data writes). The room (page/room.ts) is the poster until the first live frame
// and crossfades into it. Data that does not arrive brings a plate with a Reload control; a
// browser that cannot draw the globe (no WebGL 2 context, a shader that does not link) brings the
// story's card instead, never a reload loop, and any other failure brings the card with a Reload.
// A lost WebGL context reloads the page once; a second loss within a few minutes brings the card
// (page/contextLoss.ts).
//
// On a page served from this machine, ?data=<origin>|fixture|region|global reads a local data
// server's release instead (page/dataOrigin.ts), for the smoke test and local checks.
import './page/room.css';
import storyText from '../../stories/tambora/story.md?raw';
import { DataError, fetchData } from './data/surfaceLayer';
import type { Release } from './data/release';
import bundled from './generated/release.json';
import { afterContextLoss } from './page/contextLoss';
import { dataOverride } from './page/dataOrigin';
import { dataPlate, Room, storyPlate } from './page/room';
import meanwhile from './story/meanwhile.tambora.json';
import { meanwhileFromJson } from './story/meanwhile';
import { parseStory, type Story } from './story/story';
import { bootWalk, DrawError, type WalkPage } from './walk/boot';

async function main(): Promise<void> {
  const roomElement = document.getElementById('room');
  if (!roomElement) throw new Error('index.html has no #room');
  const room = new Room(roomElement);
  const story = parseStory(storyText);

  let walk: WalkPage;
  try {
    const release = await readRelease();
    walk = await bootWalk(document.body, release, {
      story: { story, meanwhile: meanwhileFromJson(meanwhile) },
    });
  } catch (error) {
    console.error(error);
    room.fail(failurePlate(error, story));
    return;
  }

  walk.canvas.addEventListener(
    'webglcontextlost',
    () => {
      if (afterContextLoss(() => sessionStorage, Date.now()) === 'reload') {
        location.reload();
        return;
      }
      walk.dispose();
      room.fail(storyPlate(story, 'lost-twice'));
    },
    { once: true },
  );
  // The frame loop draws before this callback's frame ends, so the next one follows a live frame.
  requestAnimationFrame(() => requestAnimationFrame(() => room.open()));
}

/** The plate a boot that failed with `error` brings. */
function failurePlate(error: unknown, story: Story): HTMLElement {
  if (error instanceof DataError) return dataPlate();
  return storyPlate(story, error instanceof DrawError ? 'cannot-draw' : 'stopped');
}

/** The bundled release, or on this machine the release of the data server ?data= names. */
async function readRelease(): Promise<Release> {
  const origin = dataOverride(location);
  if (origin === null) return bundled;
  const bytes = await fetchData(`${origin}/release.json`);
  return JSON.parse(new TextDecoder().decode(bytes)) as Release;
}

void main();
