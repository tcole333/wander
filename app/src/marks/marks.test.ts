// Marks as the look places them: one size at a given scale, faded toward the limb and gone past
// it, binned into screen tiles focal first, packed into the table only when something changed, and
// picked where they are drawn.
import { Matrix3, Matrix4, PerspectiveCamera, Vector3, Vector4 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { tunables } from '../config/tunables';
import { MemoryAccount } from '../perf/memory';
import type { ClearanceField } from '../globe/clearance';
import { dirOf, EARTH_M } from '../story/effects/geo';
import { lonLatToDir } from '../surface/cube';
import type { LonLat } from '../story/story';
import { FAMILIES, FAMILY_VEC4S } from './families';
import {
  FAMILY_STEP,
  FLAG,
  HEIGHT_LEVELS,
  MARK_ROW,
  MARK_TEXELS,
  SLOT_ROW,
  SLOTS_MAX,
  TABLE_WIDTH,
  TILE_COUNT_MAX,
} from './marks.glsl';
import {
  binDiscs,
  FAN_APART,
  fanOffsets,
  type FanMark,
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
    kSea: 0,
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
  it('is 14 px at 12,000 km wide and wider, 22 at 3,000, 32 at 1,000 and 44 at 300 and closer', () => {
    const px = [30, 300, 1000, 3000, 12_000, 40_000].map((km) => markPx(km, 2));
    expect(px).toEqual([44, 44, 32, 22, 14, 14]);
  });

  it('interpolates on the log of the width', () => {
    expect(markPx(Math.sqrt(1000 * 3000), 2)).toBeCloseTo(27, 6);
    expect(markPx(Math.sqrt(300 * 1000), 2)).toBeCloseTo(38, 6);
  });

  it('spans at least 16 device px, so a mark at world view is 16 CSS px at one to a CSS px', () => {
    expect([12_000, 3000, 300].map((km) => markPx(km, 1))).toEqual([16, 22, 44]);
    expect(markPx(12_000, 1.25)).toBe(14);
    expect(markPx(12_000, 1.5)).toBe(14);
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
    Math.floor(y / bins.tilePx) * bins.across + Math.floor(x / bins.tilePx);

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

  it('bins a disc centered past the viewport into the tiles in view it reaches', () => {
    const bins = binDiscs([{ x: 64, y: 128 + 4, reachPx: 6 }], 128, 128, 8);
    expect(bins.binned[0]).toBe(1);
    expect(bins.counts[tileAt(bins, 64, 127)]).toBe(1);
    expect(bins.counts).toHaveLength(16);
  });

  it('bins no disc that reaches no tile in view', () => {
    const bins = binDiscs([{ x: 64, y: 128 + 40, reachPx: 6 }], 128, 128, 8);
    expect(bins.binned[0]).toBe(0);
    expect(bins.used).toBe(0);
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

  it('gives the look each family’s seal and glyph', () => {
    const marks = layer();
    const { seal, glyph } = FAMILIES.governance;
    expect(marks.uniforms.lookMarkFamily.value[FAMILY_VEC4S + 1]?.w).toBe(glyph.scale);
    expect(marks.uniforms.lookMarkFamily.value[FAMILY_VEC4S]?.w).toBe(seal.radius);
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

  it('reaches past a soft seal’s blurred contact shadow at world view', () => {
    const marks = layer();
    const world = over([20, 10], 2);
    // The lamp low in the east, so the seal's shadow runs long to the west.
    const east = dirOf([110, 10]).multiplyScalar(10);
    marks.set('events', [mark('a', [20, 10], { soft: true })]);
    marks.place({ ...world, lamp: east });
    const [placed] = marks.placed();
    const data = marks.uniforms.lookMarkTable.value.image.data as Float32Array;
    const reachPx = data[SLOT_ROW * TABLE_WIDTH * 4 + 2] ?? 0;
    const at = MARK_ROW * TABLE_WIDTH * 4;
    const shadow = Math.hypot(data[at + 8] ?? 0, data[at + 9] ?? 0);
    expect(shadow).toBeGreaterThan(0.3);
    // The look blurs the shadow's edge over 2 × 2.5 px and 0.12 r beyond the seal's radius, 1 r.
    const rPx = placed?.rPx ?? 0;
    expect(rPx).toBeCloseTo(7, 0);
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
    // One group's marks, which share their place rather than stand apart.
    const crowd = Array.from({ length: tunables.markTileCap + 1 }, (_, i) =>
      mark(`m${i}`, [20 + i * 0.002, 10], { score: -i, group: 'crowd' }),
    );
    marks.set('events', crowd);
    marks.place(view);
    const last = `m${tunables.markTileCap}`;
    expect(marks.placed()).toHaveLength(tunables.markTileCap);
    expect(marks.placed().map(({ id }) => id)).not.toContain(last);
    expect(marks.hit(720, 450)).not.toBe(last);
  });

  it('lists only the marks in view, though it draws those past its edges whose drawing reaches in', () => {
    const marks = layer();
    // Places whose seals stand just past the view's bottom edge, their contact shadows reaching
    // into it, and well past it.
    const yOf = (lat: number) => (0.5 - dirOf([20, lat]).applyMatrix4(view.toClip).y / 2) * 900;
    const lats = Array.from({ length: 400 }, (_, i) => 5 - i * 0.01);
    const rPx = markPx(2400, view.pixelRatio) / 2;
    const below = lats.find((lat) => yOf(lat) > 900 + rPx + 1) ?? 0;
    const far = lats.find((lat) => yOf(lat) > 900 + 4 * rPx) ?? 0;
    marks.set('events', [mark('in', [20, 10]), mark('below', [20, below]), mark('far', [20, far])]);
    marks.place(view);
    expect(marks.placed().map(({ id }) => id)).toEqual(['in']);
    const data = marks.uniforms.lookMarkTable.value.image.data as Float32Array;
    const slots = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => data[SLOT_ROW * TABLE_WIDTH * 4 + i * 4 + 3]);
    // In priority order, 'in' is mark 0, 'below' mark 1 and 'far' mark 2.
    expect(slots).toContain(1);
    expect(slots).not.toContain(2);
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

/** A camera south of `at`, low and looking north at it, as a tilted view over land, `kLand` 1. */
function tilted(at: LonLat): MarkView {
  const camera = new PerspectiveCamera(30, 1440 / 900, 0.001, 100);
  camera.position.copy(dirOf([at[0], at[1] - 6]).multiplyScalar(1.1));
  camera.up.copy(dirOf([at[0], at[1] - 6]));
  camera.lookAt(dirOf(at));
  camera.updateMatrixWorld();
  return {
    ...over(at, 0.47),
    camera: camera.position.clone(),
    forward: camera.getWorldDirection(new Vector3()),
    toClip: new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    kLand: 1,
    kSea: 1,
  };
}

/** Where `dir` lifted `meters` off sea level stands on screen in `view`, CSS px, and its depth. */
function project(view: MarkView, dir: Vector3, meters = 0) {
  const lifted = dir.clone().multiplyScalar(1 + meters / EARTH_M);
  const clip = new Vector4(lifted.x, lifted.y, lifted.z, 1).applyMatrix4(view.toClip);
  return {
    x: (clip.x / clip.w / 2 + 0.5) * view.width,
    y: (0.5 - clip.y / clip.w / 2) * view.height,
    w: clip.w,
  };
}

/** A terrain ceiling of `meters` everywhere, the relief's highest and lowest `hMax` and `hMin`. */
function ceiling(meters: number, hMax = meters, hMin = 0, asks: number[][] = []): ClearanceField {
  return {
    ceilingM: (dir: number[], _cap: number, k: number) => {
      asks.push([...dir, k]);
      return k * meters;
    },
    hMax,
    hMin,
  } as unknown as ClearanceField;
}

const texel = { slot: 9, u: 0.25, v: 0.5, level: 7, codeMid: -120 };

describe('MarkLayer’s seals over the relief', () => {
  it('tells the look where the height pool holds the ground under each anchor', () => {
    const marks = new MarkLayer(() => cells);
    marks.set('events', [mark('a', [20, 10])]);
    const at = MARK_ROW * TABLE_WIDTH * 4 + 12;
    const data = () => marks.uniforms.lookMarkTable.value.image.data as Float32Array;
    marks.place(over([20, 10], 0.47));
    // No height to lay the seal at: it lies on the relief.
    expect(data()[at + 2]).toBe(-1);
    const asked: number[][] = [];
    marks.useHeights((dir) => {
      asked.push([...dir]);
      return { slot: 9, u: 0.25, v: 0.5, level: 6, codeMid: -120 };
    });
    marks.place(over([20, 10], 0.47));
    expect([...data().subarray(at, at + 4)]).toEqual([0.25, 0.5, 9 * HEIGHT_LEVELS + 6, -120]);
    // Asked at the anchor, in the cube's frame.
    const own = lonLatToDir(20, 10);
    asked[0]!.forEach((v, i) => expect(v).toBeCloseTo(own[i] ?? NaN, 6));
  });

  it('bins a seal over everywhere on screen its height can lift it, from sea level up', () => {
    const at: LonLat = [20, 10];
    const view = tilted(at);
    const highestM = 20_000;
    const sea = project(view, dirOf(at));
    const top = project(view, dirOf(at), highestM);
    // The lifted seal stands well clear of its sea-level disc.
    expect(sea.y - top.y).toBeGreaterThan(20);
    const marks = new MarkLayer(() => cells);
    const asks: number[][] = [];
    marks.useClearance(ceiling(highestM, highestM, 0, asks));
    marks.useHeights(() => texel);
    marks.set('events', [mark('peak', at)]);
    marks.place(view);
    const data = marks.uniforms.lookMarkTable.value.image.data as Float32Array;
    const [x, y, reach] = [
      ...data.subarray(SLOT_ROW * TABLE_WIDTH * 4, SLOT_ROW * TABLE_WIDTH * 4 + 3),
    ];
    const rPx = marks.placed()[0]!.rPx;
    // Its reach about either end, the lifted end's drawn larger as it nears the camera.
    for (const end of [sea, top]) {
      expect(Math.hypot(end.x - x!, end.y - y!) + 1.3 * rPx * (sea.w / end.w)).toBeLessThan(reach!);
    }
    expect(reach).toBeLessThan(Math.hypot(top.x - sea.x, top.y - sea.y) / 2 + 3 * rPx);
    // The terrain's ceiling is asked at the anchor, in the cube's frame, without the relief's
    // exaggeration, within a few of the heights' texels at their level.
    const own = lonLatToDir(...at);
    expect(asks.length).toBeGreaterThan(0);
    for (const ask of asks) {
      own.forEach((v, i) => expect(ask[i]).toBeCloseTo(v, 9));
      expect(ask[3]).toBe(1);
    }
  });

  it('bins a seal about its sea-level place without the height pool, at sea level', () => {
    const at: LonLat = [20, 10];
    const view = tilted(at);
    const marks = new MarkLayer(() => cells);
    marks.useClearance(ceiling(20_000));
    marks.set('events', [mark('peak', at)]);
    marks.place(view);
    const data = marks.uniforms.lookMarkTable.value.image.data as Float32Array;
    const sea = project(view, dirOf(at));
    expect(data[SLOT_ROW * TABLE_WIDTH * 4]).toBeCloseTo(sea.x, 3);
    expect(data[SLOT_ROW * TABLE_WIDTH * 4 + 1]).toBeCloseTo(sea.y, 3);
    expect(marks.span('peak')).toMatchObject({ x1: sea.x, y1: sea.y });
  });

  it('bins a hovered ring from the deepest sea floor to the highest ground', () => {
    const at: LonLat = [20, 10];
    const view = tilted(at);
    const marks = new MarkLayer(() => cells);
    marks.useClearance(ceiling(0, 8000, -10_000));
    marks.useHeights(() => texel);
    marks.set('events', [mark('war', at, { hover: true, hollow: true, ringRad: 0.01 })]);
    marks.place(view);
    const data = marks.uniforms.lookMarkTable.value.image.data as Float32Array;
    const [x, y, reach] = [
      ...data.subarray(SLOT_ROW * TABLE_WIDTH * 4, SLOT_ROW * TABLE_WIDTH * 4 + 3),
    ];
    const deep = project(view, dirOf(at), -10_000);
    const high = project(view, dirOf(at), 8000);
    expect(x).toBeCloseTo((deep.x + high.x) / 2, 3);
    expect(y).toBeCloseTo((deep.y + high.y) / 2, 3);
    expect(reach).toBeGreaterThan(Math.hypot(high.x - deep.x, high.y - deep.y) / 2);
  });

  it('picks a seal anywhere between its place and where its height can lift it', () => {
    const at: LonLat = [20, 10];
    const view = tilted(at);
    const liftedM = 20_000;
    const sea = project(view, dirOf(at));
    const top = project(view, dirOf(at), liftedM);
    const marks = new MarkLayer(() => cells);
    marks.useClearance(ceiling(liftedM));
    marks.set('events', [mark('peak', at)]);
    marks.place(view);
    // Without the height pool, the seal lies at sea level.
    expect(marks.hit(top.x, top.y)).toBeNull();
    marks.useHeights(() => texel);
    marks.place(view);
    expect(marks.hit(top.x, top.y)).toBe('peak');
    // What stands clear of it stands clear of all the way its height can lift it.
    const lifted = marks.span('peak')!;
    expect(lifted.x1).toBeCloseTo(top.x, 3);
    expect(lifted.y1).toBeCloseTo(top.y, 3);
    expect(marks.span('elsewhere')).toBeNull();
    expect(marks.hit((sea.x + top.x) / 2, (sea.y + top.y) / 2)).toBe('peak');
    expect(marks.hit(sea.x, sea.y)).toBe('peak');
    // Past its lifted place, nothing.
    expect(marks.hit(top.x, top.y - 30)).toBeNull();
  });
});

describe('fanOffsets', () => {
  const fan = (marks: FanMark[], rPx = 10) => {
    const offsets = fanOffsets(marks, rPx);
    return marks.map((m, i) => ({
      x: m.x + (offsets[2 * i] ?? 0),
      y: m.y + (offsets[2 * i + 1] ?? 0),
    }));
  };
  const at = (id: string, x: number, y: number, extra: Partial<FanMark> = {}): FanMark => ({
    id,
    x,
    y,
    alpha: 1,
    score: 0,
    ...extra,
  });

  it('stands two marks at one spot side by side, the higher-scored to the west', () => {
    const [treaty, battle] = fan([
      at('treaty', 100, 50, { score: 3 }),
      at('battle', 100, 50, { score: 7 }),
    ]);
    expect(battle!.x).toBeCloseTo(100 - (FAN_APART * 10) / 2, 6);
    expect(treaty!.x).toBeCloseTo(100 + (FAN_APART * 10) / 2, 6);
    expect([battle!.y, treaty!.y]).toEqual([50, 50]);
  });

  it('pushes overlapping marks apart along the line between them, and leaves the rest', () => {
    const [a, b, c] = fan([at('a', 0, 0), at('b', 6, 8), at('c', 200, 0)]);
    expect(Math.hypot(b!.x - a!.x, b!.y - a!.y)).toBeCloseTo(FAN_APART * 10, 3);
    // Along the line from a to b, 3 to 4.
    expect((b!.y - a!.y) / (b!.x - a!.x)).toBeCloseTo(8 / 6, 6);
    expect(c).toEqual({ x: 200, y: 0 });
  });

  it('slides a mark fading in out from under one standing, which gives way as it comes', () => {
    const [standing, coming] = fan([at('standing', 0, 0), at('coming', 2, 0, { alpha: 0.2 })]);
    expect(Math.hypot(coming!.x - standing!.x, coming!.y - standing!.y)).toBeCloseTo(
      FAN_APART * 10,
      0,
    );
    expect(-standing!.x).toBeLessThan((coming!.x - 2) / 3);
  });

  it('leaves a group’s marks on their shared place', () => {
    const marks = [at('Q1', 0, 0, { group: 'Q1' }), at('Q1/outline', 0, 0, { group: 'Q1' })];
    expect(fan(marks)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]);
  });

  it('places the marks the same whatever their order', () => {
    const marks = [at('a', 0, 0), at('b', 5, 1), at('c', 9, -2, { score: 2 }), at('d', 9, -2)];
    const forward = fan(marks);
    const backward = fan([...marks].reverse()).reverse();
    forward.forEach((p, i) => {
      expect(p.x).toBeCloseTo(backward[i]!.x, 9);
      expect(p.y).toBeCloseTo(backward[i]!.y, 9);
    });
  });
});

describe('MarkLayer’s marks at one place', () => {
  const view = over([20, 10], 0.47);

  it('stands them apart, drawn, picked and spanned where each stands', () => {
    const marks = new MarkLayer(() => cells);
    marks.set('events', [
      mark('treaty', [20, 10], { pace: 'governance', score: 5 }),
      mark('flood', [20, 10], { score: 9 }),
    ]);
    marks.place(view);
    const placed = marks.placed();
    const flood = placed.find((p) => p.id === 'flood')!;
    const treaty = placed.find((p) => p.id === 'treaty')!;
    expect(flood.x).toBeLessThan(treaty.x);
    expect(Math.hypot(treaty.x - flood.x, treaty.y - flood.y)).toBeCloseTo(
      FAN_APART * flood.rPx,
      0,
    );
    // Each is picked, and spanned, where it stands.
    expect(marks.hit(flood.x, flood.y)).toBe('flood');
    expect(marks.hit(treaty.x, treaty.y)).toBe('treaty');
    expect(marks.span('treaty')).toMatchObject({ x0: treaty.x, y0: treaty.y });
    // The look draws each about its own anchor, its place on screen.
    const data = marks.uniforms.lookMarkTable.value.image.data as Float32Array;
    const anchor = (m: number) => {
      const i = MARK_ROW * TABLE_WIDTH * 4 + m * MARK_TEXELS * 4;
      const clip = new Vector4(data[i], data[i + 1], data[i + 2], 1).applyMatrix4(view.toClip);
      return [(clip.x / clip.w / 2 + 0.5) * 1440, (0.5 - clip.y / clip.w / 2) * 900];
    };
    const drawn = [anchor(0), anchor(1)].sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
    expect(drawn[0]![0]).toBeCloseTo(flood.x, 1);
    expect(drawn[0]![1]).toBeCloseTo(flood.y, 1);
    expect(drawn[1]![0]).toBeCloseTo(treaty.x, 1);
  });

  it('stands them as far apart while the layer fades in or out, and toward the limb', () => {
    const at = (strength: number, where: LonLat, from: MarkView) => {
      const marks = new MarkLayer(() => cells);
      marks.strength = strength;
      marks.set('events', [mark('a', where, { score: 2 }), mark('b', where, { score: 1 })]);
      marks.place(from);
      const [a, b] = ['a', 'b'].map((id) => marks.placed().find((p) => p.id === id)!);
      return Math.hypot(b!.x - a!.x, b!.y - a!.y) / a!.rPx;
    };
    expect(at(0.3, [20, 10], view)).toBeCloseTo(at(1, [20, 10], view), 6);
    expect(at(1, [20, 10], view)).toBeCloseTo(FAN_APART, 1);
    // Toward the limb, where the limb fades them, they still stand apart.
    const limb: LonLat = [77, 10];
    const world = over([20, 10], 2);
    expect(limbFade(dirOf(limb), world.camera)).toBeLessThan(0.9);
    expect(limbFade(dirOf(limb), world.camera)).toBeGreaterThan(0.3);
    expect(at(1, limb, world)).toBeGreaterThan(0.9 * FAN_APART);
  });

  it('reaches as far about each mark stood apart as about a mark standing alone', () => {
    const marks = new MarkLayer(() => cells);
    const reaches = () => {
      const data = marks.uniforms.lookMarkTable.value.image.data as Float32Array;
      const ranges = (MARK_ROW - SLOT_ROW) * TABLE_WIDTH;
      const out = new Map<number, number>();
      for (let slot = 0; slot < ranges; slot++) {
        const reach = data[SLOT_ROW * TABLE_WIDTH * 4 + slot * 4 + 2] ?? 0;
        if (reach > 0) out.set(data[SLOT_ROW * TABLE_WIDTH * 4 + slot * 4 + 3] ?? -1, reach);
      }
      return out;
    };
    marks.set('events', [mark('alone', [20, 10])]);
    marks.place(view);
    const alone = reaches().get(0);
    expect(alone).toBeGreaterThan(0);
    marks.set('events', [mark('a', [20, 10], { score: 2 }), mark('b', [20, 10], { score: 1 })]);
    marks.place(view);
    expect([...reaches().values()]).toEqual([alone, alone]);
  });
});
