// The brass stock of Explore's time ruler (timeRuler.ts): its geometry at a view's width, and
// what is drawn once per resize or each frame as SVG, the stock's body, the overview's gilt
// engraving, the lens and what moves over the stock, the glass at the crown, the reels' faces,
// the plaque and the vignette over it all, lit as the walks' ruler is (story/ui/brass.ts).
import { LENS } from '../scene/lens';
import { brassFilter, cartouche, sharedDefs } from '../story/ui/brass';
import { HISTORICAL } from '../story/dates';
import { along, at, deg, f, radial, sector, type Arc } from '../story/ui/rulerScale';
import type { ExploreTime } from '../time/exploreTime';
import { lensExtent, NAME_CHAR_PX, overviewNames, overviewTicks } from '../time/overviewScale';

/** The ruler's box: the view's width, this tall, on the view's foot. */
export const RULER_H = 114;
/** Radial offsets from the beaded rule between the scales, up positive. */
export const FOOT = 8;
export const OVD = 23;
export const TAPE = 34;
export const TAPE_TOP = TAPE + 1;
export const LIP_TOP = TAPE_TOP + 4;
/** The overview's hit area reaches this far below the beaded rule. */
export const OV_HIT = 30;
/** The tape's reference radius, its band's middle, where its scale is measured. */
export const TAPE_MID = 18;
/** Tick lengths, px: labelled, half-step and fine. */
export const TICK = { label: 11, mid: 7, fine: 4 } as const;
/** Numerals' baseline, and the caps', from the beaded rule. */
export const NUMERAL_ROW = 9.5;
export const CAPS_ROW = 11;
/** The jewel's centre on the lip, and its bezel's radius. */
export const JEWEL_AT = TAPE_TOP + 2;
export const JEWEL_R = 6.3;
/** The plaque's tab. */
export const TAB = 5;
/** The canvas's vignette over the brass, at this share of its strength so the engraving reads. */
export const VIGNETTE = LENS.vignette * 0.55;

/** The ruler's geometry at one width. */
export interface Layout {
  width: number;
  narrow: boolean;
  arc: Arc;
  side: number;
  reelR: number;
  /** The tape's length, px, and the overview's. */
  rulePx: number;
  ovLen: number;
  /** The glass's half angle: a tenth of the tape. */
  glass: number;
  plateW: number;
  counterW: number;
  short: boolean;
}

export function layoutFor(width: number): Layout {
  const narrow = width < 700;
  const side = Math.max(24, Math.round(width * 0.044));
  const half = width / 2 - side;
  const sag = Math.min(12, Math.max(4, width * 0.0085));
  const r = (half * half + sag * sag) / (2 * sag);
  const sepY = RULER_H - FOOT - OVD - sag;
  const reelR = narrow ? 15 : 22;
  const end = Math.asin(Math.min(1, half / r));
  const reach = Math.asin(Math.min(1, (half - reelR - 3) / r));
  const arc: Arc = { width, cx: width / 2, cy: sepY + r, r, reach, end };
  return {
    width,
    narrow,
    arc,
    side,
    reelR,
    rulePx: 2 * reach * (r + TAPE_MID),
    ovLen: 2 * reach * (r - OVD / 2),
    glass: 0.1 * reach,
    plateW: narrow ? 104 : 124,
    counterW: width < 420 ? 112 : narrow ? 122 : 142,
    short: width < 420,
  };
}

export function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

/** Text engraved at (x, y), at `size` px if given: the lit lip of the cut, then the cut. */
export function engravedText(
  x: number,
  y: number,
  className: string,
  text: string,
  size?: string,
): string {
  const t = escapeText(text);
  const style = size ? ` style="font-size:${size}px"` : '';
  return (
    `<text x="${x + 0.6}" y="${y + 0.9}" text-anchor="middle" class="${className} rc-cut-lip"${style}>${t}</text>` +
    `<text x="${x}" y="${y}" text-anchor="middle" class="${className} rc-cut"${style}>${t}</text>`
  );
}

/** A garnet lozenge at `angle`, `dr` above the beaded rule. */
export function lozenge(arc: Arc, angle: number, dr: number, s: number): string {
  const [x, y] = at(arc, angle, dr);
  return (
    `<path class="xr-lozenge" d="M${f(x)} ${f(y - s)}L${f(x + s * 0.8)} ${f(y)}L${f(x)} ${f(y + s)}L${f(x - s * 0.8)} ${f(y)}Z" ` +
    `fill="url(#rc-garnet)" stroke="#2a0710" stroke-width="0.5"/>`
  );
}

/** The ruler's own gradients and patterns, beside the brass's shared ones. */
export function ownDefs(): string {
  return `<defs>
<linearGradient id="xr-dark-fill" x1="0" x2="0.3" y1="0" y2="1">
  <stop offset="0" stop-color="#4a3519"/><stop offset="0.5" stop-color="#2e2010"/><stop offset="1" stop-color="#1b1208"/>
</linearGradient>
<radialGradient id="xr-knurl-fill" r="0.5">
  <stop offset="0.8" stop-color="#8a6630"/><stop offset="0.93" stop-color="#c9a15c"/><stop offset="1" stop-color="#5a3f1a"/>
</radialGradient>
<linearGradient id="xr-glass-fill" x1="0" x2="0.25" y1="0" y2="1">
  <stop offset="0" stop-color="rgb(255 246 222 / 0.26)"/><stop offset="0.45" stop-color="rgb(255 246 222 / 0.1)"/>
  <stop offset="1" stop-color="rgb(255 246 222 / 0.05)"/>
</linearGradient>
<pattern id="xr-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(40)">
  <rect width="6" height="6" fill="rgb(24 13 3 / 0.42)"/>
  <path d="M0 0V6" stroke="rgb(20 10 2 / 0.5)" stroke-width="1.4"/>
  <path d="M1.6 0V6" stroke="rgb(255 226 170 / 0.12)" stroke-width="0.6"/>
</pattern>
${brassFilter('xr-lit-reel', { bevel: 2, relief: 3.5, texture: '0.08', amount: 0.08, bloom: 0.4, patina: 0.15 })}
</defs>`;
}

/**
 * The stock: its shadow, the overview's dark bronze, the beaded rule between the scales, the tape's
 * band and its lit lip, their edge rules, the reels' sockets and the tape's end brackets' seats.
 */
export function bodySvg(layout: Layout): string {
  const { arc, reelR } = layout;
  const [a0, a1] = [-arc.end, arc.end];
  const rules =
    along(arc, -arc.reach - 0.004, arc.reach + 0.004, TAPE_TOP - 2.5) +
    along(arc, -arc.reach - 0.004, arc.reach + 0.004, 2.5);
  const beads = along(arc, a0, a1, 0.2);
  const sockets = [-1, 1]
    .map((side) => {
      const [x, y] = at(arc, side * arc.end, TAPE_MID);
      return `<circle cx="${f(x + 2)}" cy="${f(y + 4)}" r="${f(reelR + 3)}"/>`;
    })
    .join('');
  return `${sharedDefs()}${ownDefs()}
<g fill="#000" filter="url(#rc-soft)">
  <path d="${sector(arc, a0, a1, -OVD - 2, LIP_TOP + 3)}" opacity="0.55" transform="translate(2 5)"/>
  <g opacity="0.7">${sockets}</g>
</g>
<path d="${sector(arc, a0 - 0.004, a1 + 0.004, -OVD, 0)}" fill="url(#rc-base-fill)" filter="url(#rc-lit-base)"/>
<path d="${sector(arc, a0, a1, 0, 1)}" fill="#120a03"/>
<path d="${sector(arc, a0, a1, 1, TAPE_TOP)}" fill="url(#rc-band-fill)" filter="url(#rc-lit-band)"/>
<path d="${sector(arc, a0, a1, TAPE_TOP - 0.5, LIP_TOP)}" fill="url(#rc-lip-fill)" filter="url(#rc-lit-lip)"/>
<path d="${along(arc, a0, a1, TAPE_TOP)}" fill="none" stroke="rgb(40 25 8 / 0.55)" stroke-width="0.8"/>
<g fill="none" stroke-linecap="round">
  <path d="${rules}" stroke="rgb(255 238 196 / 0.38)" stroke-width="0.7" transform="translate(0.5 0.8)"/>
  <path d="${rules}" stroke="rgb(43 28 12 / 0.7)" stroke-width="0.7"/>
  <path d="${beads}" stroke="rgb(0 0 0 / 0.6)" stroke-width="2.2" stroke-dasharray="0 5" transform="translate(0.4 0.8)"/>
  <path d="${beads}" stroke="rgb(236 200 132 / 0.75)" stroke-width="1.6" stroke-dasharray="0 5"/>
</g>`;
}

/**
 * The overview's gilt engraving, which changes only with the view's size: history's ends and each
 * millennium, 1 CE's double rule, the centuries and decades where they have room, and its names.
 */
export function overviewSvg(layout: Layout, time: ExploreTime): string {
  const { arc, ovLen, narrow } = layout;
  const angleOf = (day: number) => (2 * time.warp.u(day) - 1) * arc.reach;
  let ticks = '';
  const widths = new Map<number, string>();
  for (const tick of overviewTicks(time.warp, time.extent, ovLen)) {
    const a = angleOf(tick.day);
    if (tick.kind === 'era') {
      const e = 1.1 / arc.r;
      const d = radial(arc, a - e, -1, -1 - tick.length) + radial(arc, a + e, -1, -1 - tick.length);
      widths.set(0.7, (widths.get(0.7) ?? '') + d);
      continue;
    }
    const d = radial(arc, a, -1, -1 - tick.length);
    widths.set(tick.width, (widths.get(tick.width) ?? '') + d);
  }
  for (const [width, d] of widths) ticks += `<path d="${d}" stroke-width="${width}"/>`;
  const charPx = narrow ? 6.2 : NAME_CHAR_PX;
  let names = '';
  for (const name of overviewNames(time.warp, time.extent, ovLen, HISTORICAL, charPx)) {
    const shift = name.anchor === 'start' ? 3 : name.anchor === 'end' ? -3 : 0;
    const a = angleOf(name.day) + shift / (arc.r - OVD);
    const [x, y] = at(arc, a, -OVD + 6.5);
    names += `<text text-anchor="${name.anchor}" transform="translate(${f(x)} ${f(y)}) rotate(${f(deg(a), 2)})">${escapeText(name.text)}</text>`;
  }
  return (
    `<g class="xr-ov-shadow" transform="translate(0.5 0.8)">${ticks}${names}</g>` +
    `<g class="xr-ov-gilt">${ticks}${names}</g>`
  );
}

/**
 * What moves over the stock with the date: the lens on the overview over the tape's days, its
 * hairline at the date, the return point, the bookmark on the overview's top edge, the rider's
 * hairline, and the tape's end brackets, the lens's twins.
 */
export function liveSvg(
  layout: Layout,
  time: ExploreTime,
  pin: number | null,
  riderU: number | null,
): string {
  const { arc, ovLen } = layout;
  const { u0, u1, u } = lensExtent(time.warp, time.day, time.spanDays, ovLen);
  const aOf = (v: number) => (2 * v - 1) * arc.reach;
  const [aL, aR, aC] = [aOf(u0), aOf(u1), aOf(u)];
  const bracket = (a: number, dir: 1 | -1, inner: number, outer: number, foot: number) => {
    const e = (dir * foot) / arc.r;
    const [x0, y0] = at(arc, a + e, outer);
    const [x1, y1] = at(arc, a, outer);
    const [x2, y2] = at(arc, a, inner);
    const [x3, y3] = at(arc, a + e, inner);
    return `M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}L${f(x3)} ${f(y3)}`;
  };
  const lensBrackets = bracket(aL, 1, -OVD + 1.5, -1.2, 4) + bracket(aR, -1, -OVD + 1.5, -1.2, 4);
  const tapeBrackets =
    bracket(-arc.reach, 1, 2, TAPE_TOP - 1, 5) + bracket(arc.reach, -1, 2, TAPE_TOP - 1, 5);
  let out =
    `<path class="xr-lens" d="${sector(arc, aL, aR, -OVD + 0.6, -0.6)}"/>` +
    `<path class="xr-lens-rule" d="${along(arc, aL, aR, -1.4)}"/>` +
    `<g class="xr-brackets"><path class="xr-bracket-shadow" d="${lensBrackets}${tapeBrackets}" transform="translate(0.5 0.8)"/>` +
    `<path class="xr-bracket" d="${lensBrackets}${tapeBrackets}"/></g>` +
    `<path class="xr-lens-hair" d="${radial(arc, aC, -1.6, -OVD + 2.5)}"/>`;
  const [dx, dy] = at(arc, aC, -OVD + 2.6);
  out += `<circle class="xr-lens-dot" cx="${f(dx)}" cy="${f(dy)}" r="1.5"/>`;
  const back = time.returnDay;
  if (back !== null) {
    const [x, y] = at(arc, aOf(time.warp.u(back)), -OVD / 2);
    out += `<g class="xr-return"><circle cx="${f(x)}" cy="${f(y)}" r="3.6"/><circle class="xr-return-core" cx="${f(x)}" cy="${f(y)}" r="1"/></g>`;
  }
  if (pin !== null)
    out += `<g class="xr-bookmark">${lozenge(arc, aOf(time.warp.u(pin)), -1.8, 3)}</g>`;
  if (riderU !== null)
    out += `<path class="xr-rider-hair" d="${radial(arc, aOf(riderU), -1, -OVD + 1)}"/>`;
  return out;
}

/**
 * The glass fixed at the crown over the now window, a tenth of the tape: a pale pane whose fine
 * gilt edges are held by small brass clips on the lip and a riveted clip at the tape's foot, a
 * blued hairline down through the tape, and the garnet jewel in its beaded bezel on the lip.
 */
export function glassSvg(layout: Layout): string {
  const { arc, glass: g } = layout;
  let out = `<path d="${sector(arc, -g, g, 1, TAPE_TOP)}" fill="url(#xr-glass-fill)"/>`;
  out += `<path d="${along(arc, -g, g, TAPE_TOP - 2.2)}" stroke="rgb(255 250 235 / 0.5)" stroke-width="1" fill="none"/>`;
  for (const side of [-1, 1]) {
    const a = side * g;
    out += `<path d="${radial(arc, a, 1, TAPE_TOP)}" stroke="rgb(20 12 4 / 0.55)" stroke-width="1.6"/>`;
    out += `<path d="${radial(arc, a, 1, TAPE_TOP)}" stroke="rgb(255 226 170 / 0.85)" stroke-width="0.7"/>`;
    const w = 2.8 / arc.r;
    out += `<path d="${sector(arc, a - w, a + w, TAPE_TOP - 2, LIP_TOP + 1.5)}" fill="url(#rc-frame-fill)" stroke="#1a1006" stroke-width="0.7" filter="url(#rc-lit-plate)"/>`;
    out += `<path d="${sector(arc, a - w * 1.2, a + w * 1.2, -2.5, 3.5)}" fill="url(#rc-frame-fill)" stroke="#1a1006" stroke-width="0.7" filter="url(#rc-lit-plate)"/>`;
    const [rx, ry] = at(arc, a, 0.5);
    out += `<circle cx="${f(rx)}" cy="${f(ry)}" r="1.25" fill="url(#rc-bezel)" stroke="#1a1006" stroke-width="0.4"/>`;
  }
  const [x0, y0] = at(arc, 0, JEWEL_AT - 5);
  const [x1, y1] = at(arc, 0, 1.2);
  out +=
    `<path d="M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}" stroke="#000" stroke-opacity="0.45" stroke-width="1.8" transform="translate(0.7 1)"/>` +
    `<path d="M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}" stroke="url(#rc-steel)" stroke-width="1.2"/>` +
    `<path d="M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}" stroke="#7f9ccc" stroke-width="0.4" opacity="0.8"/>`;
  const [jx, jy] = at(arc, 0, JEWEL_AT);
  out += `<g class="xr-jewel" transform="translate(${f(jx)} ${f(jy)})">
<circle r="10" fill="url(#rc-garnet-glow)"/>
<circle r="6.6" fill="#1c1208" opacity="0.6" transform="translate(0.8 1.2)"/>
<circle r="${JEWEL_R}" fill="url(#rc-bezel)" stroke="#2a1a0a" stroke-width="0.7"/>
<circle r="5.1" fill="none" stroke="rgb(40 25 8 / 0.6)" stroke-width="1" stroke-dasharray="0.8 1.1"/>
<circle r="4.2" fill="url(#rc-garnet)" stroke="#2a0710" stroke-width="0.5"/>
<ellipse cx="-1.5" cy="-1.8" rx="1.5" ry="0.85" fill="#fff6f0" opacity="0.9" transform="rotate(-38 -1.5 -1.8)"/>
</g>`;
  return out;
}

/** A reel's face over its turning knurl: bezel, domed face, hub, and the lamp's sheen. */
export function reelFaceSvg(r: number): string {
  const face = r * 0.64;
  return `<circle r="${f(r - 2.3)}" fill="#1a1007"/>
<circle r="${f(r - 2.8)}" fill="url(#rc-bezel)" filter="url(#rc-lit-teeth)"/>
<circle r="${f(face + 0.6)}" fill="#24170a"/>
<circle r="${f(face)}" fill="url(#rc-face-fill)" filter="url(#xr-lit-reel)"/>
<circle r="${f(face * 0.62)}" fill="none" stroke="rgb(60 40 15 / 0.28)" stroke-width="0.5"/>
<circle r="${f(r * 0.2)}" fill="#1a1007"/><circle r="${f(r * 0.13)}" fill="url(#rc-bezel)"/>
<ellipse cx="${f(-face * 0.3)}" cy="${f(-face * 0.36)}" rx="${f(face * 0.44)}" ry="${f(face * 0.24)}" fill="rgb(255 238 200 / 0.26)" transform="rotate(-40 ${f(-face * 0.3)} ${f(-face * 0.36)})"/>
<path d="M${f(-r * 0.9)} ${f(-r * 0.2)}A${f(r * 0.92)} ${f(r * 0.92)} 0 0 1 ${f(-r * 0.2)} ${f(-r * 0.9)}" stroke="rgb(255 236 190 / 0.32)" stroke-width="${f(r * 0.1)}" fill="none" stroke-linecap="round"/>`;
}

/** The plaque: a dark bronze frame round a raised face of bright brass, over its tab. */
export function plateSvg(w: number, h: number): string {
  return `<path d="${cartouche(2, 4, w, h, 6, TAB)}" fill="#000" opacity="0.7" filter="url(#rc-soft)"/>
<path d="${cartouche(0, 0, w, h, 6, TAB)}" fill="url(#rc-frame-fill)" stroke="#160d05" stroke-width="1" filter="url(#rc-lit-plate)"/>
<path d="${cartouche(3, 3, w - 6, h - 6, 4.5, 0)}" fill="#1c1208"/>
<path class="xr-plate-face" d="${cartouche(3.5, 3.5, w - 7, h - 7, 4, 0)}" fill="url(#rc-plate-fill)" filter="url(#rc-lit-plate)"/>
<path class="xr-plate-inset" d="${cartouche(4.5, 4.5, w - 9, h - 9, 3.5, 0)}" fill="#150d06"/>
<path class="xr-plate-rule" d="${cartouche(6.5, 6.5, w - 13, h - 13, 2.5, 0)}" fill="none" stroke="rgb(255 244 210 / 0.5)" stroke-width="0.7" transform="translate(0.5 0.8)"/>
<path class="xr-plate-rule" d="${cartouche(6.5, 6.5, w - 13, h - 13, 2.5, 0)}" fill="none" stroke="rgb(58 38 14 / 0.6)" stroke-width="0.7"/>`;
}

/** The canvas's vignette laid over the stock, so its ends darken as the view's do. */
export function finishSvg(layout: Layout): string {
  const { arc } = layout;
  const vh = innerHeight;
  const stops: string[] = [];
  for (let k = 0; k <= 10; k += 1) {
    const r = LENS.from + ((LENS.to - LENS.from) * k) / 10;
    const dark = 1 - vignetteAt(r);
    stops.push(
      `<stop offset="${(r / LENS.to).toFixed(3)}" stop-color="#000" stop-opacity="${dark.toFixed(3)}"/>`,
    );
  }
  return `<defs><radialGradient id="xr-vignette" gradientUnits="userSpaceOnUse" cx="${f(arc.cx)}" cy="${f(RULER_H - vh / 2)}" r="${f(LENS.to * vh)}">${stops.join('')}</radialGradient></defs>
<path d="${sector(arc, -arc.end - 1 / arc.r, arc.end + 1 / arc.r, -OVD, LIP_TOP)}" fill="url(#xr-vignette)"/>`;
}

/** The canvas's vignette as a brightness, `r` view heights from the view's center. */
export function vignetteAt(r: number): number {
  const t = Math.min(1, Math.max(0, (r - LENS.from) / (LENS.to - LENS.from)));
  const v = 1 - t * t * (3 - 2 * t);
  return 1 - VIGNETTE + VIGNETTE * v;
}

/** The vignette's brightness at a point of the ruler's box, for a part's --shade. */
export function shadeAt(x: number, y: number): string {
  const vy = innerHeight - RULER_H + y;
  const r = Math.hypot((x - innerWidth / 2) / innerHeight, vy / innerHeight - 0.5);
  return vignetteAt(r).toFixed(2);
}

export function setShade(element: HTMLElement, shade: string): void {
  if (element.style.getPropertyValue('--shade') !== shade)
    element.style.setProperty('--shade', shade);
}
