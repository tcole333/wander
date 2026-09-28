// The beat card's fold: folded, the card keeps its date line and title, follows the walk on to each
// beat, and reaches nothing, so the globe is no longer pushed aside for it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byClass, fake, stubDocument, type FakeElement } from '../../test/fakeDom';
import { storyNamed } from '../catalog';
import type { WalkState } from '../contract';
import { BeatCard } from './card';
import { curlyQuotes, dateLine } from './format';

const story = storyNamed('tambora')!.story;

beforeEach(() => {
  stubDocument();
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
});
afterEach(() => vi.unstubAllGlobals());

/** The walk stopped on a beat. */
const onBeat = (beat: number): WalkState => ({
  story,
  beat,
  mode: 'paused',
  flight: null,
  flying: false,
  day: story.beats[beat]!.day,
  advanceIn: null,
});

/** A card standing where the walk puts it, its knob and the words in its head at hand. */
function card(reachChanged?: () => void) {
  const beatCard = new BeatCard('https://data.example', reachChanged);
  const element = fake(beatCard.element);
  element.offsetLeft = 30;
  element.offsetWidth = 450;
  const knob = byClass(element, 'wu-fold-knob');
  const press = () => knob.dispatchEvent(new CustomEvent('click', { detail: 0 }));
  const words = (name: string) => byClass(element, name).textContent;
  return { beatCard, element, knob, press, words };
}

describe('the card', () => {
  it('reaches to its right edge where it stands open', () => {
    expect(card().beatCard.reach()).toBe(480);
  });

  it('reaches nothing once folded, and to its edge again once unfolded', () => {
    const { beatCard, press } = card();
    press();
    const folded = beatCard.reach();
    press();
    expect([folded, beatCard.reach()]).toEqual([0, 480]);
  });

  it('tells its page each time its reach changes', () => {
    const reachChanged = vi.fn();
    const { press } = card(reachChanged);
    press();
    press();
    expect(reachChanged).toHaveBeenCalledTimes(2);
  });

  it('starts folded, reaching nothing, where it was left folded', () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === 'wander.fold.card' ? '1' : null),
      setItem: () => {},
    });
    const { beatCard, knob } = card();
    expect([knob.getAttribute('aria-expanded'), beatCard.reach()]).toEqual(['false', 0]);
  });

  it('keeps its date line and title in its head, outside what folds away', () => {
    const { element } = card();
    const region = byClass(element, 'wu-fold');
    const head = byClass(element, 'wu-card-head');
    const outside = (of: FakeElement) => head.contains(of) && !region.contains(of);
    expect([
      outside(byClass(element, 'wu-date')),
      outside(byClass(element, 'wu-title')),
      region.contains(byClass(element, 'wu-body')),
      region.contains(byClass(element, 'wu-foot')),
    ]).toEqual([true, true, true, true]);
  });

  it("shows each new beat's date and title while folded", () => {
    const { beatCard, press, words } = card();
    beatCard.update(onBeat(0));
    press();
    beatCard.update(onBeat(1));
    const next = story.beats[1]!;
    expect([words('wu-date'), words('wu-title')]).toEqual([
      dateLine(next),
      curlyQuotes(next.title),
    ]);
  });
});
