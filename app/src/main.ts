// The production entry (index.html): the Tambora walk over the streamed globe, starting in the
// lobby (lobby/lobby.ts), from the data host the bundled release names (generated/release.json,
// which npm run publish-data writes). The room (page/room.ts) is the poster until the lobby's
// opening starts, and crossfades into it. Data that does not arrive brings a plate with a Reload
// control; a browser that cannot draw the globe (no WebGL 2 context, a shader that does not link)
// brings the story's card instead, never a reload loop, and any other failure brings the card with
// a Reload. A lost WebGL context reloads the page once; a second loss within a few minutes brings
// the card (page/contextLoss.ts).
//
// On a page served from this machine, ?data=<origin>|fixture|region|global reads a local data
// server's release instead (page/dataOrigin.ts), for the smoke test and local checks.
import './page/room.css';
import storyText from '../../stories/tambora/story.md?raw';
import storyLock from '../../stories/tambora/story.lock.json';
import { DataError, fetchData } from './data/surfaceLayer';
import type { Release } from './data/release';
import bundled from './generated/release.json';
import { afterContextLoss } from './page/contextLoss';
import { dataOverride } from './page/dataOrigin';
import { dataPlate, Room, storyPlate } from './page/room';
import { withLock } from './story/lock';
import meanwhile from './story/meanwhile.tambora.json';
import { meanwhileFromJson } from './story/meanwhile';
import { parseStory, type Story } from './story/story';
import { bootWalk, DrawError } from './walk/boot';

async function main(): Promise<void> {
  const roomElement = document.getElementById('room');
  if (!roomElement) throw new Error('index.html has no #room');
  const room = new Room(roomElement);
  const story = withLock(parseStory(storyText), storyLock);

  // Watched from before the boot, whose warm-up can lose the context too. The event does not
  // bubble, but it passes through the window on its way to the canvas.
  let lost = false;
  let dispose = () => {};
  addEventListener(
    'webglcontextlost',
    () => {
      lost = true;
      if (afterContextLoss(() => sessionStorage, Date.now()) === 'reload') {
        location.reload();
        return;
      }
      dispose();
      room.fail(storyPlate(story, 'lost-twice'));
    },
    { capture: true, once: true },
  );

  let opened: Promise<void> | undefined;
  try {
    const release = await readRelease();
    const walk = await bootWalk(document.body, release, {
      story: { story, meanwhile: meanwhileFromJson(meanwhile) },
      lobby: true,
    });
    dispose = () => walk.dispose();
    opened = walk.lobby?.opened;
  } catch (error) {
    console.error(error);
    // A loss mid-boot fails it too; the loss has its own answer.
    if (!lost) room.fail(failurePlate(error, story));
    return;
  }
  if (lost) {
    dispose();
    return;
  }
  // The room stands until the lobby's opening starts, once the globe's first tiles are in. The
  // frame loop draws before this callback's frame ends, so the next one follows a live frame.
  await opened;
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
