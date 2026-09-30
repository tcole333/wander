// The vertex mirror on every fixture family on the full tier (streaming.md 5.6, 7.3), in a file of
// its own so it runs beside the other tier's sweep.
import { describe, test } from 'vitest';
import { fixtureFamilySweep } from '../test/mirrorFamilies';

describe('the fixture families (full)', () => {
  const sweep = fixtureFamilySweep('full');
  test(
    'every instance holding a shared point gets its code, shore, land, h, direction and position bit for bit',
    sweep.sharedPoints,
  );
  test(
    'every T-junction lies within 2^-24 R per component of the midpoint of the chord it splits',
    sweep.chords,
  );
  test(
    'skirt bottoms are their tops lowered radially, at T-junctions and deep sources too',
    sweep.skirts,
  );
  test('flipping one cS bit, one cN bit or one corner dN makes a shared point differ', sweep.flips);
});
