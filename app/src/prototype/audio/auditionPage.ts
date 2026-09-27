// The sound audition (prototype-audio.html, dev only): every sound in src/audio/ on one page for
// the owner's first listen, in the walk's materials (walkUi.css): dark cast brass drawers holding
// vellum slips, engraved small caps, brass plaques and knurled knobs. Begin is the gesture that
// unlocks audio. Then each voice, the Tambora bed with story time on a small ruler, and each cue
// play from their slips, each with its level, and Copy settings copies the mix as JSON to paste
// over src/audio/mix.ts. window.__sound serves scripts/renderSounds.ts, which renders every sound
// offline from this page.
import '@fontsource/libre-baskerville/400.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/400-italic.css';
import '@fontsource/source-serif-4/600.css';
import '../../story/ui/walkUi.css';
import './audition.css';
import storyText from '../../../../stories/tambora/story.md?raw';
import { rumbleLevel, tamboraBed, type Bed } from '../../audio/bed';
import { CUE_NAMES, startCue, type CueHandle, type CueName } from '../../audio/cues';
import { unlockSound, type SoundEngine } from '../../audio/engine';
import { mix as tunedMix, type Mix } from '../../audio/mix';
import { clunk, detent, whir, type DetentWeight, type Whir } from '../../audio/voices';
import { dayFromCivil, dayFromIso, formatDay } from '../../story/dates';
import { parseStory } from '../../story/story';
import { button, el, svg } from '../../story/ui/dom';
import { flight, scrub } from './demos';
import { render, TAKES, type Rendered } from './render';

declare global {
  interface Window {
    __sound?: {
      takes: string[];
      render(name: string): Promise<Rendered>;
    };
  }
}

const mix: Mix = structuredClone(tunedMix);
const story = parseStory(storyText);
const FIRST = dayFromIso('1815-01-01');
const LAST = dayFromIso('1817-12-31');

let engine: SoundEngine | undefined;

/** The live engine, unlocked by the press that asks for it. */
function sound(): SoundEngine {
  engine = unlockSound(mix);
  return engine;
}

/** Levels changed: the engine and whatever is playing take them. */
const remix: (() => void)[] = [() => engine?.setMix(mix)];
function mixChanged(): void {
  for (const take of remix) take();
}

const root = el('div', 'wu au is-locked');
const drawers = el('main', 'au-drawers');
drawers.inert = true;
drawers.append(mechanismDrawer(), bedDrawer(), cuesDrawer());
const head = el('header', 'au-head');
head.append(mark(), consolePanel());
root.append(head, drawers);
document.body.append(root);

window.__sound = {
  takes: Object.keys(TAKES),
  render: (name) => render(name, mix),
};

function mark(): HTMLElement {
  const header = el('div', 'wu-mark');
  const rule = el('div', 'wu-mark-rule');
  rule.append(el('span'), el('i', undefined, '✦'), el('span'));
  header.append(
    el('div', 'wu-mark-word', 'WANDER'),
    rule,
    el('div', 'wu-mark-sub', 'THE SOUND CABINET'),
  );
  return header;
}

/** Begin, the master level, mute and Copy settings, on a dark brass console. */
function consolePanel(): HTMLElement {
  const panel = el('section', 'au-console wu-brass wu-lit');

  const begin = knob('au-begin', 'Begin', beginFace());
  const beginLabel = el('span', 'au-knob-label', 'Begin');
  begin.addEventListener('click', () => {
    sound();
    root.classList.remove('is-locked');
    drawers.inert = false;
    begin.classList.add('is-running');
    beginLabel.textContent = 'Sounding';
  });

  const mute = knob('au-mute', 'Mute', speakerFace());
  const muteLabel = el('span', 'au-knob-label', 'Sound');
  mute.setAttribute('aria-pressed', 'false');
  mute.addEventListener('click', () => {
    const muted = !(engine?.muted ?? false);
    sound().setMuted(muted);
    mute.setAttribute('aria-pressed', String(muted));
    mute.classList.toggle('is-muted', muted);
    muteLabel.textContent = muted ? 'Muted' : 'Sound';
  });

  const master = level(
    'Master',
    () => mix.master,
    (db) => (mix.master = db),
    -40,
    6,
  );
  master.classList.add('on-brass');

  const copy = plaque('Copy settings', () => void copySettings(copy));
  copy.classList.add('au-copy');

  panel.append(
    stack(begin, beginLabel),
    el('span', 'au-divider'),
    master,
    stack(mute, muteLabel),
    el('span', 'au-divider'),
    copy,
  );
  return panel;
}

/** The instrument's voices: detents, the scrub, the clunk and the whir. */
function mechanismDrawer(): HTMLElement {
  const drawer = drawerOf('The mechanism', 'ui');
  const voice = (weight: DetentWeight, what: string) =>
    slip(`Detent · ${weight}`, what, [
      trigger('Sound', (jewel) => {
        detent(sound(), weight);
        flash(jewel);
      }),
    ]);
  const detentDay = voice('day', 'The ruler passes a day');
  detentDay.append(levelOf('detentDay'));
  const detentMonth = voice('month', 'The ruler passes a month');
  detentMonth.append(levelOf('detentMonth'));
  const detentYear = voice('year', 'The ruler passes a year');
  detentYear.append(levelOf('detentYear'));

  /** The ruler dragged across `span` and back, marked by `unit`, over about `seconds`. */
  const scrubSlip = (
    name: string,
    line: string,
    span: [string, string],
    unit: 'month' | 'day',
    seconds: number,
  ) => {
    const [from, to] = [dayFromIso(span[0]), dayFromIso(span[1])];
    return slip(name, line, [
      trigger('Forward', (jewel) => {
        const e = sound();
        scrub(e, from, to, seconds, e.soon(), unit);
        flash(jewel, seconds * 1000);
      }),
      trigger('Back', (jewel) => {
        const e = sound();
        scrub(e, to, from, seconds * 0.8, e.soon(), unit);
        flash(jewel, seconds * 800);
      }),
    ]);
  };
  const scrubMonths = scrubSlip(
    'Scrub · months',
    'Three years dragged past the playhead',
    ['1815-01-01', '1818-01-01'],
    'month',
    2,
  );
  // Fast enough that the pacer holds the days to its limit through the middle of the drag.
  const scrubDays = scrubSlip(
    'Scrub · days',
    'A month dragged past the playhead, day by day',
    ['1815-03-20', '1815-04-20'],
    'day',
    1.4,
  );

  const clunkSlip = slip('Clunk', 'A beat changes', [
    trigger('Sound', (jewel) => {
      clunk(sound());
      flash(jewel);
    }),
  ]);
  clunkSlip.append(levelOf('clunk'));

  let held: Whir | undefined;
  let pace = 0.6;
  const whirSlip = slip('Whir', 'A camera flight', [
    trigger('Fly', (jewel) => {
      const e = sound();
      flight(e, 4, e.soon());
      flash(jewel, 4000);
    }),
    trigger('Hold', (jewel, press) => {
      if (held) {
        held.stop();
        held = undefined;
      } else {
        held = whir(sound());
        held.setPace(pace);
      }
      jewel.classList.toggle('is-lit', held !== undefined);
      press.textContent = held ? 'Release' : 'Hold';
    }),
  ]);
  const paceRow = level(
    'Pace',
    () => pace,
    (p) => {
      pace = p;
      held?.setPace(p);
    },
    0,
    1,
    (p) => p.toFixed(2),
  );
  whirSlip.append(paceRow, levelOf('whir'));
  remix.push(() => held?.setPace(pace));

  drawer.append(detentDay, detentMonth, detentYear, scrubMonths, scrubDays, clunkSlip, whirSlip);
  return drawer;
}

/** The Tambora bed: start and stop, story time on a small ruler, the rumble's chart and levels. */
function bedDrawer(): HTMLElement {
  const drawer = drawerOf('The Tambora bed', 'bed');
  let bed: Bed | undefined;
  let day = dayFromIso('1815-04-11');

  const bedSlip = slip('Bed', 'Museum room tone, and the mountain under it', [
    trigger('Start', (jewel) => {
      bed ??= tamboraBed(sound(), day);
      jewel.classList.add('is-lit');
    }),
    trigger('Stop', (jewel) => {
      bed?.stop();
      bed = undefined;
      jewel.classList.remove('is-lit');
    }),
  ]);
  remix.push(() => bed?.setMix(mix));

  const ruler = el('div', 'au-ruler wu-brass');
  const plate = el('div', 'au-plate');
  const plateText = el('span', 'au-plate-text');
  plate.append(plateText);
  const rail = el('div', 'au-rail');
  for (let year = 1815; year <= 1817; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const tick = el('span', month === 1 ? 'au-tick is-year' : 'au-tick');
      tick.style.setProperty('--p', String(share(dayFromCivil({ year, month, day: 1 }))));
      rail.append(tick);
    }
    const label = el('span', 'au-year', String(year));
    label.style.setProperty('--p', String(share(dayFromCivil({ year, month: 7, day: 1 }))));
    rail.append(label);
  }
  const eruption = el('span', 'au-eruption');
  eruption.style.setProperty('--p', String(share(dayFromIso('1815-04-10'))));
  eruption.title = 'The eruption, 10 April 1815';
  rail.append(eruption, plate);
  const input = el('input', 'au-day');
  input.type = 'range';
  input.min = String(FIRST);
  input.max = String(LAST);
  input.step = '1';
  input.value = String(day);
  input.setAttribute('aria-label', 'Story day');
  // The moments rendered to files, to hear them here.
  const moments = el('div', 'au-moments');
  for (const [label, iso] of [
    ['1 Mar 1815', '1815-03-01'],
    ['11 Apr 1815', '1815-04-11'],
    ['1 Jul 1816', '1816-07-01'],
    ['31 Dec 1817', '1817-12-31'],
  ] as const) {
    moments.append(plaque(label, () => setDay(dayFromIso(iso))));
  }
  ruler.append(rail, input, moments);

  const chart = rumbleChart();
  const setDay = (next: number) => {
    day = next;
    input.value = String(day);
    bed?.setDay(day);
    plate.style.setProperty('--p', String(share(day)));
    plateText.textContent = formatDay(day);
    input.setAttribute('aria-valuetext', formatDay(day));
    chart.set(day);
  };
  input.addEventListener('input', () => setDay(Number(input.value)));
  setDay(day);

  const levels = el('div', 'au-slip');
  levels.append(
    level(
      'Room',
      () => mix.bed.room,
      (db) => (mix.bed.room = db),
    ),
    level(
      'Rumble',
      () => mix.bed.rumble,
      (db) => (mix.bed.rumble = db),
    ),
  );
  const chartSlip = slip('The mountain', 'Its rumble through the years, 1812 to 1818', []);
  chartSlip.append(chart.element);
  drawer.append(bedSlip, ruler, chartSlip, levels);
  return drawer;
}

/** Each cue a story names, with the beats that name it. */
function cuesDrawer(): HTMLElement {
  const drawer = drawerOf('The cues', 'cue');
  for (const name of CUE_NAMES) {
    const beats = story.beats.filter((b) => b.audioCues.includes(name)).map((b) => b.title);
    let playing: CueHandle | undefined;
    const cueSlip = slip(name.replaceAll('-', ' '), beats.join(', '), [
      trigger('Start', (jewel) => {
        playing ??= startCue(sound(), name);
        jewel.classList.add('is-lit');
      }),
      trigger('Stop', (jewel) => {
        playing?.stop();
        playing = undefined;
        jewel.classList.remove('is-lit');
      }),
    ]);
    remix.push(() => playing?.setLevel(mix.cues[name]));
    cueSlip.append(cueLevel(name));
    drawer.append(cueSlip);
  }
  return drawer;
}

/** A dark brass drawer, its title, and the level of the bus its sounds play into. */
function drawerOf(title: string, bus: keyof Mix['buses']): HTMLElement {
  const drawer = el('section', 'au-drawer wu-brass wu-lit');
  const heading = el('h2', 'au-drawer-title', title);
  const busLevel = level(
    'Bus',
    () => mix.buses[bus],
    (db) => (mix.buses[bus] = db),
    -40,
    6,
  );
  busLevel.classList.add('on-brass');
  drawer.append(heading, busLevel);
  return drawer;
}

/** A vellum slip: its jewel, name and line, and its plaques. */
function slip(
  name: string,
  line: string,
  plaques: ((jewel: HTMLElement) => HTMLButtonElement)[],
): HTMLElement {
  const slipEl = el('div', 'au-slip');
  const top = el('div', 'au-slip-top');
  const jewel = el('span', 'au-jewel');
  jewel.hidden = plaques.length === 0;
  const words = el('div', 'au-slip-words');
  words.append(el('span', 'au-slip-name', name), el('span', 'au-slip-line', line));
  const actions = el('div', 'au-actions');
  actions.append(...plaques.map((make) => make(jewel)));
  top.append(jewel, words, actions);
  slipEl.append(top);
  return slipEl;
}

/** A plaque that acts on a slip, given the slip's jewel and the plaque itself. */
function trigger(
  label: string,
  action: (jewel: HTMLElement, press: HTMLButtonElement) => void,
): (jewel: HTMLElement) => HTMLButtonElement {
  return (jewel) => {
    const press: HTMLButtonElement = plaque(label, () => action(jewel, press));
    return press;
  };
}

function plaque(label: string, action: () => void): HTMLButtonElement {
  const b = button('au-plaque', label, action);
  b.textContent = label;
  return b;
}

/** The jewel lights while a sound plays out. */
function flash(jewel: HTMLElement, ms = 350): void {
  jewel.classList.add('is-lit');
  clearTimeout(Number(jewel.dataset.timer));
  jewel.dataset.timer = String(setTimeout(() => jewel.classList.remove('is-lit'), ms));
}

function levelOf(voice: keyof Mix['voices']): HTMLElement {
  return level(
    'Level',
    () => mix.voices[voice],
    (db) => (mix.voices[voice] = db),
  );
}

function cueLevel(name: CueName): HTMLElement {
  return level(
    'Level',
    () => mix.cues[name],
    (db) => (mix.cues[name] = db),
  );
}

/** A slider in a groove, its setting read out beside it; dB unless `format` says otherwise. */
function level(
  label: string,
  get: () => number,
  set: (value: number) => void,
  min = -60,
  max = 0,
  format = dbText,
): HTMLElement {
  const row = el('label', 'au-level');
  const input = el('input', 'au-range');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = max - min > 2 ? '0.5' : '0.01';
  input.value = String(get());
  const readout = el('span', 'au-readout');
  const show = () => {
    const value = Number(input.value);
    readout.textContent = format(value);
    input.style.setProperty('--fill', `${(100 * (value - min)) / (max - min)}%`);
  };
  input.addEventListener('input', () => {
    set(Number(input.value));
    show();
    mixChanged();
  });
  show();
  row.append(el('span', 'au-level-name', label), input, readout);
  return row;
}

function dbText(db: number): string {
  const size = Math.abs(db);
  const sign = db > 0 ? '+' : db < 0 ? '−' : '';
  return `${sign}${size % 1 ? size.toFixed(1) : size.toFixed(0)} dB`;
}

/** Where a day falls on the bed's ruler, 0 to 1. */
function share(day: number): number {
  return (day - FIRST) / (LAST - FIRST);
}

function stack(...parts: HTMLElement[]): HTMLElement {
  const s = el('div', 'au-stack');
  s.append(...parts);
  return s;
}

/** A knurled brass knob with a domed face and a mark engraved in it. */
function knob(className: string, label: string, face: SVGSVGElement): HTMLButtonElement {
  const k = button(`au-knob ${className}`, label, () => {});
  const dome = el('span', 'au-knob-face');
  dome.append(face);
  k.append(dome);
  return k;
}

/** Begin's mark: a winding key's bow and bit, cut into the face. */
function beginFace(): SVGSVGElement {
  const face = svg('svg', { viewBox: '-16 -16 32 32', 'aria-hidden': 'true' });
  const key =
    'M-2 -11 a5.5 5.5 0 1 1 4 0 L1.4 3 L5 3 L5 6 L1.4 6 L1.4 8 L4 8 L4 11 L-1.4 11 L-1.4 -5.6 Z' +
    'M0 -14.4 a2.6 2.6 0 1 0 0.01 0 Z';
  face.append(
    svg('path', { d: key, class: 'au-cut-lip', transform: 'translate(0.5 0.8)' }),
    svg('path', { d: key, class: 'au-niello', 'fill-rule': 'evenodd' }),
  );
  return face;
}

/** Mute's mark: a speaker and its waves, or with the sound off, a cross. */
function speakerFace(): SVGSVGElement {
  const face = svg('svg', { viewBox: '-16 -16 32 32', 'aria-hidden': 'true' });
  const cone = 'M-10 -4 L-5 -4 L1 -9.5 L1 9.5 L-5 4 L-10 4 Z';
  const waves = 'M4.5 -4.5 Q7.5 0 4.5 4.5 M7.5 -8 Q12.5 0 7.5 8';
  const cross = 'M5 -4 L12 4 M12 -4 L5 4';
  for (const [d, cls] of [
    [cone, 'au-niello'],
    [waves, 'au-niello-line au-waves'],
    [cross, 'au-niello-line au-cross'],
  ] as const) {
    face.append(
      svg('path', { d, class: `${cls} au-lip`, transform: 'translate(0.5 0.8)' }),
      svg('path', { d, class: cls }),
    );
  }
  return face;
}

/**
 * The rumble through the years, engraved: its level from 1812 to 1818, the span the ruler covers
 * lightly shaded, and a garnet where story time stands.
 */
function rumbleChart(): { element: HTMLElement; set(day: number): void } {
  const [from, to] = [dayFromIso('1812-01-01'), dayFromIso('1819-01-01')];
  const [w, top, base] = [360, 6, 62];
  const x = (day: number) => ((day - from) / (to - from)) * w;
  const y = (level: number) => base - level * (base - top);
  let curve = `M0 ${y(0)}`;
  for (let k = 1; k <= 2400; k += 1) {
    const day = from + (k / 2400) * (to - from);
    curve += `L${x(day).toFixed(1)} ${y(rumbleLevel(day)).toFixed(1)}`;
  }
  let years = '';
  let labels = '';
  for (let year = 1812; year <= 1818; year += 1) {
    const at = x(dayFromCivil({ year, month: 1, day: 1 }));
    years += `M${at.toFixed(1)} ${base}V${base + 4}`;
    const mid = x(dayFromCivil({ year, month: 7, day: 1 })).toFixed(1);
    labels += `<text x="${mid}" y="${base + 14}">${year}</text>`;
  }
  const element = el('div', 'au-chart');
  const face = svg('svg', { viewBox: `0 0 ${w} ${base + 18}`, 'aria-hidden': 'true' });
  face.innerHTML =
    `<rect class="au-chart-span" x="${x(FIRST).toFixed(1)}" y="${top - 4}" ` +
    `width="${(x(LAST) - x(FIRST)).toFixed(1)}" height="${base - top + 4}"/>` +
    `<path class="au-chart-area" d="${curve}L${w} ${base}L0 ${base}Z"/>` +
    `<path class="au-chart-curve" d="${curve}"/>` +
    `<path class="au-chart-axis" d="M0 ${base}H${w}${years}"/>` +
    `<g class="au-chart-years">${labels}</g>` +
    `<circle class="au-chart-mark" r="3.4"/>`;
  const mark = face.querySelector('.au-chart-mark');
  element.append(face);
  return {
    element,
    set(day) {
      mark?.setAttribute('cx', x(day).toFixed(1));
      mark?.setAttribute('cy', y(rumbleLevel(day)).toFixed(1));
    },
  };
}

async function copySettings(press: HTMLButtonElement): Promise<void> {
  const text = JSON.stringify(mix, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    press.textContent = 'Copied';
  } catch {
    // Without the clipboard, the settings open on a sheet to copy by hand.
    const sheet = el('pre', 'au-sheet', text);
    sheet.addEventListener('click', () => sheet.remove());
    root.append(sheet);
    getSelection()?.selectAllChildren(sheet);
    press.textContent = 'Shown';
  }
  setTimeout(() => (press.textContent = 'Copy settings'), 1600);
}
