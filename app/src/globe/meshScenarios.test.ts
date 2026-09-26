// What combinationsOf counts (streaming.md 5.6, 7.3): the rules each shared point meets, and only
// where the configuration around the point is whole, so a partial scenario's open border adds
// nothing to the coverage the mirror's tests demand.
import { describe, expect, test } from 'vitest';
import { combinationsOf, l1Globe, type Scenario } from './meshScenarios';

const node = (level: number, x: number, y: number, source: number) => ({
  tile: { face: 0, level, x, y },
  source,
});

/** A coarse L1 node on L1 with two L2 nodes across its E edge, on L0 and L1: a split edge. */
const whole: Scenario = {
  name: 'split edge',
  nodes: [node(1, 0, 0, 1), node(2, 2, 0, 0), node(2, 2, 1, 1)],
  partial: true,
};
/** The same with the upper L2 node missing, so half the coarse edge is open. */
const open: Scenario = { ...whole, name: 'half-open edge', nodes: whole.nodes.slice(0, 2) };

describe('combinationsOf', () => {
  test('l1-globe meets only same-level nodes drawing themselves, at m 2', () => {
    const expected = ['lite', 'full'].flatMap((tier) => [
      ...['in-face', 'face', 'face-rev'].map((seam) => `edge ${seam} same cS=0 m=2 ${tier}`),
      ...['inface4', 'face4', 'cube3'].map((corner) => `corner ${corner} dN=0 cS=0 m=2 ${tier}`),
    ]);
    const reached = [...combinationsOf(l1Globe(), 'lite'), ...combinationsOf(l1Globe(), 'full')];
    expect(reached.sort()).toEqual(expected.sort());
  });

  test('counts a coarse edge split between finer nodes, and the midpoint they share', () => {
    expect([...combinationsOf(whole, 'full')]).toEqual(
      expect.arrayContaining([
        'edge in-face coarse cS=split m=1 full',
        'edge in-face coarse cS=split m=2 full',
        'corner mid3 dN=1 cS=0 m=1 full',
        'corner mid3 dN=1 cS=1 m=1 full',
      ]),
    );
  });

  test('counts neither the coarse edge nor its midpoint while half the edge is open', () => {
    const reached = [...combinationsOf(open, 'full')];
    expect(reached.filter((key) => /^edge in-face coarse|^corner mid3/.test(key))).toEqual([]);
  });
});
