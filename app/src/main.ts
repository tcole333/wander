// The production entry (index.html): the stories over the streamed globe, starting in the
// lobby (lobby/lobby.ts), from the data host the bundled release names (generated/release.json,
// which npm run publish-data writes). The room (page/room.ts) is the poster until the lobby's
// opening starts, and crossfades into it, its mark gliding onto the lobby's. Data that does not
// arrive brings a plate with a Reload control; a browser that cannot draw the globe (no WebGL 2
// context, a shader that does not link) brings both stories' titles and blurbs instead, never a
// reload loop. A failure after choosing shows that story's card, or Explore's, whose plaque stands
// last in the lobby wherever the release names its event index (walk/boot.ts). A lost context
// reloads once; a second loss within a few minutes brings the card (page/contextLoss.ts).
//
// On a page served from this machine, ?data=<origin>|fixture|region|global reads a local data
// server's release instead (page/dataOrigin.ts), for the smoke test and local checks; ?memory=1
// and ?hooks=1 serve the memory account and the view hook to scripts.
import './page/room.css';
import { DataError, fetchData } from './data/surfaceLayer';
import type { Release } from './data/release';
import bundled from './generated/release.json';
import { afterContextLoss } from './page/contextLoss';
import { dataOverride, memoryRequested, viewHookRequested } from './page/dataOrigin';
import { dataPlate, explorePlate, lobbyPlate, Room, storyPlate, type Unable } from './page/room';
import { stories } from './story/catalog';
import { bootWalk, DrawError } from './walk/boot';
import type { Choice } from './walk/mode';

async function main(): Promise<void> {
  const roomElement = document.getElementById('room');
  if (!roomElement) throw new Error('index.html has no #room');
  const room = new Room(roomElement);
  let chosen: Choice | null = null;
  const card = (why: Unable) =>
    chosen?.kind === 'story'
      ? storyPlate(chosen.story, why)
      : chosen?.kind === 'explore'
        ? explorePlate(why)
        : lobbyPlate(
            stories.map(({ story }) => story),
            why,
          );
  const failurePlate = (error: unknown) =>
    error instanceof DataError
      ? dataPlate()
      : card(error instanceof DrawError ? 'cannot-draw' : 'stopped');

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
      room.fail(card('lost-twice'));
    },
    { capture: true, once: true },
  );

  let opened: Promise<void> | undefined;
  let mark: HTMLElement | undefined;
  try {
    const release = await readRelease();
    const walk = await bootWalk(document.body, release, {
      stories,
      lobby: true,
      onStory: (choice) => {
        chosen = choice;
      },
      // A choice that does not start from its plaque brings its card, as a boot that stops does.
      onFail: (error, choice) => {
        console.error(error);
        chosen = choice;
        dispose();
        room.fail(failurePlate(error));
      },
    });
    const removeHooks: (() => void)[] = [];
    dispose = () => {
      for (const remove of removeHooks) remove();
      walk.dispose();
    };
    if (memoryRequested(location)) {
      const { installMemoryHook } = await import('./perf/memoryHook');
      removeHooks.push(installMemoryHook(walk));
    }
    if (viewHookRequested(location)) {
      const { installViewHook } = await import('./page/viewHook');
      removeHooks.push(installViewHook(walk));
    }
    opened = walk.lobby?.opened;
    mark = walk.lobby?.mark;
  } catch (error) {
    console.error(error);
    // A loss mid-boot fails it too; the loss has its own answer.
    if (!lost) room.fail(failurePlate(error));
    return;
  }
  if (lost) {
    dispose();
    return;
  }
  // The room stands until the lobby's opening starts, once the globe's first tiles are in. The
  // frame loop draws before this callback's frame ends, so the next one follows a live frame.
  await opened;
  requestAnimationFrame(() => requestAnimationFrame(() => void room.open(mark)));
}

/** The bundled release, or on this machine the release of the data server ?data= names. */
async function readRelease(): Promise<Release> {
  const origin = dataOverride(location);
  if (origin === null) return bundled;
  const bytes = await fetchData(`${origin}/release.json`);
  return JSON.parse(new TextDecoder().decode(bytes)) as Release;
}

void main();
