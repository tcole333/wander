// The event marks' specimen sheet: every glyph of src/marks/symbols.ts by pace layer, at the
// marks' sizes on the globe (12, 16 and 20 px) and at the size the smallest mark's cast token
// holds it (variant 0, the marks' default), on bronze and on the lacquer of the sea, and at 128 px
// on its 64-unit grid, with the classes of pipeline/config/event-classes.yaml that take it, the
// circle its family's token holds it within and, for a storm, its mirrored southern form; then
// every glyph on its family's cast token at the marks' sizes, drawn flat.
// Writes the SVG, then a PNG of it through headless Chromium, and prints each glyph's ink. From app/:
//   node scripts/glyphSheet.ts --out ../build/explore/glyphs.svg [--png <path>] [--scale 1]
// --png defaults to the SVG's path with .png; --scale is the PNG's device pixel ratio (1 shows the
// small sizes pixel for pixel; the walk renders at up to 1.5).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { EVENT_CLASS_SYMBOLS, SOUTHERN_MIRRORED } from '../src/marks/eventSymbols.ts';
import { tunables } from '../src/config/tunables.ts';
import { FAMILIES, PACES, TOKEN_INK, type Pace } from '../src/marks/families.ts';
import { GLYPH_UNITS } from '../src/marks/glyphs.ts';
import { EVENT_GLYPHS, type GlyphId } from '../src/marks/symbols.ts';

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    png: { type: 'string' },
    scale: { type: 'string', default: '1' },
  },
});
if (!values.out?.endsWith('.svg')) throw new Error('--out <file>.svg is required');
const scale = Number(values.scale);
if (!(scale >= 1 && scale <= 4)) throw new Error('--scale takes a device pixel ratio from 1 to 4');
const out = resolve(values.out);
const png = resolve(values.png ?? out.replace(/\.svg$/, '.png'));

/** The marks' sizes on the globe, smallest first. */
const MARK_SIZES = tunables.markPx.map((row) => row.px).sort((a, b) => a - b);
const SMALLEST = MARK_SIZES[0]!;
/** The width a family's cast token holds its glyph at on the smallest mark. */
const tokenGlyph = (pace: Pace) => FAMILIES[pace].variants[0].glyph.scale * SMALLEST;
/** How far from its center, in units, a family's cast token holds its glyphs (TOKEN_INK). */
const tokenReach = (pace: Pace) => {
  const { disc, glyph } = FAMILIES[pace].variants[0];
  return (TOKEN_INK * (disc?.radius ?? 0) * (GLYPH_UNITS / 2)) / glyph.scale;
};
const BIG = 128;
const PAD = 32;
const CARD = { width: 392, height: 184, gap: 16 };
const COLUMNS = 3;
const WIDTH = PAD * 2 + COLUMNS * CARD.width + (COLUMNS - 1) * CARD.gap;
const INK = '#241d16';
const BRASS = '#e3c486';
const TEXT = '#e8dcc5';
const FAINT = '#a08c6c';
const FONT = `'Source Serif 4', Georgia, serif`;

const classes = new Map<GlyphId, string[]>();
const family = new Map<GlyphId, Pace>();
for (const [name, { pace, glyph }] of Object.entries(EVENT_CLASS_SYMBOLS)) {
  classes.set(glyph, [...(classes.get(glyph) ?? []), name]);
  family.set(glyph, pace);
}
for (const id of SOUTHERN_MIRRORED) {
  classes.set(id, [...(classes.get(id) ?? []), 'mirrored south of the equator']);
}
const ids = Object.keys(EVENT_GLYPHS) as GlyphId[];

/** The sizes a glyph is shown at: on its family's smallest token, then the marks' sizes. */
function sizes(id: GlyphId): number[] {
  const pace = family.get(id);
  return [...(pace ? [tokenGlyph(pace)] : []), ...MARK_SIZES];
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A glyph `size` px wide with its top left at (x, y), mirrored east to west if asked. */
function glyph(
  id: GlyphId,
  x: number,
  y: number,
  size: number,
  fill: string,
  mirror = false,
): string {
  const k = size / GLYPH_UNITS;
  return `<path d="${EVENT_GLYPHS[id]}" fill="${fill}" transform="translate(${mirror ? x + size : x} ${y}) scale(${mirror ? -k : k} ${k})"/>`;
}

function text(x: number, y: number, body: string, size: number, fill: string, extra = ''): string {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" fill="${fill}" ${extra}>${escape(body)}</text>`;
}

/** Words set into lines of at most `width` characters. */
function lines(words: string[], width: number): string[] {
  const set: string[] = [];
  for (const word of words) {
    const last = set.at(-1);
    if (last !== undefined && last.length + word.length + 2 <= width)
      set[set.length - 1] = `${last}, ${word}`;
    else set.push(word);
  }
  return set;
}

/** One glyph's card: 128 px on its grid, its name and classes, and the globe's sizes. */
function card(id: GlyphId, x: number, y: number): string {
  const unit = BIG / GLYPH_UNITS;
  const box = BIG + 16;
  const pace = family.get(id);
  const parts = [
    `<rect x="${x}" y="${y}" width="${CARD.width}" height="${CARD.height}" rx="6" fill="#1d1812" stroke="#3a2f22"/>`,
    `<rect x="${x + 12}" y="${y + 20}" width="${box}" height="${box}" rx="4" fill="url(#bronze)"/>`,
    // The drawing rules: the 4-unit margin, and the circle its family's token holds it within.
    `<g fill="none" stroke="${INK}" stroke-opacity="0.22" stroke-width="1" stroke-dasharray="3 3">`,
    `<rect x="${x + 20 + 4 * unit}" y="${y + 28 + 4 * unit}" width="${56 * unit}" height="${56 * unit}"/>`,
    pace
      ? `<circle cx="${x + 20 + 32 * unit}" cy="${y + 28 + 32 * unit}" r="${tokenReach(pace) * unit}"/>`
      : '',
    '</g>',
    glyph(id, x + 20, y + 28, BIG, INK),
    text(
      x + 172,
      y + 36,
      id.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase(),
      13,
      BRASS,
      'letter-spacing="2.5"',
    ),
    ...lines(classes.get(id) ?? [], 30).map((line, i) =>
      text(x + 172, y + 56 + i * 15, line, 11.5, FAINT, 'font-style="italic"'),
    ),
  ];
  // The globe's sizes: dark on lit bronze, bright on the sea's lacquer.
  const row = (top: number, ground: string, fill: string) => {
    parts.push(
      `<rect x="${x + 168}" y="${top}" width="${CARD.width - 180}" height="36" rx="3" fill="${ground}"/>`,
    );
    // A storm's row ends on its southern form, mirrored, at the largest mark size.
    const southern = SOUTHERN_MIRRORED.includes(id);
    let left = x + 184;
    for (const size of sizes(id)) {
      parts.push(glyph(id, left, top + Math.round((36 - size) / 2), size, fill));
      left += size + (southern ? 28 : 40);
    }
    if (southern) {
      const size = MARK_SIZES.at(-1)!;
      parts.push(glyph(id, left, top + Math.round((36 - size) / 2), size, fill, true));
    }
  };
  row(y + 104, 'url(#bronze)', INK);
  row(y + 142, '#0f1512', BRASS);
  return parts.join('\n');
}

let y = PAD;
const body: string[] = [
  text(PAD, y + 22, 'EVENT GLYPHS', 20, BRASS, 'letter-spacing="4"'),
  text(
    PAD,
    y + 46,
    `One family per pace layer, drawn on a 64-unit grid. Marks are ${MARK_SIZES.join(', ')} px across, and ${tunables.markMinDevicePx} device px at least; a ${SMALLEST} px cast token holds its glyph at ${PACES.map((pace) => tokenGlyph(pace).toFixed(1)).join(', ')} px (${PACES.join(', ')}).`,
    13,
    FAINT,
  ),
];
y += 72;
for (const pace of PACES) {
  const members = ids.filter((id) => family.get(id) === pace);
  if (!members.length) continue;
  body.push(text(PAD, y + 16, pace.toUpperCase(), 14, TEXT, 'letter-spacing="3"'));
  y += 28;
  members.forEach((id, i) => {
    const column = i % COLUMNS;
    const top = y + Math.floor(i / COLUMNS) * (CARD.height + CARD.gap);
    body.push(card(id, PAD + column * (CARD.width + CARD.gap), top));
  });
  y += Math.ceil(members.length / COLUMNS) * (CARD.height + CARD.gap) + 12;
}
// Every glyph side by side at each size, as neighbours on the globe would be.
body.push(text(PAD, y + 16, 'SIDE BY SIDE', 14, TEXT, 'letter-spacing="3"'));
y += 28;
for (const [ground, fill] of [
  ['url(#bronze)', INK],
  ['#0f1512', BRASS],
] as const) {
  for (const [row, size] of ['token', ...MARK_SIZES].entries()) {
    // On the token row, a glyph no class takes yet has no token: its place stays empty.
    const at = (id: GlyphId) => {
      const pace = family.get(id);
      return row > 0 ? Number(size) : pace ? tokenGlyph(pace) : 0;
    };
    const step = Math.max(...ids.map(at)) + 14;
    const tallest = Math.max(...ids.map(at));
    body.push(
      `<rect x="${PAD}" y="${y}" width="${ids.length * step + 60}" height="${tallest + 16}" rx="3" fill="${ground}"/>`,
      text(PAD + 8, y + tallest / 2 + 12, `${size}`, 11, fill),
      ...ids
        .filter((id) => at(id) > 0)
        .map((id) =>
          glyph(
            id,
            PAD + 52 + ids.indexOf(id) * step + (tallest - at(id)) / 2,
            y + 8 + (tallest - at(id)) / 2,
            at(id),
            fill,
          ),
        ),
    );
    y += tallest + 16 + 8;
  }
}
// Every glyph on its family's cast token, the marks' default, flat: its disc and its glyph in
// their colors, at each mark size, on lit bronze.
body.push(text(PAD, y + 16, 'ON THE CAST TOKEN', 14, TEXT, 'letter-spacing="3"'));
y += 28;
for (const pace of PACES) {
  const { disc, glyph: face } = FAMILIES[pace].variants[0];
  const members = ids.filter((id) => family.get(id) === pace);
  const largest = MARK_SIZES.at(-1)!;
  const step = largest + 12;
  const height = MARK_SIZES.length * step + 12;
  body.push(
    `<rect x="${PAD}" y="${y}" width="${members.length * step * 1.4 + 120}" height="${height}" rx="3" fill="url(#bronze)"/>`,
    text(PAD + 8, y + 18, pace, 11, INK, 'font-style="italic"'),
  );
  MARK_SIZES.forEach((size, row) => {
    const cy = y + 6 + row * step + step / 2;
    body.push(text(PAD + 96, cy + 4, `${size}`, 11, INK));
    members.forEach((id, i) => {
      const cx = PAD + 130 + i * step * 1.4;
      const g = face.scale * size;
      body.push(
        `<circle cx="${cx}" cy="${cy}" r="${((disc?.radius ?? 1) * size) / 2}" fill="${disc?.color ?? 'none'}" stroke="${INK}" stroke-opacity="0.35" stroke-width="0.5"/>`,
        glyph(id, cx - g / 2, cy - g / 2, g, face.color),
      );
    });
  });
  y += height + 8;
}
const height = Math.ceil(y + PAD);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">
<defs><linearGradient id="bronze" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#c9a15c"/><stop offset="0.55" stop-color="#b08a4a"/><stop offset="1" stop-color="#8a6a36"/>
</linearGradient></defs>
<rect width="${WIDTH}" height="${height}" fill="#120f0b"/>
${body.join('\n')}
</svg>
`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, svg);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: WIDTH, height },
    deviceScaleFactor: scale,
  });
  await page.setContent(`<!doctype html><body style="margin:0;background:#120f0b">${svg}</body>`);
  mkdirSync(dirname(png), { recursive: true });
  await page.screenshot({ path: png, clip: { x: 0, y: 0, width: WIDTH, height } });
  // How much of its cell each glyph inks, filled as the atlas will fill it: families should
  // weigh about the same, and a path the canvas cannot parse inks little or nothing.
  const ink = await page.evaluate(
    ({ paths, grid }) => {
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      return Object.fromEntries(
        Object.entries(paths).map(([id, path]) => {
          ctx.clearRect(0, 0, size, size);
          ctx.setTransform(size / grid, 0, 0, size / grid, 0, 0);
          ctx.fill(new Path2D(path));
          const { data } = ctx.getImageData(0, 0, size, size);
          let sum = 0;
          for (let i = 3; i < data.length; i += 4) sum += data[i]!;
          return [id, sum / 255 / (size * size)];
        }),
      );
    },
    { paths: EVENT_GLYPHS, grid: GLYPH_UNITS },
  );
  for (const [id, share] of Object.entries(ink)) {
    const pace = family.get(id as GlyphId) ?? 'no class';
    console.log(`${pace.padEnd(15)} ${id.padEnd(14)} ink ${(share * 100).toFixed(0)}%`);
  }
} finally {
  await browser.close();
}
console.log(`wrote ${out}\nwrote ${png}`);
