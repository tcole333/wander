// The faces the lobby, the walk and the Credits panel draw (tokens.css): Libre Baskerville for
// display, in 400 and the callouts' 700, and Source Serif 4 for reading, in 400, its italic and 600.
// A browser fetches a face only when some text first needs it, and each of its subsets (Latin,
// Latin Extended and the rest) only for characters in its range, so a face or subset first drawn
// mid-story would come from the app's host then. The boot loads them all for the page's text
// before the room opens, since nothing is fetched from Pages after boot (streaming.md 2).
import '@fontsource/libre-baskerville/400.css';
import '@fontsource/libre-baskerville/700.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/400-italic.css';
import '@fontsource/source-serif-4/600.css';

/** Each face, as a CSS font shorthand. */
const FACES = [
  '400 16px "Libre Baskerville"',
  '700 16px "Libre Baskerville"',
  '400 16px "Source Serif 4"',
  'italic 400 16px "Source Serif 4"',
  '600 16px "Source Serif 4"',
];

/**
 * Loads every face's subsets that `text` reaches, Latin always. A face that fails is logged and
 * left to its fallback, since the page reads without it.
 */
export async function loadFaces(text: string): Promise<void> {
  const loads = await Promise.allSettled(
    FACES.map((face) => document.fonts.load(face, `A${text}`)),
  );
  for (const load of loads) {
    if (load.status === 'rejected') console.warn('A face did not load:', load.reason);
  }
}
