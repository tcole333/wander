// The shipped stories, in plaque order. Only their text and locks enter the bundle; images and
// effect data stay on the release's data host. Both entry points use these same joined sources.
import tamboraText from '../../../stories/tambora/story.md?raw';
import tamboraLock from '../../../stories/tambora/story.lock.json';
import magellanText from '../../../stories/magellan/story.md?raw';
import magellanLock from '../../../stories/magellan/story.lock.json';
import type { StorySource } from '../walk/boot';
import { withLock, type StoryLock } from './lock';
import { glowsFromLock, meanwhileFromLock } from './meanwhile';
import { parseStory } from './story';

function source(text: string, lock: StoryLock): StorySource {
  return {
    story: withLock(parseStory(text), lock),
    meanwhile: meanwhileFromLock(lock),
    glows: glowsFromLock(lock),
  };
}

export const stories: readonly StorySource[] = [
  source(tamboraText, tamboraLock),
  source(magellanText, magellanLock),
];

/** The dev page's ?story=; absent means the free globe, and a typo never plays another story. */
export function storyNamed(id: string | null): StorySource | null {
  if (id === null) return null;
  const found = stories.find(({ story }) => story.id === id);
  if (!found) throw new Error(`no story '${id}'`);
  return found;
}
