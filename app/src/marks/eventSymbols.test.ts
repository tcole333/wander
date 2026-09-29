import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { EVENT_CLASS_SYMBOLS, eventSymbol, eventSymbols } from './eventSymbols';
import { EVENT_GLYPHS, PACE_LAYERS, type GlyphId, type Pace } from './symbols';

const config = parse(
  readFileSync(new URL('../../../pipeline/config/event-classes.yaml', import.meta.url), 'utf8'),
) as { classes: { name: string }[] };
const classNames = config.classes.map((c) => c.name);

describe('event symbols', () => {
  it('give every class in event-classes.yaml a pace layer and a glyph', () => {
    const missing = classNames.filter((name) => {
      const symbol = eventSymbol(name);
      return !symbol || !PACE_LAYERS.includes(symbol.pace) || !(symbol.glyph in EVENT_GLYPHS);
    });
    expect(missing).toEqual([]);
  });

  it('name no class that event-classes.yaml lacks', () => {
    const stale = Object.keys(EVENT_CLASS_SYMBOLS).filter((name) => !classNames.includes(name));
    expect(stale).toEqual([]);
  });

  it('keep each glyph in one family, and draw no glyph that no class takes', () => {
    const families = new Map<GlyphId, Set<Pace>>();
    for (const { glyph, pace } of Object.values(EVENT_CLASS_SYMBOLS)) {
      families.set(glyph, (families.get(glyph) ?? new Set()).add(pace));
    }
    const glyphs = Object.keys(EVENT_GLYPHS) as GlyphId[];
    expect(glyphs.filter((glyph) => families.get(glyph)?.size !== 1)).toEqual([]);
  });

  it('follow a .wev class list by index, leaving unknown classes unmarked', () => {
    expect(eventSymbols(['battle', 'sporting season', 'famine'])).toEqual([
      { pace: 'governance', glyph: 'battle' },
      undefined,
      { pace: 'nature', glyph: 'famine' },
    ]);
    expect(eventSymbol('toString')).toBeUndefined();
  });
});
