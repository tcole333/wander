// Marks as the look places them: one size at a given scale, faded toward the limb and gone past
// it, binned into screen tiles focal first, packed into the table only when something changed, and
// picked where they are drawn.
import { Matrix3, Matrix4, PerspectiveCamera, Vector3, Vector4 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { tunables } from '../config/tunables';
import { MemoryAccount } from '../perf/memory';
import type { ClearanceField } from '../globe/clearance';
import { dirOf, EARTH_M } from '../story/effects/geo';
import type { LonLat } from '../story/story';
import { FAMILIES, FAMILY_VEC4S } from './families';
import {
  FAMILY_STEP,
  FLAG,
  MARK_ROW,
  SLOT_ROW,
  SLOTS_MAX,
  TABLE_WIDTH,
  TILE_COUNT_MAX,
} from './marks.glsl';
import {
  binDiscs,
  limbFade,
  MarkLayer,
  markPx,
  RING_MAX_RAD,
  type MarkSpec,
  type MarkView,
} from './marks';

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
    pixelRatio: 1.5,
    toClip,
    toView: new Matrix3(),
    lamp: new Vector3(-4.2, 5.2, 9.5),
    kLand: 0,
  };
}

const cells = new Map([['battle', { x: 0, y: 1638, extent: 0.95 }]]);
const mark = (id: string, at: LonLat, extra: Partial<MarkSpec> = {}): MarkSpec => ({
  id,
  at,
  glyph: 'battle',
  pace: 'nature',
  opacity: 1,
  ...extra,
});

describe('markPx', () => {
  it('is 12 px at 12,000 km wide and wider, 16 at 3,000 and 20 at 300 and closer', () => {
    const px = [30, 300, 3000, 12_000, 40_000].map((km) => markPx(km, 2));
    expect(px).toEqual([20, 20, 16, 12, 12]);
  });

  it('interpolates on the log of the width', () => {
    expect(markPx(Math.sqrt(300 * 3000), 2)).toBeCloseTo(18, 6);
  });

  it('spans at least 16 device px, so a mark at world view is 16 CSS px at one to a CSS px', () => {
    expect([12_000, 3000, 300].map((km) => markPx(km, 1))).toEqual([16, 16, 20]);
    expect(markPx(12_000, 1.25)).toBeCloseTo(12.8, 6);
    expect(markPx(12_000, 1.5)).toBe(12);
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

describe('the table', () => {
  it('counts every mark a tile can hold, and places every slot exactly', () => {
    expect(tunables.markTileCap).toBeLessThanOrEqual(TILE_COUNT_MAX);
    expect(SLOTS_MAX * (TILE_COUNT_MAX + 1) + TILE_COUNT_MAX).toBeLessThan(2 ** 24);
  });
});

describe('binDiscs', () => {
  /** The tile holding CSS px (x, y) in `bins`. */
  const tileAt = (bins: ReturnType<typeof binDiscs>, x: number, y: number) =>
    Math.floor((y + bins.pad) / bins.tilePx) * bins.across +
    Math.floor((x + bins.pad) / bins.tilePx);

  it('puts a disc in every tile it touches', () => {
    const bins = binDiscs([{ x: 64, y: 64, reachPx: 6 }], 128, 128, 8);
    const tiles = [...bins.counts.keys()].filter((t) => bins.counts[t] === 1);
    expect(tiles).toEqual([
      tileAt(bins, 63, 63),
      tileAt(bins, 64, 63),
      tileAt(bins, 63, 64),
      tileAt(bins, 64, 64),
    ]);
  });

  it('bins a disc just past the viewport, where relief lifts a mark into view', () => {
    const bins = binDiscs([{ x: 64, y: 128 + 40, reachPx: 6 }], 128, 128, 8);
    expect(bins.binned[0]).toBe(1);
    expect(bins.counts[tileAt(bins, 64, 168)]).toBe(1);
  });

  it('keeps the first discs a crowded tile can hold, in their order', () => {
    const discs = Array.from({ length: 10 }, (_, i) => ({ x: 10 + i, y: 10, reachPx: 2 }));
    const bins = binDiscs(discs, 64, 64, tunables.markTileCap);
    const tile = tileAt(bins, 10, 10);
    expect(bins.counts[tile]).toBe(tunables.markTileCap);
    const start = bins.starts[tile] ?? 0;
    expect([...bins.slots.subarray(start, start + tunables.markTileCap)]).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it('leaves out, whole, a disc that reaches into a full tile', () => {
    const cap = tunables.markTileCap;
    const full = Array.from({ length: cap }, (_, i) => ({ x: 10 + i, y: 10, reachPx: 2 }));
    const bins = binDiscs([...full, { x: 32, y: 10, reachPx: 6 }], 128, 64, cap);
    expect(bins.binned[cap]).toBe(0);
    expect(bins.counts[tileAt(bins, 33, 10)]).toBe(0);
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
    expect(placed?.rPx).toBeCloseTo(markPx(2400, view.pixelRatio) / 2, 0);
    expect(marks.uniforms.lookMarksOn.value).toBe(true);
  });

  it('draws the owner’s cast token unless asked for another variant', () => {
    const marks = layer();
    marks.update(0);
    const token = FAMILIES.governance.variants[0];
    expect(marks.params.markVariant).toBe(0);
    expect(marks.uniforms.lookMarkFamily.value[FAMILY_VEC4S + 1]?.w).toBe(token.glyph.scale);
    expect(marks.uniforms.lookMarkFamily.value[FAMILY_VEC4S]?.w).toBe(token.disc?.radius);
  });

  it('packs a mirrored glyph’s flag below its family', () => {
    const marks = layer();
    marks.set('events', [mark('storm', [20, 10], { pace: 'governance', mirror: true })]);
    marks.place(view);
    const data = marks.uniforms.lookMarkTable.value.image.data as Float32Array;
    expect(data[MARK_ROW * TABLE_WIDTH * 4 + 6]).toBe(FAMILY_STEP + FLAG.mirror);
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

  it('reaches past a soft token’s blurred contact shadow at world view', () => {
    const marks = layer();
    const world = over([20, 10], 2);
    // The lamp low in the east, so the token's shadow runs long to the west.
    const east = dirOf([110, 10]).multiplyScalar(10);
    marks.set('events', [mark('a', [20, 10], { soft: true })]);
    marks.place({ ...world, lamp: east });
    const [placed] = marks.placed();
    const data = marks.uniforms.lookMarkTable.value.image.data as Float32Array;
    const reachPx = data[SLOT_ROW * TABLE_WIDTH * 4 + 2] ?? 0;
    const at = MARK_ROW * TABLE_WIDTH * 4;
    const shadow = Math.hypot(data[at + 8] ?? 0, data[at + 9] ?? 0);
    expect(shadow).toBeGreaterThan(0.3);
    // The look blurs the shadow's edge over 2 × 2.5 px and 0.12 r beyond the disc's radius, 1 r.
    const rPx = placed?.rPx ?? 0;
    expect(rPx).toBeCloseTo(6, 0);
    expect(reachPx).toBeGreaterThanOrEqual((shadow + 1 + 0.12) * rPx + 2 * 2.5);
  });

  it('reaches past the focal ember’s ring', () => {
    const marks = layer();
    marks.set('events', [mark('a', [20, 10], { focal: true })]);
    marks.place(over([20, 10], 2));
    const data = marks.uniforms.lookMarkTable.value.image.data as Float32Array;
    const reachPx = data[SLOT_ROW * TABLE_WIDTH * 4 + 2] ?? 0;
    const rPx = marks.placed()[0]?.rPx ?? 0;
    // Its ring at 1.35 r, half 0.07 r or 0.9 px wide, with a pixel's antialiasing.
    expect(reachPx).toBeGreaterThanOrEqual(1.35 * rPx + Math.max(0.07 * rPx, 0.9) + 1);
  });

  it('reaches past the ember’s ring, which a tilt widens, toward the limb', () => {
    const marks = layer();
    const world = over([20, 10], 2);
    const at = dirOf([75, 10]);
    const toCamera = world.camera.clone().sub(at).normalize();
    const facing = at.dot(toCamera);
    expect(facing).toBeLessThan(0.5);
    marks.set('events', [mark('a', [75, 10], { focal: true })]);
    marks.place(world);
    const data = marks.uniforms.lookMarkTable.value.image.data as Float32Array;
    const reachPx = data[SLOT_ROW * TABLE_WIDTH * 4 + 2] ?? 0;
    const rPx = marks.placed()[0]?.rPx ?? 0;
    // A pixel spans up to 1 / (rPx × facing) of r there: the ring's half width is 0.9 of that,
    // and its edge one more.
    expect(reachPx).toBeGreaterThanOrEqual(1.35 * rPx + 1.9 / facing);
  });

  it('reaches, and looks as far as, a hovered parent’s wide ring', () => {
    const marks = layer();
    const world = over([20, 10], 2);
    const ringRad = 0.5;
    marks.set('events', [mark('war', [20, 10], { hover: true, hollow: true, ringRad })]);
    marks.place(world);
    const data = marks.uniforms.lookMarkTable.value.image.data as Float32Array;
    const reachPx = data[SLOT_ROW * TABLE_WIDTH * 4 + 2] ?? 0;
    const cosMin = data[MARK_ROW * TABLE_WIDTH * 4 + 11] ?? 1;
    expect(cosMin).toBeLessThan(Math.cos(ringRad));
    // A point on the ring, due north of the mark, 0.5 radians of arc away.
    const north = dirOf([20, 10 + (ringRad * 180) / Math.PI]).applyMatrix4(world.toClip);
    const [x, y] = [(north.x / 2 + 0.5) * 1440, (0.5 - north.y / 2) * 900];
    expect(reachPx).toBeGreaterThan(Math.hypot(x - 720, y - 450));
  });

  it('draws a ring no wider than an eighth of the globe’s round', () => {
    const marks = layer();
    marks.set('events', [mark('empire', [20, 10], { hover: true, ringRad: 3 })]);
    marks.place(over([20, 10], 2));
    const data = marks.uniforms.lookMarkTable.value.image.data as Float32Array;
    expect(data[MARK_ROW * TABLE_WIDTH * 4 + 11]).toBeGreaterThan(0);
    expect(data[MARK_ROW * TABLE_WIDTH * 4 + 11]).toBeLessThan(Math.cos(RING_MAX_RAD));
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

  it('logs a glyph or pace it does not know once, and draws none of its marks', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const marks = layer();
    marks.set('events', [
      mark('a', [20, 10], { glyph: 'no-such-glyph' }),
      mark('b', [21, 10], { glyph: 'no-such-glyph' }),
      mark('c', [22, 10], { pace: 'weather' as MarkSpec['pace'] }),
    ]);
    marks.place(view);
    marks.place(view);
    expect(marks.placed()).toEqual([]);
    expect(warn.mock.calls.map(([message]) => String(message))).toEqual([
      expect.stringContaining("pace 'weather'"),
      expect.stringContaining("glyph 'no-such-glyph'"),
    ]);
    warn.mockRestore();
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

  it('lists only the marks in view, though it draws those just past its edges', () => {
    const marks = layer();
    // A place 20 to 60 px below the view's bottom edge.
    const yOf = (lat: number) => (0.5 - dirOf([20, lat]).applyMatrix4(view.toClip).y / 2) * 900;
    const lats = Array.from({ length: 40 }, (_, i) => 5 - i * 0.1);
    const below = lats.find((lat) => yOf(lat) > 920 && yOf(lat) < 960) ?? 0;
    marks.set('events', [mark('in', [20, 10]), mark('below', [20, below])]);
    marks.place(view);
    expect(marks.placed().map(({ id }) => id)).toEqual(['in']);
    const data = marks.uniforms.lookMarkTable.value.image.data as Float32Array;
    const slots = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => data[SLOT_ROW * TABLE_WIDTH * 4 + i * 4 + 3]);
    expect(slots).toContain(1);
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

  it('picks a mark on land anywhere between its place and where the relief can lift it', () => {
    // A tilted view north over a place: its relief rises toward the top of the screen.
    const at: LonLat = [20, 10];
    const liftedM = 20_000;
    const camera = new PerspectiveCamera(30, 1440 / 900, 0.001, 100);
    camera.position.copy(dirOf([20, 4]).multiplyScalar(1.1));
    camera.up.copy(dirOf([20, 4]));
    camera.lookAt(dirOf(at));
    camera.updateMatrixWorld();
    const onLand: MarkView = {
      ...view,
      camera: camera.position.clone(),
      forward: camera.getWorldDirection(new Vector3()),
      toClip: new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
      kLand: 8,
    };
    const project = (dir: Vector3) => {
      const clip = new Vector4(dir.x, dir.y, dir.z, 1).applyMatrix4(onLand.toClip);
      return { x: (clip.x / clip.w / 2 + 0.5) * 1440, y: (0.5 - clip.y / clip.w / 2) * 900 };
    };
    const sea = project(dirOf(at));
    const top = project(dirOf(at).multiplyScalar(1 + liftedM / EARTH_M));
    // The lifted mark stands well clear of its sea-level disc.
    expect(sea.y - top.y).toBeGreaterThan(20);
    const marks = layer();
    marks.set('events', [mark('peak', at)]);
    marks.place(onLand);
    expect(marks.hit(top.x, top.y)).toBeNull();
    const ceilings: number[] = [];
    marks.useClearance({
      ceilingM: (_dir: number[], _cap: number, kLand: number) => {
        ceilings.push(kLand);
        return liftedM;
      },
    } as unknown as ClearanceField);
    expect(marks.hit(top.x, top.y)).toBe('peak');
    expect(marks.hit((sea.x + top.x) / 2, (sea.y + top.y) / 2)).toBe('peak');
    expect(marks.hit(sea.x, sea.y)).toBe('peak');
    expect(ceilings).toContain(8);
    // Past its lifted place, nothing.
    expect(marks.hit(top.x, top.y - 20)).toBeNull();
  });
});
