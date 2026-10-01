// The vertex mirror's sweep over the fixture families (streaming.md 5.6, 7.3), and the negative
// controls it runs on each scenario: single seam bit flips that must make a shared point differ.
import { beforeAll, expect } from 'vitest';
import { tileKey } from '../surface/cube';
import { flagsNeedUp } from '../globe/instances';
import { fixtureFamilies, type Tier } from '../globe/meshScenarios';
import { isTJunction, sharedPoint } from '../globe/seamFlags';
import { GRID_SEGMENTS } from '../globe/tileGrid';
import {
  chordOffsets,
  gridVertex,
  mirrorScenario,
  sharedGroups,
  sharedMismatches,
  skirtCheck,
  withFlags,
  type ChordOffset,
  type MirroredScenario,
  type VertexRef,
} from './meshMirror';

const FAMILIES = fixtureFamilies();

export type ControlKind = 'cS' | 'cN' | 'dN';

export interface Control {
  family: string;
  kind: ControlKind;
  flip: string;
  /** Flips of this kind tried in the scenario, up to the first the mirror shows. */
  tried: number;
  /** Shared points the flipped instance then disagrees on. */
  mismatches: number;
}

/**
 * Candidate single-bit flips of `flags`: a half-edge or corner cS bit, an edge's cN bit, or a
 * corner dN bit that leaves dN at 2 or less.
 */
export function flips(flags: number, kind: ControlKind): number[] {
  switch (kind) {
    case 'cS':
      return [4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 18, 21];
    case 'cN':
      return [0, 1, 2, 3];
    case 'dN':
      return [0, 1, 2, 3].flatMap((c) =>
        [13 + 3 * c, 14 + 3 * c].filter((bit) => (((flags ^ (1 << bit)) >>> (13 + 3 * c)) & 3) < 3),
      );
  }
}

/**
 * Per kind, the scenario's flips that change what an instance derives at a point it shares (the
 * level or mip it samples, or whether the point is a T-junction), in instance and bit order, up to
 * the first after which the mirror gets a shared point wrong.
 */
export async function negativeControls(
  family: string,
  mirrored: MirroredScenario,
  groups: Map<string, VertexRef[]>,
): Promise<Control[]> {
  const { grid, packed } = mirrored;
  const G = grid.segments;
  const holds = packed.instances.map(() => new Set<number>());
  for (const members of groups.values()) {
    for (const { instance, vertex } of members) holds[instance]?.add(vertex);
  }
  const controls: Control[] = [];
  for (const kind of ['cS', 'cN', 'dN'] as const) {
    let tried = 0;
    let found: Control | undefined;
    search: for (const [instance, { node, state }] of packed.instances.entries()) {
      for (const bit of flips(state.flags, kind)) {
        const flags = (state.flags ^ (1 << bit)) >>> 0;
        if (flagsNeedUp(flags) && node.source === 0) continue;
        const changes = [...(holds[instance] ?? [])].some((vertex) => {
          const [k, l] = gridVertex(grid, vertex);
          const was = sharedPoint(node, state.flags, k, l, G);
          const now = sharedPoint(node, flags, k, l, G);
          return (
            was.lv !== now.lv ||
            was.m !== now.m ||
            isTJunction(state.flags, k, l, G) !== isTJunction(flags, k, l, G)
          );
        });
        if (!changes) continue;
        tried += 1;
        const flipped = await withFlags(mirrored, instance, flags);
        const touched = new Map(
          [...groups].filter(([, members]) => members.some((m) => m.instance === instance)),
        );
        const mismatches = sharedMismatches(flipped, touched).length;
        if (mismatches === 0) continue;
        const flip = `${packed.scenario.name}: ${tileKey(node.tile)} bit ${bit}`;
        found = { family, kind, flip, tried, mismatches };
        break search;
      }
    }
    if (tried === 0) continue;
    const none = `${packed.scenario.name}: none of ${tried}`;
    controls.push(found ?? { family, kind, flip: none, tried, mismatches: 0 });
  }
  return controls;
}

/** The checks of one tier's sweep, each a test body. */
export interface FamilySweep {
  sharedPoints: () => void;
  chords: () => void;
  skirts: () => void;
  flips: () => void;
}

/**
 * The vertex mirror on every scenario of every fixture family on one tier: shared points bit for
 * bit, T-junctions on their chords, skirts, and one flipped seam bit showing. It registers the
 * sweep as a beforeAll of the calling describe and returns the checks on its results. Each tier has
 * a test file of its own, so the two sweeps run side by side, and names its tests there, where
 * `vitest list` and editors find them without running the file.
 */
export function fixtureFamilySweep(tier: Tier): FamilySweep {
  const shared: string[] = [];
  const chords: ChordOffset[] = [];
  const controls: Control[] = [];
  const skirts = { worst: 0, at: '', tjunctions: 0, deep: 0 };
  beforeAll(async () => {
    for (const { name: family, scenarios } of FAMILIES) {
      for (const scenario of scenarios) {
        const mirrored = await mirrorScenario(scenario, GRID_SEGMENTS[tier], { boundary: true });
        const groups = sharedGroups(mirrored);
        const named = (at: string) => `${scenario.name}: ${at}`;
        shared.push(...sharedMismatches(mirrored, groups).map(named));
        chords.push(...chordOffsets(mirrored, groups).map((c) => ({ ...c, at: named(c.at) })));
        const skirt = skirtCheck(mirrored);
        skirts.tjunctions += skirt.tjunctions;
        skirts.deep += skirt.deep;
        if (!(skirt.worst <= skirts.worst))
          Object.assign(skirts, { worst: skirt.worst, at: named(skirt.at) });
        controls.push(...(await negativeControls(family, mirrored, groups)));
      }
    }
  });

  return {
    sharedPoints: () => {
      expect(shared).toEqual([]);
    },
    chords: () => {
      // It is fround(P0 + P1)·0.5 of the coarse vertices: the sum, under 4, rounds by at most
      // half of its 2^-22 step, and halving is exact.
      expect(chords.length).toBeGreaterThan(0);
      expect(chords.filter(({ offset }) => !(offset <= 2 ** -24))).toEqual([]);
    },
    skirts: () => {
      expect(skirts.tjunctions).toBeGreaterThan(0);
      expect(skirts.deep).toBeGreaterThan(0);
      expect(skirts.worst, skirts.at).toBeLessThanOrEqual(2 ** -23);
    },
    flips: () => {
      // A flip can change the rule and not the value: where the field is linear, as on the L1
      // tiles the 0.5° grid fills at 0°N 0°E, every mip's mean around a point is the same code.
      // So each family shows every kind it can flip in some scenario, not in each one.
      const flipped = new Set(controls.map((c) => `${c.family} ${c.kind}`));
      const shown = new Set(
        controls.filter((c) => c.mismatches > 0).map((c) => `${c.family} ${c.kind}`),
      );
      expect([...flipped].filter((key) => !shown.has(key))).toEqual([]);
      const everywhere = FAMILIES.flatMap(({ name }) => [`${name} cS`, `${name} cN`]);
      expect(everywhere.filter((key) => !shown.has(key))).toEqual([]);
      expect(new Set(controls.filter((c) => c.mismatches > 0).map((c) => c.kind))).toEqual(
        new Set(['cS', 'cN', 'dN']),
      );
    },
  };
}
