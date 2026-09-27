// The production entry (index.html): the Tambora walk over the streamed globe, starting on its
// first beat, from the data host the bundled release names (generated/release.json, which
// npm run publish-data writes). The room (page/room.ts) is the poster until the first live frame
// and crossfades into it. Data that does not arrive brings a plate with a Reload control; a
// browser that cannot draw the globe (no WebGL 2, no half-float render targets, a renderer or
// shader that fails) brings the story's card instead, never a reload loop. A lost WebGL context
// reloads the page once; a second loss within a few minutes brings the card (page/contextLoss.ts).
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
import { parseStory } from './story/story';
import { bootWalk, type WalkPage } from './walk/boot';

async function main(): Promise<void> {
  const roomElement = document.getElementById('room');
  if (!roomElement) throw new Error('index.html has no #room');
  const room = new Room(roomElement);
  const story = parseStory(storyText);

  const unable = cannotDraw();
  if (unable) {
    console.error(`Wander cannot draw here: ${unable}`);
    room.fail(storyPlate(story, 'cannot-draw'));
    return;
  }

  let walk: WalkPage;
  try {
    const release = await readRelease();
    walk = await bootWalk(document.body, release, {
      story: { story, meanwhile: meanwhileFromJson(meanwhile) },
    });
  } catch (error) {
    console.error(error);
    room.fail(error instanceof DataError ? dataPlate() : storyPlate(story, 'cannot-draw'));
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

/** The bundled release, or on this machine the release of the data server ?data= names. */
async function readRelease(): Promise<Release> {
  const origin = dataOverride(location);
  if (origin === null) return bundled;
  const bytes = await fetchData(`${origin}/release.json`);
  return JSON.parse(new TextDecoder().decode(bytes)) as Release;
}

/**
 * Why this browser cannot draw the walk, or null when it can: the renderer needs WebGL 2, and the
 * scene's composer renders into half-float targets.
 */
function cannotDraw(): string | null {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return 'no WebGL 2';
  const halfFloat =
    gl.getExtension('EXT_color_buffer_float') ?? gl.getExtension('EXT_color_buffer_half_float');
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return halfFloat ? null : 'no half-float render targets';
}

void main();
