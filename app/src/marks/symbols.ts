// The marks' glyphs (docs/design/globe-language.md, principle 7): one Isotype-style family per pace
// layer, after Otto and Marie Neurath and Gerd Arntz. Each glyph is a solid silhouette with no
// outline, drawn as SVG path data on a 64-unit grid, y down and north up, which the marks' glyph
// atlas turns into a distance field and scripts/glyphSheet.ts prints. The drawing rules keep them
// legible on the globe's smallest marks, 12 px across, whose seals hold the glyph at about 7 px, a
// unit to a ninth of a pixel:
// - every stroke and gap a glyph needs to be read is at least 6 units wide; finer details, such
//   as a charter's lines or the points of the sun's rays, may fade at the smallest sizes;
// - the glyphs of one family part by their silhouettes, since inner detail fades first;
// - each glyph keeps 4 units clear of the cell's edge and sits in about the cell's inscribed
//   circle, so a family's seal or boss holds it with its rim to spare;
// - paths are filled with the nonzero rule, canvas's and SVG's default: solids wind clockwise on
//   screen and may overlap, and each hole winds against the one solid it is cut from.
// Which glyph and pace layer each class of event takes is eventSymbols.ts's, and the material
// that sets each family apart is the look's.
import type { GlyphSet } from './glyphs';

type Point = readonly [number, number];

const C: Point = [32, 32];
const DEG = Math.PI / 180;

function round(n: number): number {
  return Math.round(n * 10) / 10 || 0;
}

/** Twice the signed area, positive when the points wind clockwise on screen (y down). */
function winding(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[(i + 1) % points.length]!;
    sum += x0 * y1 - x1 * y0;
  }
  return sum;
}

/** A closed polygon: a solid, wound clockwise, or a hole, wound counterclockwise. */
function polygon(points: readonly Point[], hole = false): string {
  const ordered = winding(points) > 0 !== hole ? points : [...points].reverse();
  return `M${ordered.map(([x, y]) => `${round(x)} ${round(y)}`).join('L')}Z`;
}

/** A rectangle from (x0, y0) to (x1, y1): a solid, or a hole. */
function rect(x0: number, y0: number, x1: number, y1: number, hole = false): string {
  const corners: Point[] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  return polygon(corners, hole);
}

/** A circle as two arcs: a solid, wound clockwise, or a hole. */
function circle([x, y]: Point, r: number, hole = false): string {
  const sweep = hole ? 0 : 1;
  const arc = `A${r} ${r} 0 1 ${sweep}`;
  return `M${round(x + r)} ${round(y)}${arc} ${round(x - r)} ${round(y)}${arc} ${round(x + r)} ${round(y)}Z`;
}

/** Points on a circle's arc, degrees clockwise from east, both ends included. */
function arc([x, y]: Point, r: number, from: number, to: number, steps = 16): Point[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = (from + ((to - from) * i) / steps) * DEG;
    return [x + r * Math.cos(a), y + r * Math.sin(a)] as const;
  });
}

/** Points on an ellipse's arc, as `arc` does. */
function ellipse([x, y]: Point, rx: number, ry: number, from: number, to: number, steps = 24) {
  return arc([0, 0], 1, from, to, steps).map(([u, v]) => [x + rx * u, y + ry * v] as const);
}

/** Points on a cubic Bézier curve, both ends included. */
function bezier(p0: Point, p1: Point, p2: Point, p3: Point, steps = 12): Point[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const s = 1 - t;
    const a = s * s * s;
    const b = 3 * s * s * t;
    const c = 3 * s * t * t;
    const d = t * t * t;
    return [
      a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    ] as const;
  });
}

/** Points turned `degrees` clockwise about `about`. */
function rotate(points: readonly Point[], degrees: number, about: Point = C): Point[] {
  const cos = Math.cos(degrees * DEG);
  const sin = Math.sin(degrees * DEG);
  return points.map(([x, y]) => {
    const dx = x - about[0];
    const dy = y - about[1];
    return [about[0] + dx * cos - dy * sin, about[1] + dx * sin + dy * cos] as const;
  });
}

/** Points mirrored east to west across the cell's north-south axis. */
function mirror(points: readonly Point[]): Point[] {
  return points.map(([x, y]) => [2 * C[0] - x, y] as const);
}

function translate(points: readonly Point[], dx: number, dy: number): Point[] {
  return points.map(([x, y]) => [x + dx, y + dy] as const);
}

/** A polyline's outline, `width` wide at each point (or throughout), mitred, with flat ends. */
function stroke(line: readonly Point[], width: number | readonly number[]): Point[] {
  const left: Point[] = [];
  const right: Point[] = [];
  const direction = (a: Point, b: Point): Point => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  };
  for (let i = 0; i < line.length; i++) {
    const p = line[i]!;
    const back = direction(line[Math.max(0, i - 1)]!, line[Math.max(1, i)]!);
    const ahead = direction(
      line[Math.min(i, line.length - 2)]!,
      line[Math.min(i + 1, line.length - 1)]!,
    );
    const tangent = direction([0, 0], [back[0] + ahead[0], back[1] + ahead[1]]);
    const normal: Point = [-tangent[1], tangent[0]];
    const miter = Math.max(0.5, normal[0] * -back[1] + normal[1] * back[0]);
    const half = (typeof width === 'number' ? width : width[i]!) / 2 / miter;
    left.push([p[0] + normal[0] * half, p[1] + normal[1] * half]);
    right.push([p[0] - normal[0] * half, p[1] - normal[1] * half]);
  }
  return [...left, ...right.reverse()];
}

/** A straight bar `width` wide from (x0, y0) to (x1, y1). */
function bar(x0: number, y0: number, x1: number, y1: number, width: number): Point[] {
  const ends: Point[] = [
    [x0, y0],
    [x1, y1],
  ];
  return stroke(ends, width);
}

/** A polygon cut at the horizontal line `y`, keeping what lies above it. */
function above(points: readonly Point[], y: number): Point[] {
  const kept: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    if (a[1] <= y) kept.push(a);
    if (a[1] <= y !== b[1] <= y) {
      const t = (y - a[1]) / (b[1] - a[1]);
      kept.push([a[0] + (b[0] - a[0]) * t, y]);
    }
  }
  return kept;
}

/**
 * A flame on a rounded base: `width` across, its tip `height` above the base's lowest point and
 * `lean` units right of its middle.
 */
function flame(x: number, base: number, width: number, height: number, lean = 0): Point[] {
  const r = width / 2;
  const tip: Point = [x + lean, base - height];
  const left: Point = [x - r, base - r];
  const right: Point = [x + r, base - r];
  return [
    ...arc([x, base - r], r, 180, 0),
    ...bezier(
      right,
      [x + r, base - r - height * 0.3],
      [tip[0] + r * 0.25, base - height * 0.62],
      tip,
    ).slice(1),
    ...bezier(
      tip,
      [tip[0] - r * 0.7, base - height * 0.5],
      [x - r, base - r - height * 0.28],
      left,
    ).slice(1, -1),
  ];
}

/** A band of water: a sine wave `thickness` deep whose crests rise `amplitude` from `y`. */
function wave(y: number, thickness: number, amplitude = 4, from = 6, to = 58, period = 26) {
  const top = Array.from({ length: 33 }, (_, i) => {
    const x = from + ((to - from) * i) / 32;
    return [x, y + amplitude * Math.sin(((x - from) / period) * 2 * Math.PI)] as const;
  });
  return [...top, ...translate(top, 0, thickness).reverse()];
}

/** A sword pointing north, its blade crossing the cell's centre, turned `degrees` clockwise. */
function sword(degrees: number): string {
  const blade: Point[] = [
    [32, 6],
    [36, 14],
    [36, 42],
    [28, 42],
    [28, 14],
  ];
  const guard: Point[] = [
    [21, 42],
    [43, 42],
    [43, 48],
    [21, 48],
  ];
  const grip: Point[] = [
    [29, 47],
    [35, 47],
    [35, 55],
    [29, 55],
  ];
  const [pommel] = rotate([[32, 57]], degrees);
  return [
    polygon(rotate(blade, degrees)),
    polygon(rotate(guard, degrees)),
    polygon(rotate(grip, degrees)),
    circle(pommel!, 4.5),
  ].join('');
}

/** A star of `points` points, the first due north, their radii taken in turn from `tips`. */
function star(points: number, tips: readonly number[], inner: number): Point[] {
  return Array.from({ length: points * 2 }, (_, i) => {
    const r = i % 2 ? inner : tips[(i / 2) % tips.length]!;
    const a = (-90 + (i * 180) / points) * DEG;
    return [C[0] + r * Math.cos(a), C[1] + r * Math.sin(a)] as const;
  });
}

// Nature: the ground, the weather and the body, drawn from what the eye sees of them.

/** A thunderbolt: nature's sudden force, the sign of a natural disaster. */
const disaster = polygon([
  [33, 4],
  [48, 4],
  [39, 23],
  [49, 23],
  [21, 60],
  [28, 33],
  [17, 33],
]);

/** A fault: the ground split, one side dropped. */
const quake = [
  polygon([
    [6, 14],
    [29, 14],
    [23, 26],
    [31, 37],
    [24, 48],
    [28, 58],
    [6, 58],
  ]),
  polygon([
    [37, 24],
    [58, 24],
    [58, 58],
    [36, 58],
    [32, 48],
    [39, 37],
    [32, 26],
  ]),
].join('');

/** A cone with its crater and the smoke drifting from it. */
const eruption = [
  polygon([
    [5, 58],
    [24, 31],
    [28, 35],
    [36, 35],
    [40, 31],
    [59, 58],
  ]),
  circle([31, 24], 6),
  circle([38, 16], 7),
  circle([47, 11], 5.5),
].join('');

/** Three bands of water. */
const flood = [wave(12, 8), wave(28, 8), wave(44, 8)].map((band) => polygon(band)).join('');

/** A storm's two trailing arms, turning as the northern hemisphere's do. */
const stormArms = (() => {
  const steps = 14;
  const spiral = Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const r = 8 + 17 * t;
    const a = (-90 + 150 * t) * DEG;
    return [C[0] + r * Math.cos(a), C[1] + r * Math.sin(a)] as const;
  });
  const widths = spiral.map((_, i) => 10 * (1 - i / steps) + 1.5);
  const arm = stroke(spiral, widths);
  return [arm, rotate(arm, 180)];
})();

/** A storm's eye and two trailing arms, turning as the northern hemisphere's do. */
const cyclone = [circle(C, 10), ...stormArms.map((arm) => polygon(arm))].join('');

/** The same storm south of the equator, where it turns the other way. */
const cycloneSouth = [circle(C, 10), ...stormArms.map((arm) => polygon(mirror(arm)))].join('');

/** A slope and the boulders tumbling from it. */
const slide = [
  polygon([
    [27, 58],
    [59, 58],
    [59, 11],
  ]),
  circle([13, 51], 7),
  circle([26, 37], 5.5),
  circle([37, 24], 4.5),
].join('');

/** A flame with its hot heart. */
const fire = [polygon(flame(32, 60, 34, 54, 5)), polygon(flame(33, 55, 12, 22, 2), true)].join('');

/** The sun over parched and cracking ground: drought and heat. */
const heat = [
  circle([32, 24], 8),
  ...Array.from({ length: 8 }, (_, i) =>
    polygon(
      rotate(
        [
          [28.5, 11],
          [35.5, 11],
          [32, 4],
        ],
        i * 45,
        [32, 24],
      ),
    ),
  ),
  polygon([
    [6, 50],
    [21, 50],
    [18, 58],
    [6, 58],
  ]),
  polygon([
    [28, 50],
    [37, 50],
    [40, 58],
    [25, 58],
  ]),
  polygon([
    [44, 50],
    [58, 50],
    [58, 58],
    [47, 58],
  ]),
].join('');

/** A snowflake: six arms, each with a pair of branches. */
const cold = Array.from({ length: 6 }, (_, i) =>
  [bar(32, 32, 32, 5, 6.5), bar(32, 15, 26, 9, 6), bar(32, 15, 38, 9, 6)]
    .map((arm) => polygon(rotate(arm, i * 60)))
    .join(''),
).join('');

/** A germ: a round body with its spots and eight short knobs. */
const plague = [
  circle(C, 19),
  circle([25.5, 27], 4.5, true),
  circle([39.5, 30], 3.5, true),
  circle([31, 40], 3.5, true),
  ...Array.from({ length: 8 }, (_, i) => {
    const a = (i * 45 - 90) * DEG;
    return circle([C[0] + 22 * Math.cos(a), C[1] + 22 * Math.sin(a)], 4);
  }),
].join('');

/** An empty bowl, seen from a little above. */
const famine = [
  polygon([
    ...ellipse([32, 29], 26, 9, 180, 360),
    ...ellipse([32, 29], 26, 24, 0, 180).slice(1, -1),
  ]),
  polygon(ellipse([32, 28.5], 19.5, 4.5, 0, 360, 32), true),
  polygon([
    [23, 50],
    [41, 50],
    [44, 57],
    [20, 57],
  ]),
].join('');

// Governance: arms, walls and documents, the heraldry of states.

/** Crossed swords, the maps' old sign for a battle. */
const battle = sword(-43) + sword(43);

/** A shield with crossed blades cut from it: a war, a campaign, an invasion or a conquest. */
const war = (() => {
  const shield: Point[] = [
    [10, 6],
    [54, 6],
    [54, 26],
    ...bezier([54, 26], [54, 42], [44, 52], [32, 59]).slice(1),
    ...bezier([32, 59], [20, 52], [10, 42], [10, 26]).slice(1),
  ];
  // Two blades 7 wide crossing at the shield's heart, as one outline so the cut is one hole.
  const [u, w] = [15, 3.5];
  const cross: Point[] = [
    [u, w],
    [w, w],
    [w, u],
    [-w, u],
    [-w, w],
    [-u, w],
    [-u, -w],
    [-w, -w],
    [-w, -u],
    [w, -u],
    [w, -w],
    [u, -w],
  ];
  const s2 = Math.SQRT1_2;
  const saltire = cross.map(([a, b]) => [31.9 + (a - b) * s2, 29 + (a + b) * s2] as const);
  return polygon(shield) + polygon(saltire, true);
})();

/** A crenellated tower with its gate. */
const siege = polygon([
  [13, 7],
  [21, 7],
  [21, 14],
  [28, 14],
  [28, 7],
  [36, 7],
  [36, 14],
  [43, 14],
  [43, 7],
  [51, 7],
  [51, 22],
  [46, 26],
  [46, 58],
  [37, 58],
  ...arc([32, 45], 5, 0, -180, 8),
  [27, 58],
  [18, 58],
  [18, 26],
  [13, 22],
]);

/** A charter: a scroll with its lines and a pendant seal. */
const treaty = [
  rect(15, 10, 49, 45),
  ...[11, 44].flatMap((y) => [
    polygon(bar(10, y, 54, y, 10)),
    circle([10, y], 5),
    circle([54, y], 5),
  ]),
  rect(21, 21, 43, 25, true),
  rect(21, 30, 43, 34, true),
  circle([32, 52], 7.5),
].join('');

/** A torch: rising, revolt, a crowd in the street. */
const uprising = [
  polygon(flame(32, 31, 24, 27, 3)),
  polygon([
    [19, 33],
    [45, 33],
    [40, 42],
    [24, 42],
  ]),
  polygon([
    [27, 42],
    [37, 42],
    [35.5, 60],
    [28.5, 60],
  ]),
].join('');

/** A memorial stone: an assassination, a massacre, a genocide or a pogrom. */
const atrocity = polygon([
  ...arc([32, 24], 13, 180, 360),
  [45, 49],
  [51, 49],
  [51, 57],
  [13, 57],
  [13, 49],
  [19, 49],
]);

// Infrastructure: what people build and sail, laid on the surface.

/** A ship going down by the stern into the waves. */
const wreck = (() => {
  const hull: Point[] = [
    [6, 35],
    [60, 35],
    [50, 49],
    [14, 49],
  ];
  // Sails 6 units clear of each other and of the hull, so the ship stays three shapes at 12 px.
  const mainsail: Point[] = [
    [35, 4],
    [35, 29],
    [57, 29],
  ];
  const foresail: Point[] = [
    [29, 9],
    [29, 29],
    [12, 29],
  ];
  const tilt = (points: Point[]) => above(rotate(points, -22, [32, 42]), 46);
  return [hull, mainsail, foresail]
    .map((part) => polygon(tilt(part)))
    .concat(polygon(wave(49, 8, 2.5)))
    .join('');
})();

/** A compass rose. */
const expedition = polygon(star(8, [28, 16], 9));

/** A house burning, its roof gone to flame: a window, and its door at the right. */
const conflagration = [
  polygon([
    [34, 58],
    [16, 58],
    [16, 42],
    [11, 41],
    ...bezier([11, 41], [8, 32], [13, 25], [17, 19]).slice(1),
    ...bezier([17, 19], [19, 25], [22, 28], [25, 28]).slice(1),
    ...bezier([25, 28], [24, 18], [28, 11], [34, 5]).slice(1),
    ...bezier([34, 5], [32, 14], [39, 19], [40, 26]).slice(1),
    ...bezier([40, 26], [43, 24], [45, 20], [45, 15]).slice(1),
    ...bezier([45, 15], [52, 22], [56, 33], [53, 41]).slice(1),
    [48, 42],
    [48, 58],
    [42, 58],
    [42, 48],
    [34, 48],
  ]),
  rect(22, 45, 28, 51, true),
].join('');

/** Every glyph, nature's first, then governance's and infrastructure's. */
export const EVENT_GLYPHS = {
  disaster,
  quake,
  eruption,
  flood,
  cyclone,
  cycloneSouth,
  slide,
  fire,
  heat,
  cold,
  plague,
  famine,
  war,
  battle,
  siege,
  treaty,
  uprising,
  atrocity,
  wreck,
  expedition,
  conflagration,
} as const satisfies GlyphSet;

export type GlyphId = keyof typeof EVENT_GLYPHS;
