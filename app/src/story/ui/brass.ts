// The time rulers' brass, shared by the story walks' ruler (rulerCraft.ts), Explore's
// (explore/timeRuler.ts), the sound knob and the folds' knobs: the filter that lights a flat shape
// as metal under the museum's lamp, the gradients every part shares, the knurled knobs, wheels and
// teeth, the plaque, its levers and the garnet playhead, and engraved and gilt lines.
import { KEY_LAMP, KEY_LAMP_CSS } from '../../scene/lens';
import { svg } from './dom';
import { BAND, f, KNOB_R } from './rulerScale';

/** The plaque: its size, the tab under its middle, and its levers. */
export const PLATE_W = 150;
export const PLATE_H = 46;
export const PLATE_TAB = 6;
export const LEVER_W = 44;
export const LEVER_H = 36;
/**
 * The jewel's center, as a radial offset: the jewel hangs from the plaque over the upper row,
 * clear of the lower, and its needle runs down to the band's foot.
 */
export const JEWEL_AT = -1;
const NEEDLE_TIP = JEWEL_AT + BAND + 1;

/**
 * The key lamp as polished brass reflects it: metal tints its own highlights, so they roll off
 * warm, as the globe's do under the canvas's tone mapping, instead of clipping to lemon white.
 */
const BRASS_REFLECTANCE = [0.95, 0.86, 0.68];
const SHINE = BRASS_REFLECTANCE.map((reflects, i) =>
  Math.round(((KEY_LAMP >> (16 - 8 * i)) & 255) * reflects),
);
const SHINE_CSS = `rgb(${SHINE.join(' ')})`;

/** A gilt inlay path over its shadow, a hair down and right. */
export function gilt(className: string): SVGPathElement[] {
  return [
    svg('path', { class: `${className} rc-gilt-shadow`, transform: 'translate(0.6 0.9)' }),
    svg('path', { class: `${className} rc-gilt` }),
  ];
}

/** A line of text engraved in `parent` at (x, y): the lit lip of the cut, then the cut. */
export function engraved(
  parent: SVGSVGElement,
  className: string,
  x: number,
  y: number,
): SVGTextElement[] {
  const spot = { x, y, 'text-anchor': 'middle' };
  const lip = svg('text', {
    ...spot,
    class: `${className} rc-cut-lip`,
    transform: 'translate(0.6 0.9)',
  });
  const cut = svg('text', { ...spot, class: `${className} rc-cut` });
  parent.append(lip, cut);
  return [lip, cut];
}

export function setEngraved(lines: SVGTextElement[] | undefined, text: string): void {
  for (const line of lines ?? []) line.textContent = text;
}

/**
 * A small knob's body, `r` px in radius, from the ruler's knobs' parts: the toothed rim in the
 * lamp's light, and the face with its bezel, turned rings and sheen, its rim cut deeper and its
 * teeth fewer so they read at the size. It carries its own gradients and filters, named from
 * `id`, so it stands away from the ruler too (the sound knob, in the walk and the Sound Cabinet).
 */
export function smallKnob(id: string, r: number): SVGSVGElement {
  const face = r - 6.2;
  const s = r / KNOB_R;
  const body = svg('svg', { viewBox: `${-r} ${-r} ${2 * r} ${2 * r}`, 'aria-hidden': 'true' });
  const rings = [0.86, 0.76, 0.65, 0.54, 0.43].map((k) => `<circle r="${f(k * face)}"/>`).join('');
  body.innerHTML = `<defs>${knobGradients(id)}
<linearGradient id="${id}-knurl" gradientUnits="userSpaceOnUse" x1="${f(-0.76 * r)}" y1="${f(-0.76 * r)}" x2="${f(0.76 * r)}" y2="${f(0.76 * r)}">
  <stop offset="0" stop-color="#f2d596"/><stop offset="0.45" stop-color="#b08642"/><stop offset="1" stop-color="#4a3416"/>
</linearGradient>
${brassFilter(`${id}-lit-teeth`, { bevel: 0.6, relief: 2.5, texture: '0.5', amount: 0.05, shine: 0.6, bloom: 0.4 })}
${brassFilter(`${id}-lit-dome`, { bevel: 2.5, relief: 4, texture: '0.08', amount: 0.08, bloom: 0.45, patina: 0.15 })}
<filter id="${id}-soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${f(4 * s)}"/></filter>
</defs>
<path d="${teeth(48, r - 2.5, r, 0.2, 0.55)}" fill="url(#${id}-knurl)" stroke="#1c1207" stroke-width="0.4"/>
<circle r="${f(r - 2.9)}" fill="#1a1007"/>
<circle r="${f(r - 3.4)}" fill="url(#${id}-bezel)" filter="url(#${id}-lit-teeth)"/>
<circle r="${f(face + 0.4)}" fill="#24170a"/>
<circle r="${f(face)}" fill="url(#${id}-face-fill)" filter="url(#${id}-lit-dome)"/>
<g fill="none" stroke="rgb(60 40 15 / 0.22)" stroke-width="0.35">${rings}</g>
<ellipse cx="${f(-13 * s)}" cy="${f(-15 * s)}" rx="${f(16 * s)}" ry="${f(9 * s)}" fill="url(#${id}-sheen)" transform="rotate(-40 ${f(-13 * s)} ${f(-15 * s)})"/>
<path d="M${f(-45 * s)} ${f(-10 * s)} A${f(46 * s)} ${f(46 * s)} 0 0 1 ${f(-10 * s)} ${f(-45 * s)}" stroke="rgb(255 236 190 / 0.3)" stroke-width="${f(5 * s)}" fill="none" stroke-linecap="round" filter="url(#${id}-soft)"/>`;
  return body;
}

/**
 * A toothed wheel's outline: `n` teeth between radii r0 and r1, each rising over `rise` of its
 * pitch and flat on top for `top` of what is left.
 */
export function teeth(n: number, r0: number, r1: number, rise: number, top: number): string {
  const points: string[] = [];
  const step = (2 * Math.PI) / n;
  const flat = top * (1 - 2 * rise);
  for (let k = 0; k < n; k += 1) {
    for (const [share, r] of [
      [0, r0],
      [rise, r1],
      [rise + flat, r1],
      [2 * rise + flat, r0],
    ] as const) {
      const a = (k + share) * step;
      points.push(`${f(r * Math.sin(a))} ${f(-r * Math.cos(a))}`);
    }
  }
  return `M${points.join('L')}Z`;
}

export function circlePath(r: number): string {
  return `M${f(r)} 0A${f(r)} ${f(r)} 0 1 0 ${f(-r)} 0A${f(r)} ${f(r)} 0 1 0 ${f(r)} 0Z`;
}

/** A spoked wheel of radius r with n teeth, shaded alike all round so it can turn under the lamp. */
export function gearSvg(r: number, n: number): string {
  const root = r - Math.max(4, r * 0.1);
  const rim = root * 0.78;
  const hub = Math.max(4, r * 0.2);
  const spokes = r > 30 ? 5 : 4;
  const w = r > 30 ? 4.5 : 2.5;
  let spokePath = '';
  for (let k = 0; k < spokes; k += 1) {
    const a = (k * 2 * Math.PI) / spokes;
    const [s, c] = [Math.sin(a), Math.cos(a)];
    const p = (out: number, side: number) => `${f(out * s + side * c)} ${f(-out * c + side * s)}`;
    spokePath += `M${p(hub - 1, -w)}L${p(rim + 1, -w)}L${p(rim + 1, w)}L${p(hub - 1, w)}Z`;
  }
  return (
    `<g fill="url(#rc-gear-fill)" stroke="#170e05" stroke-width="0.8">` +
    `<path fill-rule="evenodd" d="${teeth(n, root, r, 0.16, 0.5)}${circlePath(rim)}"/>` +
    `<path d="${spokePath}${circlePath(hub)}"/></g>` +
    `<circle r="${f(hub * 0.45)}" fill="#170e05"/>` +
    `<circle r="${f(root - 1.5)}" fill="none" stroke="rgb(240 205 140 / 0.2)" stroke-width="0.8"/>` +
    `<circle r="${f(rim + 1.5)}" fill="none" stroke="rgb(240 205 140 / 0.14)" stroke-width="0.8"/>`
  );
}

export interface FilterSpec {
  /** How far the shape's edge rounds off, px. */
  bevel: number;
  /** The height of that rounding, for the lighting. */
  relief: number;
  /** The surface's texture, as feTurbulence's baseFrequency, and how deep it is. */
  texture: string;
  amount: number;
  shine?: number;
  /** How much the brightest edges glow past the shape. */
  bloom?: number;
  /** How much low, cloudy tarnish darkens the brass. */
  patina?: number;
}

/**
 * A filter that lights a flat brass shape as raised metal under the lamp: the shape's alpha,
 * blurred by `bevel`, is its height, roughened by `texture`, lit from the upper left, diffusely
 * and with a highlight in the lamp's light as brass reflects it; a cloudy tarnish ages it, a
 * fine grain lies over it as over the canvas, and its brightest edges bloom past it a little.
 * The diffuse light saturates at 1 (flat brass shows its fill in the lamp's color), so slopes
 * facing the lamp get no brighter than the fill and only the brass-tinted highlight lifts them:
 * an overdriven red would clip ahead of the green and turn the highlights lemon.
 */
export function brassFilter(id: string, spec: FilterSpec): string {
  const { bevel, relief, texture, amount, shine = 1, bloom = 0.5, patina = 0 } = spec;
  const [k, b] = [2 * patina, 1 - 1.5 * patina];
  return `<filter id="${id}" x="-15%" y="-40%" width="130%" height="180%" color-interpolation-filters="sRGB">
<feGaussianBlur in="SourceAlpha" stdDeviation="${bevel}" result="hump"/>
<feTurbulence type="fractalNoise" baseFrequency="${texture}" numOctaves="2" seed="7" result="tex"/>
<feComposite in="tex" in2="hump" operator="arithmetic" k2="${amount}" k3="1" result="height"/>
<feDiffuseLighting in="height" surfaceScale="${relief}" diffuseConstant="1.31" lighting-color="#fff2e0" result="diffuse"><feDistantLight azimuth="225" elevation="50"/></feDiffuseLighting>
<feSpecularLighting in="height" surfaceScale="${relief}" specularConstant="${shine}" specularExponent="16" lighting-color="${SHINE_CSS}" result="spec"><feDistantLight azimuth="225" elevation="35"/></feSpecularLighting>
<feComposite in="SourceGraphic" in2="diffuse" operator="arithmetic" k1="1" result="lit"/>
<feTurbulence type="fractalNoise" baseFrequency="0.006 0.03" numOctaves="3" seed="21" result="cloud"/>
<feColorMatrix in="cloud" type="matrix" values="${k} 0 0 0 ${b} ${k} 0 0 0 ${b} ${k} 0 0 0 ${b} 0 0 0 0 1" result="tarnish"/>
<feBlend in="lit" in2="tarnish" mode="multiply" result="aged"/>
<feComposite in="spec" in2="SourceAlpha" operator="in" result="shine"/>
<feComposite in="aged" in2="shine" operator="arithmetic" k2="1" k3="0.45" result="metal"/>
<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="1" seed="3" result="n"/>
<feColorMatrix in="n" type="matrix" values="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 0 0 0 1" result="grain"/>
<feComposite in="grain" in2="metal" operator="arithmetic" k2="0.16" k3="1" k4="-0.08" result="grained"/>
<feComposite in="grained" in2="SourceAlpha" operator="in" result="body"/>
<feGaussianBlur in="shine" stdDeviation="2.4" result="glowBlur"/>
<feComponentTransfer in="glowBlur" result="glow"><feFuncA type="linear" slope="${bloom}"/></feComponentTransfer>
<feMerge><feMergeNode in="glow"/><feMergeNode in="body"/></feMerge>
</filter>`;
}

/** The knobs' bezel, face and lamp's sheen, as `<prefix>-bezel`, `-face-fill` and `-sheen`. */
export function knobGradients(prefix: string): string {
  return `<linearGradient id="${prefix}-bezel" x1="0" x2="1" y1="0" y2="1">
  <stop offset="0" stop-color="#e8c283"/><stop offset="0.5" stop-color="#b88e4b"/>
  <stop offset="1" stop-color="#5a411f"/>
</linearGradient>
<radialGradient id="${prefix}-face-fill" cx="0.4" cy="0.36" r="0.75">
  <stop offset="0" stop-color="#d8ae63"/><stop offset="0.55" stop-color="#b2833d"/>
  <stop offset="1" stop-color="#6b4a21"/>
</radialGradient>
<radialGradient id="${prefix}-sheen" r="0.5">
  <stop offset="0" stop-color="${KEY_LAMP_CSS}" stop-opacity="0.3"/><stop offset="1" stop-color="${KEY_LAMP_CSS}" stop-opacity="0"/>
</radialGradient>`;
}

/** Gradients and filters every part of the ruler shares, defined once in the body. */
export function sharedDefs(): string {
  return `<defs>
<linearGradient id="rc-band-fill" x1="0" x2="1" y1="0" y2="0">
  <stop offset="0" stop-color="#6a4a20"/><stop offset="0.2" stop-color="#94703a"/>
  <stop offset="0.34" stop-color="#a8804a"/><stop offset="0.6" stop-color="#8a6534"/>
  <stop offset="1" stop-color="#5a3f1c"/>
</linearGradient>
<linearGradient id="rc-rail-fill" x1="0" x2="1" y1="0" y2="0">
  <stop offset="0" stop-color="#4f3a1c"/><stop offset="0.3" stop-color="#7a5a2d"/>
  <stop offset="0.6" stop-color="#694c24"/><stop offset="1" stop-color="#46331a"/>
</linearGradient>
<linearGradient id="rc-base-fill" x1="0" x2="1" y1="0" y2="0">
  <stop offset="0" stop-color="#1c140b"/><stop offset="0.3" stop-color="#3a2a16"/>
  <stop offset="0.55" stop-color="#30230f"/><stop offset="1" stop-color="#18110a"/>
</linearGradient>
<linearGradient id="rc-lip-fill" x1="0" x2="1" y1="0" y2="0">
  <stop offset="0" stop-color="#b58843"/><stop offset="0.3" stop-color="#e6bd7a"/>
  <stop offset="0.65" stop-color="#d2a55a"/><stop offset="1" stop-color="#8e6830"/>
</linearGradient>
<linearGradient id="rc-plate-fill" x1="0" x2="0.35" y1="0" y2="1">
  <stop offset="0" stop-color="#ecc980"/><stop offset="0.5" stop-color="#cfa054"/>
  <stop offset="1" stop-color="#9c7234"/>
</linearGradient>
<linearGradient id="rc-frame-fill" x1="0" x2="0.3" y1="0" y2="1">
  <stop offset="0" stop-color="#a47938"/><stop offset="0.5" stop-color="#6e4d22"/>
  <stop offset="1" stop-color="#3f2a11"/>
</linearGradient>
${knobGradients('rc')}
<radialGradient id="rc-gear-fill" cx="0.5" cy="0.5" r="0.5">
  <stop offset="0.5" stop-color="#5a4121"/><stop offset="0.86" stop-color="#76582c"/>
  <stop offset="1" stop-color="#3b2a14"/>
</radialGradient>
<radialGradient id="rc-garnet" cx="0.38" cy="0.34" r="0.7">
  <stop offset="0" stop-color="#ffc2ca"/><stop offset="0.18" stop-color="#e0485e"/>
  <stop offset="0.5" stop-color="#9c1c31"/><stop offset="1" stop-color="#380611"/>
</radialGradient>
<radialGradient id="rc-garnet-glow" r="0.5">
  <stop offset="0" stop-color="rgb(255 90 100 / 0.5)"/><stop offset="1" stop-color="rgb(200 40 60 / 0)"/>
</radialGradient>
<linearGradient id="rc-steel" x1="0" x2="1" y1="0" y2="0">
  <stop offset="0" stop-color="#141c30"/><stop offset="0.45" stop-color="#6f8cc0"/>
  <stop offset="1" stop-color="#1c2640"/>
</linearGradient>
${brassFilter('rc-lit-band', { bevel: 6, relief: 4, texture: '0.005 0.8', amount: 0.06, bloom: 0.5, patina: 0.4 })}
${brassFilter('rc-lit-rail', { bevel: 3, relief: 3, texture: '0.11', amount: 0.3, shine: 0.6, bloom: 0.2, patina: 0.3 })}
${brassFilter('rc-lit-base', { bevel: 3, relief: 2.5, texture: '0.05', amount: 0.1, shine: 0.35, bloom: 0.1, patina: 0.3 })}
${brassFilter('rc-lit-lip', { bevel: 0.8, relief: 2, texture: '0.01 0.5', amount: 0.03, shine: 0.6, bloom: 0.9 })}
${brassFilter('rc-lit-teeth', { bevel: 1, relief: 2.5, texture: '0.5', amount: 0.05, shine: 0.6, bloom: 0.4 })}
${brassFilter('rc-lit-dome', { bevel: 8, relief: 5, texture: '0.08', amount: 0.08, bloom: 0.45, patina: 0.15 })}
${brassFilter('rc-lit-plate', { bevel: 2, relief: 3, texture: '0.01 0.6', amount: 0.05, shine: 0.6, bloom: 0.6, patina: 0.1 })}
<filter id="rc-soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter>
</defs>`;
}

export const KNOB_FACE_SVG = `
<circle r="${KNOB_R - 4}" fill="#1a1007"/>
<circle r="${KNOB_R - 5.5}" fill="url(#rc-bezel)" filter="url(#rc-lit-teeth)"/>
<circle r="${KNOB_R - 12}" fill="#24170a"/>
<circle r="${KNOB_R - 13}" fill="url(#rc-face-fill)" filter="url(#rc-lit-dome)"/>
<g fill="none" stroke="rgb(60 40 15 / 0.22)" stroke-width="0.5">
  <circle r="32"/><circle r="28"/><circle r="24"/><circle r="20"/><circle r="16"/>
</g>
<ellipse cx="-13" cy="-15" rx="16" ry="9" fill="url(#rc-sheen)" transform="rotate(-40 -13 -15)"/>
<path d="M-45 -10 A46 46 0 0 1 -10 -45" stroke="rgb(255 236 190 / 0.3)" stroke-width="5" fill="none" stroke-linecap="round" filter="url(#rc-soft)"/>`;

/**
 * The playhead: a garnet in a beaded bezel, hanging from the plaque, and a blued steel needle
 * from it down to the band's foot. Its y runs down the band, toward the circle's center.
 */
export const JEWEL_SVG = `<svg viewBox="-16 -16 32 ${f(NEEDLE_TIP + 20)}" width="32" height="${f(NEEDLE_TIP + 20)}" aria-hidden="true">
<circle r="13" fill="url(#rc-garnet-glow)"/>
<path d="M-1.5 5.5 L1.5 5.5 L0.45 ${f(NEEDLE_TIP)} L-0.45 ${f(NEEDLE_TIP)} Z" fill="#000" opacity="0.45" transform="translate(0.8 1.2)"/>
<path d="M-1.5 5.5 L1.5 5.5 L0.45 ${f(NEEDLE_TIP)} L-0.45 ${f(NEEDLE_TIP)} Z" fill="url(#rc-steel)" stroke="#0b1020" stroke-width="0.4"/>
<circle r="8.9" fill="#1c1208" transform="translate(1 1.6)" opacity="0.6"/>
<circle r="8.5" fill="url(#rc-bezel)" stroke="#2a1a0a" stroke-width="0.8"/>
<circle r="7" fill="none" stroke="rgb(40 25 8 / 0.6)" stroke-width="1.3" stroke-dasharray="1 1.4"/>
<circle r="5.8" fill="url(#rc-garnet)" stroke="#2a0710" stroke-width="0.6"/>
<path d="M-5.7 0 L0 -5.7 L5.7 0 L0 5.7 Z M-2.9 -2.9 L2.9 2.9 M2.9 -2.9 L-2.9 2.9" fill="none" stroke="rgb(255 200 210 / 0.16)" stroke-width="0.6"/>
<ellipse cx="-2.1" cy="-2.5" rx="2" ry="1.15" fill="#fff6f0" opacity="0.92" transform="rotate(-38 -2.1 -2.5)"/>
<circle cx="2.5" cy="2.8" r="0.8" fill="#ffd9de" opacity="0.6"/>
</svg>`;

/** The plaque: a dark bronze frame round a raised face of bright brass, with an engraved border. */
export const PLATE_SVG = `
<path d="${cartouche(2, 4, PLATE_W, PLATE_H, 7, PLATE_TAB)}" fill="#000" opacity="0.8" filter="url(#rc-soft)"/>
<path d="${cartouche(0, 0, PLATE_W, PLATE_H, 7, PLATE_TAB)}" fill="url(#rc-frame-fill)" stroke="#160d05" stroke-width="1" filter="url(#rc-lit-plate)"/>
<path d="${cartouche(3.5, 3.5, PLATE_W - 7, PLATE_H - 7, 5, 0)}" fill="#1c1208"/>
<path d="${cartouche(4, 4, PLATE_W - 8, PLATE_H - 8, 4.5, 0)}" fill="url(#rc-plate-fill)" filter="url(#rc-lit-plate)"/>
<path d="${cartouche(7.5, 7.5, PLATE_W - 15, PLATE_H - 15, 3, 0)}" fill="none" stroke="rgb(255 244 210 / 0.55)" stroke-width="0.7" transform="translate(0.5 0.8)"/>
<path d="${cartouche(7.5, 7.5, PLATE_W - 15, PLATE_H - 15, 3, 0)}" fill="none" stroke="rgb(58 38 14 / 0.65)" stroke-width="0.7"/>`;

/** A lever beside the plaque, pointing back (-1) or on (1): a brass ear with a cut arrow and grip. */
export function leverSvg(side: -1 | 1): string {
  // Drawn pointing back, then mirrored point by point for Next, so the lamp lights both alike.
  const x = (v: number) => (side < 0 ? v : LEVER_W - v);
  const mid = LEVER_H / 2 - 1;
  const [top, foot] = [3, LEVER_H - 5];
  const shape =
    `M${x(LEVER_W)} ${top} H${x(17)} Q${x(13)} ${top} ${x(10)} ${top + 3} L${x(2)} ${mid}` +
    ` L${x(10)} ${foot - 3} Q${x(13)} ${foot} ${x(17)} ${foot} H${x(LEVER_W)} Z`;
  const arrow = `M${x(9)} ${mid} L${x(22)} ${mid - 8} V${mid + 8} Z`;
  const grip = `M${x(28)} ${mid - 8} V${mid + 8} M${x(32)} ${mid - 8} V${mid + 8}`;
  return `<svg viewBox="-1 -1 ${LEVER_W + 2} ${LEVER_H}" width="${LEVER_W + 2}" height="${LEVER_H}" aria-hidden="true">
<path d="${shape}" fill="#000" opacity="0.6" transform="translate(1 2)" filter="url(#rc-soft)"/>
<path d="${shape}" fill="url(#rc-plate-fill)" stroke="#3a2710" stroke-width="1" filter="url(#rc-lit-plate)"/>
<path d="${arrow}" class="rc-cut-lip" transform="translate(0.6 0.9)"/>
<path d="${arrow}" class="rc-niello"/>
<path d="${grip}" class="rc-cut-line"/>
</svg>`;
}

/**
 * A plaque's outline at (x, y), w by h, with corners cut in by quarter circles of radius n and a
 * tab of depth `tab` under its middle.
 */
export function cartouche(
  x: number,
  y: number,
  w: number,
  h: number,
  n: number,
  tab: number,
): string {
  const [r, b, m] = [x + w, y + h, x + w / 2];
  const foot = tab > 0 ? `H${m + tab * 1.4}L${m} ${b + tab}L${m - tab * 1.4} ${b}` : '';
  return (
    `M${x + n} ${y}H${r - n}A${n} ${n} 0 0 0 ${r} ${y + n}V${b - n}A${n} ${n} 0 0 0 ${r - n} ${b}` +
    `${foot}H${x + n}A${n} ${n} 0 0 0 ${x} ${b - n}V${y + n}A${n} ${n} 0 0 0 ${x + n} ${y}Z`
  );
}
