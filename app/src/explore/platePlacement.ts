// Where an event's plate stands beside its mark (spec section 3, Avoidance): on the first side of
// right, left, above and below whose plate stays in view and clear of what it must not cover (the
// other plate, the ruler, Meanwhile, the legend and the focal ember). A plate keeps its side while
// that side still serves, with a few pixels' grace, so it does not hop from side to side as the
// globe turns under it; only when its side is blocked does it take the first that is not. When
// none is clear it keeps its side, held within the view.

/** A rectangle on the page, CSS px. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type Side = 'right' | 'left' | 'above' | 'below';

/** The sides a plate tries, in order. */
export const SIDES: readonly Side[] = ['right', 'left', 'above', 'below'];

/** How far, CSS px, a plate keeps from the view's edges. */
export const EDGE_PX = 12;
/** How far, CSS px, a plate's side may be overrun before the plate leaves it. */
export const GRACE_PX = 8;

export interface PlateAnchor {
  /** The mark's center, CSS px. */
  x: number;
  y: number;
  /** How far from the center the plate's near edge stands, CSS px: the mark's reach and a gap. */
  gap: number;
}

export interface Placement {
  side: Side;
  box: Box;
}

/** The plate's box on `side` of its mark: centered across that side. */
export function plateBox(
  { x, y, gap }: PlateAnchor,
  { width, height }: { width: number; height: number },
  side: Side,
): Box {
  switch (side) {
    case 'right':
      return { left: x + gap, right: x + gap + width, top: y - height / 2, bottom: y + height / 2 };
    case 'left':
      return { left: x - gap - width, right: x - gap, top: y - height / 2, bottom: y + height / 2 };
    case 'above':
      return { left: x - width / 2, right: x + width / 2, top: y - gap - height, bottom: y - gap };
    case 'below':
      return { left: x - width / 2, right: x + width / 2, top: y + gap, bottom: y + gap + height };
  }
}

/** Whether two boxes overlap by more than their edges. */
export function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** The box a circle about (x, y) fills. */
export function boxAround(x: number, y: number, radius: number): Box {
  return { left: x - radius, right: x + radius, top: y - radius, bottom: y + radius };
}

/** A box with any of zero size, as a hidden panel measures, blocks nothing. */
function blocks(box: Box): boolean {
  return box.right > box.left && box.bottom > box.top;
}

/**
 * The plate's side and box: its `current` side while that still serves within GRACE_PX, else the
 * first of SIDES in view and clear of `obstacles`, else its current side (or the first) held
 * within the view.
 */
export function placePlate(
  anchor: PlateAnchor,
  size: { width: number; height: number },
  current: Side | null,
  obstacles: readonly Box[],
  view: { width: number; height: number },
): Placement {
  const solid = obstacles.filter(blocks);
  const serves = (side: Side, grace: number) => {
    const box = plateBox(anchor, size, side);
    const inner = {
      left: box.left + grace,
      top: box.top + grace,
      right: box.right - grace,
      bottom: box.bottom - grace,
    };
    const inView =
      inner.left >= EDGE_PX &&
      inner.top >= EDGE_PX &&
      inner.right <= view.width - EDGE_PX &&
      inner.bottom <= view.height - EDGE_PX;
    return inView && solid.every((obstacle) => !overlaps(inner, obstacle));
  };
  const chosen =
    (current && serves(current, GRACE_PX) ? current : SIDES.find((side) => serves(side, 0))) ??
    current ??
    'right';
  return { side: chosen, box: within(plateBox(anchor, size, chosen), view) };
}

/** The box moved, as little as it takes, to within EDGE_PX of the view's edges where it fits. */
function within(box: Box, view: { width: number; height: number }): Box {
  const dx = shift(box.left, box.right, view.width);
  const dy = shift(box.top, box.bottom, view.height);
  return { left: box.left + dx, right: box.right + dx, top: box.top + dy, bottom: box.bottom + dy };
}

function shift(start: number, end: number, extent: number): number {
  if (start < EDGE_PX) return EDGE_PX - start;
  if (end > extent - EDGE_PX) return Math.max(EDGE_PX - start, extent - EDGE_PX - end);
  return 0;
}
