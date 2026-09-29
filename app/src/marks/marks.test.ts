// Marks as the look places them: one size at a given scale, faded toward the limb and gone past
// it, binned into screen tiles focal first, packed into the table only when something changed, and
// picked where they are drawn.
import { Matrix3, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { tunables } from '../config/tunables';
import { MemoryAccount } from '../perf/memory';
import { dirOf } from '../story/effects/geo';
import type { LonLat } from '../story/story';
import { binDiscs, limbFade, MarkLayer, markPx, type MarkSpec, type MarkView } from './marks';

/** A camera `altitude` globe radii straight above a place, a 30-degree view 1440x900 px. */
function over([lon, lat]: LonLat, altitude: number): MarkView {
  const camera = new PerspectiveCamera(30, 1440 / 900, 0.001, 100);
  camera.position.copy(dirOf([lon, lat]).multiplyScalar(1 + altitude));
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const toClip = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  return {
    camera: camera.position.clone(),
    forward: camera.getWorldDirection(new Vector3()),
    pxPerUnit: 450 / Math.tan((15 * Math.PI) / 180),
    width: 1440,
    height: 900,
    toClip,
    toView: new Matrix3(),
    lamp: new Vector3(-4.2, 5.2, 9.5),
    kLand: 0,
  };
}

const cells = new Map([['test-star', { x: 0, y: 1638 }]]);
const mark = (id: string, at: LonLat, extra: Partial<MarkSpec> = {}): MarkSpec => ({
  id,
  at,
  glyph: 'test-star',
  pace: 'nature',
  opacity: 1,
  ...extra,
});

describe('markPx', () => {
  it('is 12 px at 12,000 km wide and wider, 16 at 3,000 and 20 at 300 and closer', () => {
    expect([30, 300, 3000, 12_000, 40_000].map(markPx)).toEqual([20, 20, 16, 12, 12]);
  });

  it('interpolates on the log of the width', () => {
    expect(markPx(Math.sqrt(300 * 3000))).toBeCloseTo(18, 6);
  });
});

describe('limbFade', () => {
  const camera = dirOf([0, 0]).multiplyScalar(3);

  it('is whole facing the camera and nothing past the limb', () => {
    expect(limbFade(dirOf([0, 0]), camera)).toBe(1);
    expect(limbFade(dirOf([100, 0]), camera)).toBe(0);
  });

  it('fades toward the limb', () => {
    const near = limbFade(dirOf([66, 0]), camera);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(1);
  });
});

describe('binDiscs', () => {
  it('puts a disc in every tile it touches', () => {
    const bins = binDiscs([{ x: 64, y: 64, reachPx: 6 }], 128, 128, 8);
    expect([bins.across, bins.down]).toEqual([4, 4]);
    const tiles = [...bins.counts.keys()].filter((t) => bins.counts[t] === 1);
    expect(tiles).toEqual([5, 6, 9, 10]);
  });

  it('keeps the first discs a crowded tile can hold, in their order', () => {
    const discs = Array.from({ length: 10 }, (_, i) => ({ x: 10 + i, y: 10, reachPx: 2 }));
    const bins = binDiscs(discs, 64, 64, tunables.markTileCap);
    expect(bins.counts[0]).toBe(tunables.markTileCap);
    expect([...bins.slots.subarray(0, bins.counts[0])]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('leaves out, whole, a disc that reaches into a full tile', () => {
    const cap = tunables.markTileCap;
    const full = Array.from({ length: cap }, (_, i) => ({ x: 10 + i, y: 10, reachPx: 2 }));
    const bins = binDiscs([...full, { x: 32, y: 10, reachPx: 6 }], 128, 64, cap);
    expect(bins.binned[cap]).toBe(0);
    expect(bins.counts[1]).toBe(0);
    expect([...bins.binned.subarray(0, cap)]).toEqual(Array.from({ length: cap }, () => 1));
  });
});

describe('MarkLayer', () => {
  const view = over([20, 10], 0.47);
  const layer = () => new MarkLayer(() => cells);

  it('places a mark under the camera at the screen center, at the view scale', () => {
    const marks = layer();
    marks.set('events', [mark('a', [20, 10])]);
    marks.place(view);
    const [placed] = marks.placed();
    expect(placed?.x).toBeCloseTo(720, 3);
    expect(placed?.y).toBeCloseTo(450, 3);
    // The camera is 3,000 km up with a 30-degree field: the view is about 2,400 km across.
    expect(placed?.rPx).toBeCloseTo(markPx(2400) / 2, 0);
    expect(marks.uniforms.lookMarksOn.value).toBe(true);
  });

  it('places nothing on the far side of the globe', () => {
    const marks = layer();
    marks.set('events', [mark('far', [-160, -10])]);
    marks.place(view);
    expect(marks.placed()).toEqual([]);
    expect(marks.uniforms.lookMarksOn.value).toBe(false);
  });

  it('puts the focal mark first, then the hovered one, then by score', () => {
    const marks = layer();
    marks.set('events', [
      mark('low', [21, 10], { score: 1 }),
      mark('high', [21.5, 10], { score: 9 }),
      mark('hovered', [22, 10], { hover: true }),
    ]);
    marks.set('opening', [mark('focal', [19, 10], { focal: true })]);
    marks.place(view);
    expect(marks.placed().map(({ id }) => id)).toEqual(['focal', 'hovered', 'high', 'low']);
  });

  it('uploads its table only when the view or a fade changed', () => {
    const marks = layer();
    marks.set('events', [mark('a', [20, 10])]);
    const table = marks.uniforms.lookMarkTable.value;
    marks.place(view);
    const placedAt = table.version;
    marks.place(view);
    expect(table.version).toBe(placedAt);
    marks.set('events', [mark('a', [20, 10], { opacity: 0.5 })]);
    marks.place(view);
    expect(table.version).toBeGreaterThan(placedAt);
  });

  it('draws nothing with its marks turned off or its mode faded out', () => {
    const marks = layer();
    marks.set('events', [mark('a', [20, 10])]);
    marks.params.marks = false;
    marks.place(view);
    expect(marks.uniforms.lookMarksOn.value).toBe(false);
    marks.params.marks = true;
    marks.strength = 0;
    marks.place(view);
    expect(marks.uniforms.lookMarksOn.value).toBe(false);
  });

  it('holds no memory once every source has cleared its marks', () => {
    const marks = layer();
    const totals = () => {
      const account = new MemoryAccount();
      marks.inspectMemory(account);
      return account.owners['explore.marks'];
    };
    expect(totals()?.arrayBuffers).toBe(0);
    marks.set('events', [mark('a', [20, 10])]);
    marks.set('opening', [mark('b', [21, 10])]);
    marks.place(view);
    expect(totals()?.arrayBuffers).toBeGreaterThan(0);
    marks.set('events', []);
    expect(totals()?.arrayBuffers).toBeGreaterThan(0);
    marks.set('opening', []);
    expect(totals()).toEqual({ arrayBuffers: 0, audioSamples: 0, canvasPixels: 0, imagePixels: 0 });
    expect(marks.uniforms.lookMarkTable.value.image.width).toBe(1);
    expect(marks.uniforms.lookMarksOn.value).toBe(false);
  });

  it('draws again once marks are set again', () => {
    const marks = layer();
    marks.set('events', [mark('a', [20, 10])]);
    marks.set('events', []);
    marks.set('events', [mark('a', [20, 10])]);
    marks.place(view);
    expect(marks.placed().map(({ id }) => id)).toEqual(['a']);
    expect(marks.uniforms.lookMarkTable.value.image.width).toBe(512);
    expect(marks.uniforms.lookMarksOn.value).toBe(true);
  });

  it('waits for its glyphs to be lettered', () => {
    const marks = new MarkLayer(() => null);
    marks.set('events', [mark('a', [20, 10])]);
    marks.place(view);
    expect(marks.placed()).toEqual([]);
  });

  it('neither draws nor picks a mark its full tiles leave out', () => {
    const marks = layer();
    const crowd = Array.from({ length: tunables.markTileCap + 1 }, (_, i) =>
      mark(`m${i}`, [20 + i * 0.002, 10], { score: -i }),
    );
    marks.set('events', crowd);
    marks.place(view);
    const last = `m${tunables.markTileCap}`;
    expect(marks.placed()).toHaveLength(tunables.markTileCap);
    expect(marks.placed().map(({ id }) => id)).not.toContain(last);
    expect(marks.hit(720, 450)).not.toBe(last);
  });

  it('picks no mark too faint to see', () => {
    const marks = layer();
    marks.set('events', [mark('faint', [20, 10], { opacity: 0.1 })]);
    marks.place(view);
    expect(marks.placed()[0]?.alpha).toBeCloseTo(0.1, 6);
    expect(marks.hit(720, 450)).toBeNull();
  });

  it('picks the mark under the pointer', () => {
    const marks = layer();
    marks.set('events', [mark('a', [20, 10]), mark('b', [24, 10])]);
    marks.place(view);
    const b = marks.placed().find(({ id }) => id === 'b');
    expect(marks.hit(720, 450)).toBe('a');
    expect(marks.hit((b?.x ?? 0) + 2, b?.y ?? 0)).toBe('b');
    expect(marks.hit(720, 300)).toBeNull();
  });
});
