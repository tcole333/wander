import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dayFromIso, isoFromDay } from './dates';
import { parseStory } from './story';

type RouteSource = {
  type: string;
  properties: {
    kind: string;
    epoch: string;
    grid: null;
    dates: string[];
    vertices: {
      dateBasis: string;
      dateRange?: [string, string];
      citations: { source: string; pages: string }[];
    }[];
    legs: { from: number; to: number; uncertain: boolean; sea: boolean }[];
    sources: Record<
      string,
      { title: string; author: string; publisher: string; year: number; url: string }
    >;
    vesselChange: { atVertex: number; date: string; from: string; to: string };
  };
  geometry: { type: string; coordinates: [number, number][] };
};

describe('the Magellan story and its source route', () => {
  const root = new URL('../../../stories/magellan/', import.meta.url);
  const story = parseStory(readFileSync(new URL('story.md', root), 'utf8'));
  const route = JSON.parse(
    readFileSync(new URL('data/route.geojson', root), 'utf8'),
  ) as RouteSource;
  const { properties: data, geometry } = route;

  it('keeps ten sourced beats within the bake and names the route on moving beats', () => {
    expect(story.beats).toHaveLength(10);
    for (const beat of story.beats) {
      const words = beat.paragraphs.join(' ').split(/\s+/).length;
      expect(words, beat.id).toBeGreaterThanOrEqual(60);
      expect(words, beat.id).toBeLessThanOrEqual(120);
      expect(beat.camera.viewKm, beat.id).toBeGreaterThanOrEqual(beat.id === 'mactan' ? 60 : 240);
      expect(beat.layers).not.toContain('borders');
      expect(beat.image.sha1).toMatch(/^[a-f0-9]{40}$/);
      for (const source of beat.sources) {
        expect(source.author).toBeTruthy();
        expect(source.publisher).toBeTruthy();
        expect(source.year).toBeTruthy();
      }
      const tracks = beat.effects.filter((effect) => effect.kind === 'route');
      expect(tracks).toHaveLength(beat.id === 'san-julian' ? 0 : 1);
      for (const track of tracks) expect(track.dataset).toBe('route');
    }
  });

  it('aligns every coordinate, date and uncertain sea leg from departure to return', () => {
    expect(route.type).toBe('Feature');
    expect(geometry.type).toBe('LineString');
    expect(data.kind).toBe('route');
    expect(data.grid).toBeNull();
    expect(data.epoch).toBe('1519-09-20');
    expect(data.dates[0]).toBe(data.epoch);
    expect(data.dates.at(-1)).toBe('1522-09-06');
    expect(geometry.coordinates.length).toBeGreaterThan(2);
    expect(data.dates).toHaveLength(geometry.coordinates.length);
    expect(data.vertices).toHaveLength(geometry.coordinates.length);
    expect(data.legs).toHaveLength(geometry.coordinates.length - 1);
    const days = data.dates.map(dayFromIso);
    expect(days).toEqual([...days].sort((a, b) => a - b));
    expect(days.map(isoFromDay)).toEqual(data.dates);
    expect(geometry.coordinates.at(-1)).toEqual(geometry.coordinates[0]);
    for (const [lon, lat] of geometry.coordinates) {
      expect(Number.isFinite(lon) && Math.abs(lon) <= 180).toBe(true);
      expect(Number.isFinite(lat) && Math.abs(lat) <= 90).toBe(true);
    }
    data.legs.forEach((leg, i) => {
      expect(leg).toEqual({ from: i, to: i + 1, uncertain: true, sea: true });
    });
  });

  it('keeps a citation for each vertex and bounds every estimated date', () => {
    for (const source of Object.values(data.sources)) {
      expect(source.title && source.author && source.publisher && source.year).toBeTruthy();
      expect(source.url).toMatch(/^https:\/\//);
    }
    data.vertices.forEach((vertex, i) => {
      expect(vertex.citations.length).toBeGreaterThan(0);
      for (const citation of vertex.citations) {
        expect(data.sources[citation.source]).toBeDefined();
        expect(citation.pages).toBeTruthy();
      }
      expect(['recorded', 'estimated']).toContain(vertex.dateBasis);
      if (vertex.dateBasis === 'estimated') {
        expect(vertex.dateRange).toHaveLength(2);
        const [start, end] = vertex.dateRange!;
        const day = dayFromIso(data.dates[i]!);
        expect(day).toBeGreaterThanOrEqual(dayFromIso(start));
        expect(day).toBeLessThanOrEqual(dayFromIso(end));
      }
    });
    const change = data.vesselChange;
    expect(change.from).toBe('Trinidad');
    expect(change.to).toBe('Victoria');
    expect(change.date).toBe('1521-04-27');
    expect(data.dates[change.atVertex]).toBe(change.date);
    expect(geometry.coordinates[change.atVertex]).toEqual([123.92, 10.29]);
  });
});
