// Meanwhile's fold: folded, the panel keeps its heading, and its slips fold away.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byClass, fake, stubDocument } from '../../test/fakeDom';
import type { Walk } from '../contract';
import { MeanwhilePanel } from './meanwhile';

beforeEach(() => {
  stubDocument();
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
