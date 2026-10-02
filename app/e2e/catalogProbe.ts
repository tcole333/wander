// Test-only, served by Vite. The stories the production entry boots with (story/catalog.ts), in
// plaque order, with the titles their cards show, for the specs that visit every story: a spec
// runs in Node, where the catalog's Vite imports of the stories' text do not load.
import { stories } from '../src/story/catalog';
import { curlyQuotes } from '../src/story/ui/format';

export interface CatalogEntry {
  id: string;
  /** Each beat's title as its card shows it. */
  beats: string[];
}

declare global {
  interface Window {
    catalogProbe?: CatalogEntry[];
  }
}

window.catalogProbe = stories.map(({ story }) => ({
  id: story.id,
  beats: story.beats.map((beat) => curlyQuotes(beat.title)),
}));
