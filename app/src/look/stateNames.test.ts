// The look's state names layer (stateNames.ts) on a synthetic chunk, the borders' drawing in the
// test's hands: of a preview the outer names alone, of a step its inner names too as the inner
// lines draw; a name both steps of a dissolve hold stays, the others dissolve with their step; an
// empire's em is drawn no larger than its cap; a name gives way to a box it is asked to avoid; and
// with nothing drawn the table goes.
import { PerspectiveCamera } from 'three';
import { describe, expect, test } from 'vitest';
import type { BordersDrawn, StepDrawn } from '../borders/clockBorders';
import type { StepNames } from '../borders/clockNames';
import { tunables } from '../config/tunables';
import { NAME_FLAG, NAMES_FIELDS, namesChunk } from '../data/names';
import { MemoryAccount } from '../perf/memory';
import { dirOf } from '../story/effects/geo';
import type { NameGlyph, NameGlyphs } from './nameGlyphs';
import { StateNameLayer, type NameBox, type NameView } from './stateNames';

const glyphMap = (chars: string) =>
  new Map<string, NameGlyph>(
    [...chars].map((char, i) => [char, { x: 64 * i, y: 40, advance: 0.6 }]),
  );
const GLYPHS: NameGlyphs = {
  outer: glyphMap('ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
  inner: glyphMap('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'),
};

/** A placement row: centidegrees, decidegrees, 1e-4 and 1e-3 degrees, as the stage writes them. */
function row(
  name: number,
  steps: [number, number],
  [lon, lat]: [number, number],
  emDeg: number,
  flags: number,
  group: number,
) {
  return [
    name,
    steps[0],
    steps[1],
    Math.round(lon * 100),
    Math.round(lat * 100),
    0,
    Math.round(emDeg * 1e4),
    Math.round(emDeg * 8 * 1e3),
    500_000,
    flags,
    group,
  ];
}

/**
 * Two steps over Europe: Empire, outer, on both; Moved, outer, at another place on each; Duchy,
 * inner, on both; and Giant, an outer name whose em on screen passes its cap.
 */
const CHUNK = namesChunk({
  version: 1,
  first: 0,
  years: [1800, 1801],
  fields: [...NAMES_FIELDS],
  names: [
    ['Empire', 'Empire'],
    ['Moved', 'Moved'],
    ['Duchy', 'Duchy'],
    ['Giant', 'Giant'],
  ],
  place: [
    ...row(0, [0, 1], [10, 50], 0.4, 0, 0),
    ...row(1, [0, 0], [20, 40], 0.4, 0, 1),
    ...row(1, [1, 1], [21, 40], 0.4, 0, 1),
    ...row(2, [0, 1], [10, 44], 0.3, NAME_FLAG.inner, 2),
    ...row(3, [0, 1], [2, 54], 0.6, 0, 3),
  ],
});

/** The camera over 10°E 47°N, 3,000 km across at 1440x900. */
function view(): NameView {
  const width = 1440;
  const height = 900;
  const camera = new PerspectiveCamera(30, width / height, 0.01, 100);
  const target = dirOf([10, 47]);
  const altitude = 3000 / 6371 / (2 * Math.tan((15 * Math.PI) / 180) * (width / height));
  camera.position.copy(target).multiplyScalar(1 + altitude);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const toClip = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse);
  return {
    camera: camera.position.clone(),
    pxPerUnit: (camera.projectionMatrix.elements[5] ?? 1) * 0.5 * height,
    width,
    height,
    pixelRatio: 1,
    toClip,
  };
}

function harness(drawn: Partial<BordersDrawn> = {}) {
  let t = 0;
  const initial: BordersDrawn = {
    from: null,
    to: { step: 0, preview: false },
    mix: 1,
    strength: 1,
    inner: 1,
    ...drawn,
  };
  const source = {
    drawn: initial,
    namesAt: (step: number): StepNames => ({ chunk: CHUNK, number: 0, index: step }),
  };
  const boxes: NameBox[] = [];
  const layer = new StateNameLayer(
    () => GLYPHS,
    () => boxes,
    () => t,
  );
  layer.follow(source);
  const v = view();
  return {
    layer,
    source,
    boxes,
    /** Places the names over `frames` frames of 100 ms, past every name's fade. */
    place(frames = 5) {
      for (let i = 0; i < frames; i++) {
        t += 100;
        layer.place(v);
      }
      return new Map(layer.shown.drawn.map((name) => [name.text, name]));
    },
  };
}

const step = (index: number, preview = false): StepDrawn => ({ step: index, preview });

describe('the state names', () => {
  test('of a preview are its outer names alone; of a step its inner names too', () => {
    const h = harness({ to: step(0, true) });
    expect([...h.place().keys()].sort()).toEqual(['Empire', 'Giant', 'Moved']);
    h.source.drawn = { ...h.source.drawn, to: step(0), inner: 0.5 };
    const shown = h.place();
    expect([...shown.keys()].sort()).toEqual(['Duchy', 'Empire', 'Giant', 'Moved']);
    expect(shown.get('Duchy')?.alpha).toBeCloseTo(0.5, 2);
  });

  test('dissolve with their steps, a name both hold staying as it is', () => {
    const h = harness({ from: step(0), to: step(1), mix: 0.25 });
    const shown = h.place();
    expect(shown.get('Empire')?.alpha).toBeCloseTo(1, 2);
    const moved = h.layer.shown.drawn.filter((name) => name.text === 'Moved');
    expect(moved.map((name) => name.alpha).sort()).toEqual([
      expect.closeTo(0.25, 2),
      expect.closeTo(0.75, 2),
    ]);
  });

  test('draw an em no larger than its cap', () => {
    const giant = harness().place().get('Giant');
    expect(giant?.naturalPx).toBeGreaterThan(tunables.namePx.outer.cap);
    expect(giant?.emPx).toBeCloseTo(tunables.namePx.outer.cap, 6);
  });

  test('give way to a box they are asked to avoid', () => {
    const h = harness();
    const empire = h.place().get('Empire');
    expect(empire).toBeDefined();
    const [x0, y0, x1, y1] = empire!.box;
    h.layer.avoid('callouts', [
      {
        x0: (x0 + x1) / 2 - 5,
        y0: (y0 + y1) / 2 - 5,
        x1: (x0 + x1) / 2 + 5,
        y1: (y0 + y1) / 2 + 5,
      },
    ]);
    expect(h.place().has('Empire')).toBe(false);
    h.layer.avoid('callouts', []);
    expect(h.place().has('Empire')).toBe(true);
  });

  test('hold no table while none is drawn', () => {
    const h = harness();
    h.place();
    const held = () => {
      const account = new MemoryAccount();
      h.layer.inspectMemory(account);
      return account.owners['names.layer']?.arrayBuffers ?? 0;
    };
    expect(h.layer.uniforms.lookNamesOn.value).toBe(true);
    expect(held()).toBeGreaterThan(0);
    h.source.drawn = { ...h.source.drawn, strength: 0 };
    h.place(1);
    expect(h.layer.uniforms.lookNamesOn.value).toBe(false);
    expect(held()).toBe(0);
  });
});
