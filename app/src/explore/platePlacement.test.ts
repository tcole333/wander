// Where a plate stands beside its mark: the first side in view and clear, kept while it serves.
import { describe, expect, it } from 'vitest';
import { EDGE_PX, GRACE_PX, placePlate, plateBox, type Box } from './platePlacement';

const VIEW = { width: 1440, height: 900 };
const SIZE = { width: 160, height: 50 };
const anchor = (x: number, y: number) => ({ x, y, gap: 16 });

describe('a plate’s place', () => {
  it('stands right of its mark, centered on it, when that is clear', () => {
    expect(placePlate(anchor(700, 400), SIZE, null, [], VIEW)).toEqual({
      side: 'right',
      box: { left: 716, right: 876, top: 375, bottom: 425 },
    });
  });

  it('takes the next side clear of what it must not cover', () => {
    const panel: Box = { left: 740, right: 1000, top: 300, bottom: 500 };
    expect(placePlate(anchor(700, 400), SIZE, null, [panel], VIEW).side).toBe('left');
    const wide: Box = { left: 400, right: 1000, top: 390, bottom: 410 };
    expect(placePlate(anchor(700, 400), SIZE, null, [wide], VIEW).side).toBe('above');
  });

  it('stays in view, taking the left at the right edge and below at the top', () => {
    expect(placePlate(anchor(1400, 400), SIZE, null, [], VIEW).side).toBe('left');
    expect(placePlate(anchor(120, 20), SIZE, null, [], VIEW).side).toBe('below');
  });

  it('ignores a hidden panel, which measures nothing', () => {
    const hidden: Box = { left: 0, right: 0, top: 0, bottom: 0 };
    expect(placePlate(anchor(700, 400), SIZE, null, [hidden], VIEW).side).toBe('right');
  });

  it('keeps its side while it still serves, though an earlier one comes free', () => {
    expect(placePlate(anchor(700, 400), SIZE, 'below', [], VIEW).side).toBe('below');
  });

  it('keeps its side within the grace, and leaves it once overrun past it', () => {
    const right = plateBox(anchor(700, 400), SIZE, 'right');
    const edge = (overrun: number): Box => ({
      left: right.right - overrun,
      right: right.right + 100,
      top: 0,
      bottom: 900,
    });
    expect(placePlate(anchor(700, 400), SIZE, 'right', [edge(GRACE_PX - 1)], VIEW).side).toBe(
      'right',
    );
    expect(placePlate(anchor(700, 400), SIZE, 'right', [edge(GRACE_PX + 1)], VIEW).side).toBe(
      'left',
    );
  });

  it('keeps its side, held in view, when no side is clear', () => {
    const everywhere: Box = { left: 0, right: 1440, top: 0, bottom: 900 };
    const { side, box } = placePlate(anchor(1420, 400), SIZE, 'right', [everywhere], VIEW);
    expect(side).toBe('right');
    expect(box.right).toBe(VIEW.width - EDGE_PX);
  });
});
