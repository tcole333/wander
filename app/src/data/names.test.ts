// The state names' chunks (streaming.md 3.3, Names) as the fixture's names stage writes them for its
// two border steps: decoded into typed columns, each placement over a run of the chunk's steps.
import { describe, expect, test } from 'vitest';
import { readFixtureFile, readStageRecord } from '../test/fixture';
import {
  decodeNamesChunk,
  NAME_FLAG,
  NAMES_FIELDS,
  namesChunk,
  namesChunkOf,
  placementsAt,
  type NamesChunk,
} from './names';
import type { BorderStepsRelease, NamesRelease } from './release';

const record = readStageRecord<{ names: NamesRelease }>('names');
const steps = readStageRecord<{ steps: BorderStepsRelease }>('borders').steps;

async function fixtureChunk(): Promise<NamesChunk> {
  const stored = readFixtureFile(record.names.keys[0]!);
  return decodeNamesChunk(
    stored.buffer.slice(stored.byteOffset, stored.byteOffset + stored.length),
  );
}

describe("the fixture's names", () => {
  test('are placed on its border steps, in one chunk of both', async () => {
    expect(record.names.steps).toBe(steps.ver);
    expect(record.names.keys).toHaveLength(1);
    const chunk = await fixtureChunk();
    expect(chunk.first).toBe(0);
    expect(chunk.years).toEqual(steps.years);
    expect(chunk.count).toBe(record.names.placements);
  });

  test('stand where they can be drawn: a name, steps inside the chunk, and letters', async () => {
    const chunk = await fixtureChunk();
    for (let k = 0; k < chunk.count; k++) {
      expect(chunk.name[k]).toBeLessThan(chunk.full.length);
      expect(chunk.s0[k]).toBeLessThanOrEqual(chunk.s1[k]!);
      expect(chunk.s1[k]).toBeLessThan(chunk.years.length);
      expect(chunk.em[k]).toBeGreaterThan(0);
      expect(chunk.span[k]).toBeGreaterThan(0);
      expect(Math.abs(chunk.lat[k]!)).toBeLessThanOrEqual(90);
      expect(chunk.flags[k]! >> NAME_FLAG.levelShift).toBeLessThanOrEqual(3);
    }
  });

  test('draw a short name far where it differs from the full one', async () => {
    const chunk = await fixtureChunk();
    const shortened = chunk.full.findIndex((full, k) => full !== chunk.short[k]);
    expect(shortened).toBeGreaterThanOrEqual(0);
    const forms = new Set<number>();
    for (let k = 0; k < chunk.count; k++) {
      if (chunk.name[k] === shortened) forms.add(chunk.flags[k]! & NAME_FLAG.short);
    }
    expect(forms).toContain(NAME_FLAG.short);
  });

  test('hold at each step the placements whose run holds it', async () => {
    const chunk = await fixtureChunk();
    for (const index of [0, 1]) {
      const held = placementsAt(chunk, index);
      expect(held.length).toBeGreaterThan(0);
      for (const k of held) expect(chunk.s0[k]! <= index && index <= chunk.s1[k]!).toBe(true);
    }
    expect(namesChunkOf(record.names, 17)).toEqual({ chunk: 1, index: 1 });
  });
});

describe('a chunk document', () => {
  const doc = {
    version: 1,
    first: 16,
    years: [1900, 1901],
    fields: [...NAMES_FIELDS],
    names: [['Kingdom of Bavaria', 'Bavaria']] as [string, string][],
    place: [0, 0, 1, 1150, 4850, -125, 4321, 5678, 70500, NAME_FLAG.short, 0],
  };

  test('decodes its fixed-point fields to degrees', () => {
    const chunk = namesChunk(doc);
    expect([chunk.lon[0], chunk.lat[0], chunk.angle[0]]).toEqual([11.5, 48.5, -12.5]);
    expect(chunk.em[0]).toBeCloseTo(0.4321, 5);
    expect(chunk.span[0]).toBeCloseTo(5.678, 5);
    expect(chunk.short).toEqual(['Bavaria']);
  });

  test('of another version or other fields throws', () => {
    expect(() => namesChunk({ ...doc, version: 2 })).toThrow(/version 2/);
    expect(() => namesChunk({ ...doc, fields: ['name'] })).toThrow(/placements are not/);
  });
});
