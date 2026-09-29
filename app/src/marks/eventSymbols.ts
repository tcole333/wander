// The pace layer and glyph each class of the event index takes (pipeline/config/event-classes.yaml;
// docs/design/globe-language.md, "Speeds and pace layers": an event belongs to the pace layer it
// jolts). An event has one class, the heaviest it was exported under, and the overview .wev names
// the classes its rows index (events/page.ts). Nature takes the disasters, epidemics and drought;
// governance the wars, battles, sieges, treaties, uprisings, famines, assassinations and
// atrocities, with one glyph for every atrocity; infrastructure the shipwrecks, expeditions and
// conflagrations. A glyph belongs to one family, so every class that shares a glyph shares its
// pace layer. A storm's glyph turns with its hemisphere, so an event's glyph goes through glyphAt
// with its latitude.
import type { Pace } from './families';
import type { GlyphId } from './symbols';

/** An event's mark: the pace layer it belongs to and its glyph. */
export interface EventSymbol {
  pace: Pace;
  glyph: GlyphId;
}

/** Each class's mark, by the class's name in event-classes.yaml. */
export const EVENT_CLASS_SYMBOLS = {
  war: { pace: 'governance', glyph: 'war' },
  pandemic: { pace: 'nature', glyph: 'plague' },
  revolution: { pace: 'governance', glyph: 'uprising' },
  'military campaign': { pace: 'governance', glyph: 'war' },
  'natural disaster': { pace: 'nature', glyph: 'disaster' },
  epidemic: { pace: 'nature', glyph: 'plague' },
  famine: { pace: 'governance', glyph: 'famine' },
  treaty: { pace: 'governance', glyph: 'treaty' },
  'volcanic eruption': { pace: 'nature', glyph: 'eruption' },
  earthquake: { pace: 'nature', glyph: 'quake' },
  assassination: { pace: 'governance', glyph: 'assassination' },
  coup: { pace: 'governance', glyph: 'uprising' },
  massacre: { pace: 'governance', glyph: 'atrocity' },
  battle: { pace: 'governance', glyph: 'battle' },
  siege: { pace: 'governance', glyph: 'siege' },
  expedition: { pace: 'infrastructure', glyph: 'expedition' },
  riot: { pace: 'governance', glyph: 'uprising' },
  conflagration: { pace: 'infrastructure', glyph: 'conflagration' },
  genocide: { pace: 'governance', glyph: 'atrocity' },
  'declaration of independence': { pace: 'governance', glyph: 'treaty' },
  invasion: { pace: 'governance', glyph: 'war' },
  'peace conference': { pace: 'governance', glyph: 'treaty' },
  rebellion: { pace: 'governance', glyph: 'uprising' },
  conquest: { pace: 'governance', glyph: 'war' },
  drought: { pace: 'nature', glyph: 'heat' },
  tsunami: { pace: 'nature', glyph: 'flood' },
  flood: { pace: 'nature', glyph: 'flood' },
  'tropical cyclone': { pace: 'nature', glyph: 'cyclone' },
  pogrom: { pace: 'governance', glyph: 'atrocity' },
  mutiny: { pace: 'governance', glyph: 'uprising' },
  storm: { pace: 'nature', glyph: 'cyclone' },
  'cold wave': { pace: 'nature', glyph: 'cold' },
  'heat wave': { pace: 'nature', glyph: 'heat' },
  landslide: { pace: 'nature', glyph: 'slide' },
  shipwreck: { pace: 'infrastructure', glyph: 'wreck' },
  'maritime disaster': { pace: 'infrastructure', glyph: 'wreck' },
  avalanche: { pace: 'nature', glyph: 'slide' },
  tornado: { pace: 'nature', glyph: 'cyclone' },
  wildfire: { pace: 'nature', glyph: 'fire' },
} as const satisfies Record<string, EventSymbol>;

/** The mark for a class, or undefined for a class event-classes.yaml does not list. */
export function eventSymbol(cls: string): EventSymbol | undefined {
  return Object.hasOwn(EVENT_CLASS_SYMBOLS, cls)
    ? EVENT_CLASS_SYMBOLS[cls as keyof typeof EVENT_CLASS_SYMBOLS]
    : undefined;
}

/** The marks for a .wev's class list, by the class index its rows carry. */
export function eventSymbols(classes: readonly string[]): (EventSymbol | undefined)[] {
  return classes.map(eventSymbol);
}

/** The glyphs that turn with the hemisphere, and the form each takes south of the equator. */
export const SOUTHERN_GLYPHS = {
  cyclone: 'cycloneSouth',
} as const satisfies Partial<Record<GlyphId, GlyphId>>;

/** The glyph drawn for an event at latitude `lat`: storms south of the equator turn the other way. */
export function glyphAt(glyph: GlyphId, lat: number): GlyphId {
  return lat < 0 && Object.hasOwn(SOUTHERN_GLYPHS, glyph)
    ? SOUTHERN_GLYPHS[glyph as keyof typeof SOUTHERN_GLYPHS]
    : glyph;
}
