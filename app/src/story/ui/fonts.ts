// The faces the lobby, the walk and the Credits panel draw (tokens.css): Libre Baskerville for
// display, in 400 and the callouts' 700, and Source Serif 4 for reading, in 400, its italic and 600.
// A browser fetches a face only when some text first needs it, and each of its subsets (Latin,
// Latin Extended and the rest) only for characters in its range, so a face or subset first drawn
// mid-story would come from the app's host then. The boot loads them all for the page's text
// before the room opens, since nothing is fetched from Pages after boot (streaming.md 2), waiting
// no longer than FACE_WAIT_MS: a face that stalls then only arrives late.
//
// Explore's labels (--label in tokens.css) name events from the whole index, whose text no one
// knows at boot. Their family, "Wander Label", is Source Serif 4 in 400 and 600 with its Latin and
// Latin Extended subsets only, declared and loaded whole where Explore is enabled; a letter
// outside them (the few Vietnamese and Cyrillic labels) draws in the system serif rather than
// fetching another subset.
import '@fontsource/libre-baskerville/400.css';
import '@fontsource/libre-baskerville/700.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/400-italic.css';
import '@fontsource/source-serif-4/600.css';
import latin400 from '@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff2';
import latin600 from '@fontsource/source-serif-4/files/source-serif-4-latin-600-normal.woff2';
import latinExt400 from '@fontsource/source-serif-4/files/source-serif-4-latin-ext-400-normal.woff2';
import latinExt600 from '@fontsource/source-serif-4/files/source-serif-4-latin-ext-600-normal.woff2';

/** Each face, as a CSS font shorthand. */
const FACES = [
  '400 16px "Libre Baskerville"',
  '700 16px "Libre Baskerville"',
  '400 16px "Source Serif 4"',
  'italic 400 16px "Source Serif 4"',
  '600 16px "Source Serif 4"',
];

/** The labels' family, as tokens.css's --label names it. */
export const LABEL_FAMILY = 'Wander Label';

/** Source Serif 4's Latin and Latin Extended ranges, as @fontsource declares them. */
const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,' +
  'U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,' +
  'U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,' +
  'U+A720-A7FF';

/** The label family's four faces: each weight's Latin and Latin Extended file. */
const LABEL_FACES = [
  { weight: '400', file: latin400, range: LATIN },
  { weight: '400', file: latinExt400, range: LATIN_EXT },
  { weight: '600', file: latin600, range: LATIN },
  { weight: '600', file: latinExt600, range: LATIN_EXT },
];

/** The longest the faces are waited for, in ms: the live frame's 3 s (streaming.md 6). */
export const FACE_WAIT_MS = 3000;

export interface FaceOptions {
  /** Also declares the label family and loads its four faces whole, for Explore. */
  labels?: boolean;
}

/**
 * Loads every face's subsets that `text` reaches, and the label faces if asked, waiting at most
 * FACE_WAIT_MS. A face that fails, or is still loading then, is logged and left to its fallback,
 * since the page reads without it.
 */
export async function loadFaces(text: string, { labels = false }: FaceOptions = {}): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => (timer = setTimeout(resolve, FACE_WAIT_MS, null)));
  const loading: Promise<unknown>[] = FACES.map((face) => document.fonts.load(face, text));
  if (labels) loading.push(...labelFaces().map((face) => face.load()));
  const loads = await Promise.race([Promise.allSettled(loading), late]);
  clearTimeout(timer);
  if (!loads) {
    console.warn(`The faces had not loaded after ${FACE_WAIT_MS} ms.`);
    return;
  }
  for (const load of loads) {
    if (load.status === 'rejected') console.warn('A face did not load:', load.reason);
  }
}

/** The label family's faces, once declared in the document. */
let declared: FontFace[] | null = null;

/** The label family's faces, declared in the document the first time they are asked for. */
function labelFaces(): FontFace[] {
  declared ??= LABEL_FACES.map(({ weight, file, range }) => {
    const face = new FontFace(LABEL_FAMILY, `url(${file}) format('woff2')`, {
      weight,
      style: 'normal',
      display: 'swap',
      unicodeRange: range,
    });
    document.fonts.add(face);
    return face;
  });
  return declared;
}
