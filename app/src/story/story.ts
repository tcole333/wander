// A story's source (streaming.md 3.9: stories/<story>/story.md) read straight into the walk: front
// matter, then per beat an H2 title, a fenced YAML block tagged `beat`, and the beat's text. This
// is the walk's stand-in for `npm run stories` (issue #9) and holds the story schema: it rejects a
// key the schema does not name, a layer shared/constants.json does not list and a precision other
// than day, month or year, and it needs every beat to have a window holding its date, an image
// with alt text and a source with an https link. Dates become day numbers (dates.ts).
import constants from '@shared/constants.json' with { type: 'json' };
import { parse } from 'yaml';
import { dayFromIso, type Precision } from './dates';
import type { LockedImage } from './lock';

/** The layers a beat may name, in the canonical order, which is also the `?l=` bit order. */
const LAYERS: readonly string[] = constants.layers;
const PRECISIONS = ['day', 'month', 'year'] as const;
const DRIFTS = ['none', 'slow'] as const;
const CLIMATE_MODES = ['monthly', 'annual'] as const;
const BEAT_KEYS = [
  'id',
  'date',
  'precision',
  'window',
  'camera',
  'focal',
  'image',
  'layers',
  'effects',
  'audio',
  'meanwhile',
  'sources',
];

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
  /** The baked crop on the data host and its credit, from the story's lock (lock.ts). */
  locked?: LockedImage;
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
  /** The beat's date as a day number, and the window of time around it, which holds it. */
  day: number;
  window: [number, number];
  precision: Precision;
  camera: StoryCamera;
  focal: { qid: string; at?: LonLat; day?: number };
  image: StoryImage;
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
  const beats = sections.map(parseBeat);
  const ids = beats.map((beat) => beat.id);
  const repeated = ids.find((id, i) => ids.indexOf(id) !== i);
  if (repeated !== undefined) throw new StoryError(`two beats have the id '${repeated}'`);
  return {
    id: text(meta.id, 'id'),
    title: text(meta.title, 'title'),
    blurb: text(meta.blurb, 'blurb'),
    credits: list(meta.credits ?? [], 'credits').map((c) => text(c, 'credit')),
    beats,
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
  known(b, BEAT_KEYS, where);
  const prose = section.slice(block.index + block[0].length);
  const paragraphs = prose
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter((p) => p.length > 0);

  const day = isoDay(b.date, `${where} date`);
  const window = parseWindow(b.window, where);
  if (day < window[0] || day > window[1]) {
    throw new StoryError(`${where} date falls outside its window`);
  }
  const camera = record(b.camera, `${where} camera`);
  known(camera, ['target', 'viewKm', 'tilt', 'heading', 'drift'], `${where} camera`);
  const focal = record(b.focal, `${where} focal`);
  known(focal, ['qid', 'at', 'date'], `${where} focal`);
  const audio = b.audio === undefined ? {} : record(b.audio, `${where} audio`);
  known(audio, ['cues'], `${where} audio`);
  checkMeanwhile(b.meanwhile, where);
  const sources = list(b.sources, `${where} sources`).map((s) => parseSource(s, where));
  if (!sources.some((source) => /^https:\/\/\S+$/.test(source.url))) {
    throw new StoryError(`${where} needs a source with an https link`);
  }
  return {
    id,
    title,
    day,
    window,
    precision:
      b.precision === undefined ? 'day' : oneOf(b.precision, PRECISIONS, `${where} precision`),
    camera: {
      target: lonLat(camera.target, `${where} camera target`),
      viewKm: num(camera.viewKm, `${where} viewKm`),
      tilt: num(camera.tilt ?? 0, `${where} tilt`),
      heading: num(camera.heading ?? 0, `${where} heading`),
      drift: oneOf(camera.drift ?? 'none', DRIFTS, `${where} camera drift`),
    },
    focal: {
      qid: text(focal.qid, `${where} focal qid`),
      at: focal.at === undefined ? undefined : lonLat(focal.at, `${where} focal at`),
      day: focal.date === undefined ? undefined : isoDay(focal.date, `${where} focal date`),
    },
    image: parseImage(record(b.image, `${where} image`), where),
    ...parseLayers(b.layers, where),
    effects: list(b.effects ?? [], `${where} effects`).map((e) => parseEffect(e, where)),
    audioCues: list(audio.cues ?? [], `${where} audio cues`).map((c) => text(c, 'cue')),
    sources,
    paragraphs,
  };
}

/** `<start>..<end>`, two ISO dates in order, as day numbers. */
function parseWindow(value: unknown, where: string): [number, number] {
  const [start, end, ...more] = text(value, `${where} window`).split('..');
  if (start === undefined || end === undefined || more.length > 0) {
    throw new StoryError(`${where} window must be <start>..<end>`);
  }
  const window: [number, number] = [
    isoDay(start, `${where} window`),
    isoDay(end, `${where} window`),
  ];
  if (window[1] < window[0]) throw new StoryError(`${where} window ends before it starts`);
  return window;
}

/**
 * The layers on, each one shared/constants.json lists, in its order; `climate` may carry its mode
 * as `{climate: {mode: monthly | annual}}`.
 */
function parseLayers(value: unknown, where: string): Pick<StoryBeat, 'layers' | 'climate'> {
  let climate: StoryBeat['climate'];
  const named = list(value ?? [], `${where} layers`).map((entry) => {
    if (typeof entry === 'string') {
      if (!LAYERS.includes(entry)) throw new StoryError(`${where}: unknown layer '${entry}'`);
      return entry;
    }
    const layer = record(entry, `${where} layer`);
    known(layer, ['climate'], `${where} layer`);
    const mode = record(layer.climate, `${where} climate`);
    known(mode, ['mode'], `${where} climate`);
    climate = oneOf(mode.mode, CLIMATE_MODES, `${where} climate mode`);
    return 'climate';
  });
  const repeated = named.find((layer, i) => named.indexOf(layer) !== i);
  if (repeated !== undefined) throw new StoryError(`${where} names the layer '${repeated}' twice`);
  return { layers: LAYERS.filter((layer) => named.includes(layer)), climate };
}

/**
 * Meanwhile's list for the beat: `auto`, or the entries it pins and hides. Read loosely here, as
 * the walk still takes its entries from meanwhile.<story>.json.
 */
function checkMeanwhile(value: unknown, where: string): void {
  if (value === undefined || value === 'auto' || Array.isArray(value)) return;
  if (typeof value !== 'object' || value === null) {
    throw new StoryError(`${where} meanwhile must be auto, or lists to pin and hide`);
  }
  const lists = value as Record<string, unknown>;
  known(lists, ['pin', 'hide'], `${where} meanwhile`);
  for (const key of ['pin', 'hide']) list(lists[key] ?? [], `${where} meanwhile ${key}`);
}

function parseImage(image: Record<string, unknown>, where: string): StoryImage {
  known(image, ['commons', 'sha1', 'crop', 'alt', 'credit', 'license'], `${where} image`);
  const alt = text(image.alt, `${where} image alt`).trim();
  if (alt === '') throw new StoryError(`${where} image needs alt text`);
  const crop = list(image.crop ?? [0, 0, 1, 1], `${where} crop`).map((c) => num(c, 'crop'));
  if (crop.length !== 4) throw new StoryError(`${where} crop needs four numbers`);
  return {
    commons: text(image.commons, `${where} image commons`),
    sha1: text(image.sha1 ?? '', `${where} image sha1`),
    crop: [crop[0] ?? 0, crop[1] ?? 0, crop[2] ?? 1, crop[3] ?? 1],
    alt,
  };
}

function parseEffect(entry: unknown, where: string): StoryEffect {
  const e = record(entry, `${where} effect`);
  const [kind, ...more] = Object.keys(e);
  if (more.length > 0) throw new StoryError(`${where}: an effect names one kind`);
  const p = record(e[kind ?? ''], `${where} ${kind} effect`);
  const day = (key: string) => isoDay(p[key], `${where} ${kind} ${key}`);
  const keys = (...names: string[]) => known(p, names, `${where} ${kind}`);
  switch (kind) {
    case 'plume': {
      keys('at', 'start', 'peak', 'end', 'heightKm', 'drift', 'seed');
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
      keys('at', 'start', 'end', 'radiusKm', 'style');
      return {
        kind,
        at: lonLat(p.at, `${where} pulse at`),
        start: day('start'),
        end: day('end'),
        radiusKm: num(p.radiusKm, 'radiusKm'),
        style: text(p.style ?? 'pulse', 'style'),
      };
    case 'callout':
      keys('at', 'text');
      return { kind, at: lonLat(p.at, `${where} callout at`), text: text(p.text, 'callout text') };
    case 'spread':
      keys('dataset', 'wDays', 'style');
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
  known(s, ['title', 'author', 'publisher', 'year', 'url'], `${where} source`);
  const year = s.year;
  return {
    title: text(s.title, `${where} source title`),
    author: text(s.author ?? '', `${where} source author`),
    publisher: s.publisher === undefined ? undefined : text(s.publisher, 'publisher'),
    year: typeof year === 'number' || typeof year === 'string' ? year : null,
    url: text(s.url, `${where} source url`),
  };
}

/** Throws on a key outside `keys`, so a misspelled field fails rather than falling back. */
function known(value: Record<string, unknown>, keys: readonly string[], where: string): void {
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown !== undefined) throw new StoryError(`${where}: unknown key '${unknown}'`);
}

function oneOf<T extends string>(value: unknown, choices: readonly T[], where: string): T {
  const choice = choices.find((c) => c === value);
  if (choice === undefined) throw new StoryError(`${where} must be one of ${choices.join(', ')}`);
  return choice;
}

/** An ISO date (dates.ts) as a day number. */
function isoDay(value: unknown, where: string): number {
  const iso = text(value, where);
  try {
    return dayFromIso(iso);
  } catch {
    throw new StoryError(`${where} must be an ISO date, not '${iso}'`);
  }
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
