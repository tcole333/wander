// A story's source (streaming.md 3.9: stories/<story>/story.md) read straight into the walk: front
// matter, then per beat an H2 title, a fenced YAML block tagged `beat`, and the beat's text. This
// is the walk's stand-in for `npm run stories` (issue #9): it parses and checks shapes, and dates
// become day numbers (dates.ts).
import { parse } from 'yaml';
import { dayFromIso, type Precision } from './dates';

export type LonLat = [lon: number, lat: number];

export interface StorySource {
  title: string;
  author: string;
  publisher?: string;
  year?: number | string | null;
  url: string;
}

export interface StoryImage {
  /** The Commons file title, 'File:...'. */
  commons: string;
  sha1: string;
  /** Fractions of the image: x0, y0, x1, y1. */
  crop: [number, number, number, number];
  alt: string;
}

export interface StoryCamera {
  target: LonLat;
  /** The visible width at the target, km. */
  viewKm: number;
  /** Degrees from nadir. */
  tilt: number;
  /** Degrees clockwise from north. */
  heading: number;
  drift: 'none' | 'slow';
}

/** Effects, their dates as day numbers. The spread datasets are named, not yet built. */
export type StoryEffect =
  | {
      kind: 'plume';
      at: LonLat;
      start: number;
      peak: number;
      end: number;
      heightKm: number;
      /** A direction, east and north. */
      drift: [number, number];
      seed: number;
    }
  | { kind: 'pulse'; at: LonLat; start: number; end: number; radiusKm: number; style: string }
  | { kind: 'callout'; at: LonLat; text: string }
  | { kind: 'spread'; dataset: string; wDays: number; style: string };

export interface StoryBeat {
  id: string;
  title: string;
  /** The beat's date as a day number, and its window when it spans time. */
  day: number;
  window?: [number, number];
  precision: Precision;
  camera: StoryCamera;
  focal: { qid: string; at?: LonLat; day?: number };
  image?: StoryImage;
  /** The layers on, in the canonical order; `climate` carries its mode separately. */
  layers: string[];
  climate?: 'monthly' | 'annual';
  effects: StoryEffect[];
  audioCues: string[];
  sources: StorySource[];
  /** The text's paragraphs, plain text. */
  paragraphs: string[];
}

export interface Story {
  id: string;
  title: string;
  blurb: string;
  credits: string[];
  beats: StoryBeat[];
}

export class StoryError extends Error {
  override name = 'StoryError';
}

export function parseStory(markdown: string): Story {
  const front = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  if (!front?.[1]) throw new StoryError('story.md must open with YAML front matter');
  const meta = record(parse(front[1]), 'front matter');
  const body = markdown.slice(front[0].length);
  const sections = body.split(/^## /m).slice(1);
  if (sections.length === 0) throw new StoryError('story.md has no beats (## headings)');
  return {
    id: text(meta.id, 'id'),
    title: text(meta.title, 'title'),
    blurb: text(meta.blurb, 'blurb'),
    credits: list(meta.credits ?? [], 'credits').map((c) => text(c, 'credit')),
    beats: sections.map(parseBeat),
  };
}

function parseBeat(section: string): StoryBeat {
  const newline = section.indexOf('\n');
  const title = section.slice(0, newline).trim();
  const block = /```beat\n([\s\S]*?)\n```/.exec(section);
  if (!block?.[1]) throw new StoryError(`beat '${title}' has no \`\`\`beat block`);
  const b = record(parse(block[1]), `beat '${title}'`);
  const id = text(b.id, `beat '${title}' id`);
  const where = `beat '${id}'`;
  const prose = section.slice(block.index + block[0].length);
  const paragraphs = prose
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter((p) => p.length > 0);

  const windowText = b.window === undefined ? undefined : text(b.window, `${where} window`);
  const window = windowText?.split('..').map((d) => dayFromIso(d));
  const camera = record(b.camera, `${where} camera`);
  const focal = record(b.focal, `${where} focal`);
  let climate: StoryBeat['climate'];
  const layers = list(b.layers ?? [], `${where} layers`).map((entry) => {
    if (typeof entry === 'string') return entry;
    const mode = record(record(entry, `${where} layer`).climate, `${where} climate`).mode;
    climate = mode === 'annual' ? 'annual' : 'monthly';
    return 'climate';
  });
  const audio = b.audio === undefined ? {} : record(b.audio, `${where} audio`);
  return {
    id,
    title,
    day: dayFromIso(text(b.date, `${where} date`)),
    window: window?.length === 2 ? [window[0] ?? NaN, window[1] ?? NaN] : undefined,
    precision: b.precision === 'month' || b.precision === 'year' ? b.precision : 'day',
    camera: {
      target: lonLat(camera.target, `${where} camera target`),
      viewKm: num(camera.viewKm, `${where} viewKm`),
      tilt: num(camera.tilt ?? 0, `${where} tilt`),
      heading: num(camera.heading ?? 0, `${where} heading`),
      drift: camera.drift === 'slow' ? 'slow' : 'none',
    },
    focal: {
      qid: text(focal.qid, `${where} focal qid`),
      at: focal.at === undefined ? undefined : lonLat(focal.at, `${where} focal at`),
      day: focal.date === undefined ? undefined : dayFromIso(text(focal.date, `${where} focal`)),
    },
    image: b.image === undefined ? undefined : parseImage(record(b.image, `${where} image`), where),
    layers,
    climate,
    effects: list(b.effects ?? [], `${where} effects`).map((e) => parseEffect(e, where)),
    audioCues: list(audio.cues ?? [], `${where} audio cues`).map((c) => text(c, 'cue')),
    sources: list(b.sources ?? [], `${where} sources`).map((s) => parseSource(s, where)),
    paragraphs,
  };
}

function parseImage(image: Record<string, unknown>, where: string): StoryImage {
  const crop = list(image.crop ?? [0, 0, 1, 1], `${where} crop`).map((c) => num(c, 'crop'));
  if (crop.length !== 4) throw new StoryError(`${where} crop needs four numbers`);
  return {
    commons: text(image.commons, `${where} image commons`),
    sha1: text(image.sha1 ?? '', `${where} image sha1`),
    crop: [crop[0] ?? 0, crop[1] ?? 0, crop[2] ?? 1, crop[3] ?? 1],
    alt: text(image.alt ?? '', `${where} image alt`),
  };
}

function parseEffect(entry: unknown, where: string): StoryEffect {
  const e = record(entry, `${where} effect`);
  const [kind] = Object.keys(e);
  const p = record(e[kind ?? ''], `${where} ${kind} effect`);
  const day = (key: string) => dayFromIso(text(p[key], `${where} ${kind} ${key}`));
  switch (kind) {
    case 'plume': {
      const drift = list(p.drift ?? [0, 0], 'drift').map((d) => num(d, 'drift'));
      return {
        kind,
        at: lonLat(p.at, `${where} plume at`),
        start: day('start'),
        peak: day('peak'),
        end: day('end'),
        heightKm: num(p.heightKm, 'heightKm'),
        drift: [drift[0] ?? 0, drift[1] ?? 0],
        seed: num(p.seed ?? 0, 'seed'),
      };
    }
    case 'pulse':
      return {
        kind,
        at: lonLat(p.at, `${where} pulse at`),
        start: day('start'),
        end: day('end'),
        radiusKm: num(p.radiusKm, 'radiusKm'),
        style: text(p.style ?? 'pulse', 'style'),
      };
    case 'callout':
      return { kind, at: lonLat(p.at, `${where} callout at`), text: text(p.text, 'callout text') };
    case 'spread':
      return {
        kind,
        dataset: text(p.dataset, 'dataset'),
        wDays: num(p.wDays ?? 1, 'wDays'),
        style: text(p.style ?? 'spread', 'style'),
      };
    default:
      throw new StoryError(`${where}: unknown effect '${String(kind)}'`);
  }
}

function parseSource(entry: unknown, where: string): StorySource {
  const s = record(entry, `${where} source`);
  const year = s.year;
  return {
    title: text(s.title, `${where} source title`),
    author: text(s.author ?? '', `${where} source author`),
    publisher: s.publisher === undefined ? undefined : text(s.publisher, 'publisher'),
    year: typeof year === 'number' || typeof year === 'string' ? year : null,
    url: text(s.url, `${where} source url`),
  };
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new StoryError(`${where} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

function list(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) throw new StoryError(`${where} must be a list`);
  return value;
}

function text(value: unknown, where: string): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  throw new StoryError(`${where} must be text`);
}

function num(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new StoryError(`${where} must be a number`);
  }
  return value;
}

function lonLat(value: unknown, where: string): LonLat {
  const pair = list(value, where);
  if (pair.length !== 2) throw new StoryError(`${where} must be [lon, lat]`);
  return [num(pair[0], `${where} lon`), num(pair[1], `${where} lat`)];
}
