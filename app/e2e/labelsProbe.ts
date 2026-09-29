// Test-only, served by Vite (e2e/labels.html). Loads the page's faces as a boot with Explore
// enabled does (story/ui/fonts.ts), then letters every kind of label text Explore draws, in the
// labels' family (tokens.css --label), with Latin, Vietnamese and Cyrillic names from the event
// index, and reports what the browser fetched once the text was drawn: nothing, since the family
// holds only Latin and Latin Extended and draws other letters in the system serif.
import '../src/story/ui/tokens.css';
import { LABEL_FAMILY, loadFaces } from '../src/story/ui/fonts';

/** Every kind of label text: a plate's name, date and parent, Meanwhile's rows, the listbox, the live region. */
const LABELS = [
  { kind: 'plate name', weight: 600, size: 15 },
  { kind: 'plate date', weight: 400, size: 12 },
  { kind: 'plate parent', weight: 400, size: 12 },
  { kind: 'meanwhile row', weight: 400, size: 14 },
  { kind: 'listbox option', weight: 400, size: 14 },
  { kind: 'live region', weight: 400, size: 14 },
];

/** Names as the index holds them, in each script its labels use. */
const NAMES = ['Battle of Waterloo', 'Trận Bạch Đằng', 'Бородинское сражение', 'Siège de Québec'];

export interface LabelsProbe {
  /** The label family's faces and whether each loaded. */
  faces: { weight: string; status: string }[];
  /** Each label's family as the page computes it. */
  families: string[];
  /** What the page fetched once the labels were drawn. */
  fetched: string[];
}

declare global {
  interface Window {
    labelsProbe?: LabelsProbe;
  }
}

const frame = () => new Promise<void>((done) => requestAnimationFrame(() => done()));

async function probe(): Promise<LabelsProbe> {
  await loadFaces('Waterloo', { labels: true });
  const from = performance.now();
  const labels = LABELS.flatMap(({ kind, weight, size }) =>
    NAMES.map((name) => {
      const label = document.createElement('div');
      label.dataset.kind = kind;
      label.style.font = `${weight} ${size}px var(--label)`;
      label.textContent = `${name}, 18 June 1815`;
      document.body.append(label);
      return label;
    }),
  );
  for (const label of labels) label.getBoundingClientRect();
  await frame();
  await frame();
  await document.fonts.ready;
  await frame();
  return {
    faces: [...document.fonts]
      .filter((face) => face.family.replaceAll('"', '') === LABEL_FAMILY)
      .map((face) => ({ weight: face.weight, status: face.status })),
    families: labels.map((label) => getComputedStyle(label).fontFamily),
    fetched: performance
      .getEntriesByType('resource')
      .filter((entry) => entry.startTime >= from)
      .map((entry) => entry.name),
  };
}

void probe().then((report) => (window.labelsProbe = report));
