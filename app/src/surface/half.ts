// Exact integer-to-half-float conversion for R16F uploads (streaming.md 3.1). Node 22 has no
// Float16Array, and the decode worker must not import three, so this builds the bits itself.

/** Half-float holds every integer within ±2048 exactly. */
export const HALF_EXACT = 2048;

/** IEEE 754 binary16 bits of an integer within ±2048. */
export function intToHalfBits(v: number): number {
  if (!Number.isInteger(v) || Math.abs(v) > HALF_EXACT) {
    throw new RangeError(`${v} is not an integer within ±${HALF_EXACT}`);
  }
  if (v === 0) return 0;
  const sign = v < 0 ? 0x8000 : 0;
  const magnitude = Math.abs(v);
  const exponent = 31 - Math.clz32(magnitude); // floor(log2), 0..11
  // The leading 1 is implicit; the bits below it fill the 10-bit fraction from the top.
  const fraction =
    exponent <= 10
      ? (magnitude << (10 - exponent)) & 0x3ff
      : (magnitude >> (exponent - 10)) & 0x3ff;
  return sign | ((exponent + 15) << 10) | fraction;
}

const TABLE = Uint16Array.from({ length: 2 * HALF_EXACT + 1 }, (_, k) =>
  intToHalfBits(k - HALF_EXACT),
);

/** intToHalfBits by table lookup, for the decoder's inner loops; the caller keeps |v| ≤ 2048. */
export function halfBitsOf(v: number): number {
  return TABLE[v + HALF_EXACT] ?? intToHalfBits(v);
}

/**
 * The number IEEE 754 binary16 bits hold, exactly: what a texelFetch of an R16F or RG16F texel
 * returns. Infinities and NaNs come out as such.
 */
export function halfValue(bits: number): number {
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  let magnitude: number;
  if (exponent === 0x1f) magnitude = fraction === 0 ? Infinity : NaN;
  else if (exponent === 0) magnitude = fraction * 2 ** -24;
  else magnitude = (1024 + fraction) * 2 ** (exponent - 25);
  return bits & 0x8000 ? -magnitude : magnitude;
}
