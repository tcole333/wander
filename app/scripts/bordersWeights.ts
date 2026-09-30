// The outer line's weights side by side (#80; BORDER_WEIGHTS in look/bordersHook.ts) on this
// Mac's GPU, for the owner to choose among. For each weight, scripts/bordersShots.ts renders the
// Old World and the Americas at world view and 17,500 km across in 1000, 1500, 1800 and 1914, and
// Europe at 6,000 km in 1500 and 1914, where every weight draws today's line, into
// <out>/<weight>/, with the film grain off, so the renders differ only where the lines do. Then
// this lays them out, a row per view and year and a column per weight: <out>/weight.png, the world
// views' globes and the rest at half size, and <out>/weight-crops.png, a part of each render where
// borders run, its centre or South America, at twice its size, pixel for pixel. <out>/weight.json gives, for each weight, the share of Europe's
// pixels that differ from today's render and by how much at most. Plain Node, run from app/ with
// the Vite dev server and a global data server up:
//
//   node scripts/bordersWeights.ts --url http://127.0.0.1:5173 --data http://127.0.0.1:8793
//     [--out ../build/borders/renders/weight] [--weights today,wide,solid,eased] [--sheets-only]
import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:5173' },
    data: { type: 'string', default: 'http://127.0.0.1:8793' },
    out: { type: 'string', default: '../build/borders/renders/weight' },
    // BORDER_WEIGHTS' names, today's first (look/bordersHook.ts, which Node cannot import).
    weights: { type: 'string', default: 'today,wide,solid,eased' },
    'sheets-only': { type: 'boolean', default: false },
  },
});
const out = resolve(values.out);
mkdirSync(out, { recursive: true });

const WEIGHTS = values.weights.split(',');
/** What each weight does, for the sheets' heads (BORDER_WEIGHTS). */
const SAID: Record<string, string> = {
  today: '2 px, darkening 0.75, dots 2.7 of every 5 px, at every width',
  wide: '3 px, darkening 0.9, dots 3.5 of 5 px, soft edges with it; full from 10,000 km',
  solid: 'hard lines unbroken, 2.5 px, darkening 0.9; soft edges as today’s; full from 10,000 km',
  eased: 'growing with the view’s width to 3.5 px, darkening 0.95, dots 4.5 of 5 px at world view',
};
const YEARS = [1000, 1500, 1800, 1914];

interface View {
  name: string;
  lon: number;
  lat: number;
  /** Km across; 0 is the widest view. */
  km: number;
  title: string;
  years: number[];
  /** Where the crops at twice the size centre, in the render's pixels. */
  focus: [number, number];
}

const framing = (
  name: string,
  lon: number,
  lat: number,
  km: number,
  title: string,
  { years = YEARS, focus = [720, 450] }: { years?: number[]; focus?: [number, number] } = {},
) => ({ name, lon, lat, km, title, years, focus }) satisfies View;

const VIEWS: View[] = [
  framing('oldworld-world', 40, 20, 0, 'The Old World, world view'),
  framing('oldworld', 40, 20, 17500, 'The Old World, 17,500 km'),
  // The Americas' crops centre on South America, east of the view's centre.
  framing('americas-world', -75, 0, 0, 'The Americas, world view', { focus: [840, 500] }),
  framing('americas', -75, 0, 17500, 'The Americas, 17,500 km', { focus: [930, 480] }),
  framing('europe-6000', 15, 48, 6000, 'Europe, 6,000 km', { years: [1500, 1914] }),
];

const shotPath = (weight: string, view: string, year: number) =>
  join(out, weight, 'shots', `${view}-${year}.png`);

if (!values['sheets-only']) {
  for (const weight of WEIGHTS) {
    const args = [
      'scripts/bordersShots.ts',
      ...['--url', values.url, '--data', values.data, '--out', join(out, weight)],
      ...['--param', `borderWeight=${weight}`, '--param', 'grain=0', '--only', 'views'],
      ...VIEWS.flatMap((v) => [
        '--view',
        `${v.name}=${v.lon}:${v.lat}:${v.km}@${v.years.join('+')}`,
      ]),
    ];
    const run = spawnSync(process.execPath, args, { stdio: 'inherit' });
    if (run.status !== 0) throw new Error(`bordersShots.ts for ${weight} failed`);
  }
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const png = (path: string) => `data:image/png;base64,${readFileSync(path).toString('base64')}`;

  // Europe at 6,000 km, where every weight draws today's line: the share of pixels that differ.
  const unchanged: Record<string, Record<string, { differ: number; most: number }>> = {};
  const europe = VIEWS.find((v) => v.name === 'europe-6000') as View;
  for (const weight of WEIGHTS.filter((w) => w !== 'today')) {
    for (const year of europe.years) {
      const [a, b] = [shotPath('today', europe.name, year), shotPath(weight, europe.name, year)];
      if (!existsSync(a) || !existsSync(b)) continue;
      (unchanged[weight] ??= {})[String(year)] = await page.evaluate(
        async ([srcA, srcB]) => {
          const pixels = async (src: string) => {
            const img = new Image();
            img.src = src;
            await img.decode();
            const canvas = new OffscreenCanvas(img.width, img.height);
            const context = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
            context.drawImage(img, 0, 0);
            return context.getImageData(0, 0, img.width, img.height).data;
          };
          const [pa, pb] = await Promise.all([pixels(srcA!), pixels(srcB!)]);
          let differ = 0;
          let most = 0;
          for (let i = 0; i < pa.length; i += 4) {
            let d = 0;
            for (let c = 0; c < 3; c += 1) d = Math.max(d, Math.abs(pa[i + c]! - pb[i + c]!));
            if (d > 0) differ += 1;
            most = Math.max(most, d);
          }
          return { differ: differ / (pa.length / 4), most };
        },
        [png(a), png(b)],
      );
    }
  }
  writeFileSync(join(out, 'weight.json'), JSON.stringify({ unchanged }, null, 2));

  const style = `<style>
    body { margin: 0; padding: 20px; background: #120c07; color: #d9c7a3;
      font: 15px Georgia, serif; width: max-content; }
    h1 { font-weight: normal; font-size: 24px; margin: 0 0 6px; }
    p { margin: 0 0 14px; font-size: 15px; opacity: 0.85; max-width: 2900px; }
    .row { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 12px; }
    .label { width: 150px; font-size: 18px; padding-top: 4px; }
    .head .cell { height: auto; font-size: 20px; }
    figure { margin: 0; }
    .cell { width: 720px; height: 450px; overflow: hidden; position: relative; }
    .cell img { position: absolute; }
    img.half { width: 720px; height: 450px; left: 0; top: 0; }
    img.centre { left: -360px; top: -225px; }
    img.double { width: 2880px; height: 1800px; image-rendering: pixelated; }
  </style>`;
  const header = `<div class="row head"><div class="label"></div>${WEIGHTS.map(
    (w) => `<div class="cell"><b>${w}</b><br>${SAID[w] ?? ''}</div>`,
  ).join('')}</div>`;
  const sheets = [
    {
      file: 'weight.png',
      title: 'The outer line’s weights',
      note:
        'World views show the globe at full size, 17,500 and 6,000 km at half size, ' +
        'all with the film grain off.',
      fit: (view: View) => (view.km === 0 ? 'centre' : 'half'),
    },
    {
      file: 'weight-crops.png',
      title: 'The outer line’s weights at twice the size',
      note:
        'A part of each render, 360 by 225 px, its centre or South America, at twice its size, ' +
        'pixel for pixel.',
      fit: () => 'double',
    },
  ];
  for (const { file, title, note, fit } of sheets) {
    const rows = VIEWS.flatMap((view) =>
      view.years.map((year) => {
        const cells = WEIGHTS.map((weight) => {
          const path = shotPath(weight, view.name, year);
          if (!existsSync(path)) return `<figure><div class="cell">not rendered</div></figure>`;
          const [x, y] = view.focus;
          const at = fit(view) === 'double' ? `left: ${360 - 2 * x}px; top: ${225 - 2 * y}px` : '';
          return `<figure><div class="cell"><img class="${fit(view)}" style="${at}" src="${png(path)}"></div></figure>`;
        });
        return `<div class="row"><div class="label">${view.title}<br>${year}</div>${cells.join('')}</div>`;
      }),
    );
    await page.setContent(
      `<!doctype html><html><head>${style}</head><body><h1>${title}</h1>
      <p>${note} Every weight draws today's line at 6,000 km across and closer.</p>
      ${header}${rows.join('')}</body></html>`,
    );
    await page.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
    await page.screenshot({ path: join(out, file), fullPage: true });
    console.log(join(out, file));
  }
} finally {
  await browser.close();
}
