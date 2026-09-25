// Height codes to meters (streaming.md 3.1), the same as pipeline/src/prebuild/codes.py: qLand
// meters per code at or above c200 = rha(−200/qLand), and qDeep = 4·qLand below it.

const SHELF_M = -200;
const DEEP_RATIO = 4;

/** Round half away from zero: r = trunc(x), plus sign(x) when |x − r| ≥ 0.5. */
export function roundHalfAway(x: number): number {
  const r = Math.trunc(x) + 0; // + 0 turns −0 into 0, as the build's integers have no −0
  return Math.abs(x - r) >= 0.5 ? r + Math.sign(x) : r;
}

/** The code where qDeep takes over. */
export function c200(qLand: number): number {
  return roundHalfAway(SHELF_M / qLand);
}

/**
 * h(c) = c·qLand at or above c200, else c200·qLand + (c − c200)·qDeep. `c` may be a mean of
 * codes. The operations run in the same order as the Python build's, so both agree bit for bit.
 */
export function codeToMeters(c: number, qLand: number): number {
  const deep = c200(qLand);
  return c >= deep ? c * qLand : deep * qLand + (c - deep) * (DEEP_RATIO * qLand);
}
