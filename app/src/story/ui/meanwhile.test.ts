// Meanwhile's list, with no walk behind it, as Explore has it; and its fold: folded, the panel
// keeps its heading, and its slips fold away.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  byClass,
  fake,
  stubDocument,
  type FakeDocument,
  type FakeElement,
} from '../../test/fakeDom';
import type { MeanwhileEntry, Walk } from '../contract';
import { MeanwhileList, MeanwhilePanel } from './meanwhile';

let document: FakeDocument;

beforeEach(() => {
  document = stubDocument();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
});
afterEach(() => vi.unstubAllGlobals());

function panel() {
  const meanwhile = new MeanwhilePanel({} as Walk, { beats: {}, months: [] });
  const element = fake(meanwhile.element);
  const knob = byClass(element, 'wu-fold-knob');
  const press = () => knob.dispatchEvent(new CustomEvent('click', { detail: 0 }));
  return { element, knob, press, region: byClass(element, 'wu-fold') };
}

describe('Meanwhile', () => {
  it('names its knob for the panel', () => {
    expect(panel().knob.getAttribute('aria-label')).toBe('Meanwhile');
  });

  it('folds its slips away and keeps its heading', () => {
    const { element, region } = panel();
    const heading = byClass(element, 'wu-mw-head');
    expect([region.contains(byClass(element, 'wu-mw-list')), region.contains(heading)]).toEqual([
      true,
      false,
    ]);
  });

  it('folds and unfolds as its knob is pressed', () => {
    const { element, knob, press, region } = panel();
    const states = () => [
      knob.getAttribute('aria-expanded'),
      element.classList.contains('is-folded'),
      region.inert,
    ];
    const open = states();
    press();
    const folded = states();
    press();
    expect([open, folded, states()]).toEqual([
      ['true', false, false],
      ['false', true, true],
      ['true', false, false],
    ]);
  });
});

describe('Meanwhile’s list', () => {
  const entries: MeanwhileEntry[] = [
    {
      label: 'Battle of Ligny',
      day: 1,
      dateLabel: '16 June 1815',
      at: [4.62, 50.52],
      source: { title: 'Wikipedia', url: 'https://example.invalid/ligny' },
    },
    {
      label: 'Congress of Vienna',
      day: 2,
      dateLabel: '1814–1815',
      at: [16.37, 48.21],
      source: { title: 'Wikipedia', url: 'https://example.invalid/vienna' },
    },
  ];
  const rows = (element: FakeElement) =>
    (byClass(element, 'wu-mw-list').children as FakeElement[]).map((item) =>
      byClass(item, 'wu-mw-entry'),
    );

  it('lists the entries it is given, with no walk, and flies to the one chosen', () => {
    const chosen: MeanwhileEntry[] = [];
    const list = new MeanwhileList((entry) => chosen.push(entry));
    const element = fake(list.element);
    list.show(entries);
    expect(element.hidden).toBe(false);
    const buttons = rows(element);
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Battle of Ligny16 June 1815',
      'Congress of Vienna1814–1815',
    ]);
    buttons[1]!.dispatchEvent(new CustomEvent('click', { detail: 0 }));
    expect(chosen).toEqual([entries[1]]);
  });

  it('points each entry’s compass from the view’s center, or names it here', () => {
    const list = new MeanwhileList(() => {});
    const element = fake(list.element);
    list.show(entries);
    list.update({ lon: 4.62, lat: 50.52, viewKm: 3000, tilt: 0, heading: 0 });
    const points = rows(element).map((row) => byClass(row, 'wu-compass-point').textContent);
    expect(points).toEqual(['Here', 'E']);
  });

  it('hides with nothing to list', () => {
    const list = new MeanwhileList(() => {});
    list.show(entries);
    list.show([]);
    expect(fake(list.element).hidden).toBe(true);
  });

  describe('keeps a keyboard visitor’s place as its entries change', () => {
    const [ligny, vienna] = entries as [MeanwhileEntry, MeanwhileEntry];
    const waterloo: MeanwhileEntry = {
      ...ligny,
      label: 'Battle of Waterloo',
      day: 3,
      dateLabel: '18 June 1815',
    };
    const focused = () => document.activeElement?.textContent;

    it('on their entry, where the new list still has it', () => {
      const list = new MeanwhileList(() => {});
      const element = fake(list.element);
      list.show([ligny, vienna]);
      rows(element)[1]!.focus();
      list.show([waterloo, ligny, vienna]);
      expect(document.activeElement).toBe(rows(element)[2]);
      expect(focused()).toBe('Congress of Vienna1814–1815');
    });

    it('on the entry now standing where theirs stood, once theirs has gone', () => {
      const list = new MeanwhileList(() => {});
      const element = fake(list.element);
      list.show([ligny, vienna, waterloo]);
      rows(element)[1]!.focus();
      list.show([ligny, waterloo]);
      expect(focused()).toBe('Battle of Waterloo18 June 1815');
      list.show([ligny]);
      expect(focused()).toBe('Battle of Ligny16 June 1815');
    });

    it('at its heir, once nothing is listed and the panel hides', () => {
      const heir = document.createElement('div');
      const list = new MeanwhileList(() => {}, {
        heir: () => heir as unknown as HTMLElement,
      });
      list.show([ligny]);
      rows(fake(list.element))[0]!.focus();
      list.show([]);
      expect(document.activeElement).toBe(heir);
    });

    it('and leaves a focus held elsewhere alone', () => {
      const elsewhere = document.createElement('button');
      const list = new MeanwhileList(() => {});
      list.show([ligny, vienna]);
      elsewhere.focus();
      list.show([vienna]);
      expect(document.activeElement).toBe(elsewhere);
    });
  });
});
