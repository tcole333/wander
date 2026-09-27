// A synthetic climate year for the tests, a WCY1 file as the modera stage writes one (streaming.md
// 3.5), inflated.

const FRAMES = 12;
/** The header's bytes, before each frame's scale and offset. */
const HEADER_BYTES = 16;

/**
 * A year of 12 frames of nlat × nlon: frame f's cell i holds code (10·i + f) mod 250 at scale 0.1
 * and offset f − 5.
 */
export function syntheticYear(nlat: number, nlon: number, year = 1816): Uint8Array {
  const cells = nlat * nlon;
  const raw = new Uint8Array(HEADER_BYTES + 8 * FRAMES + FRAMES * cells);
  const view = new DataView(raw.buffer);
  raw.set([...'WCY1'].map((c) => c.charCodeAt(0)));
  view.setUint8(4, 1);
  view.setUint8(5, 0);
  view.setInt16(6, year, true);
  view.setUint16(8, FRAMES, true);
  view.setUint16(10, nlat, true);
  view.setUint16(12, nlon, true);
  for (let f = 0; f < FRAMES; f += 1) {
    view.setFloat32(HEADER_BYTES + 4 * f, 0.1, true);
    view.setFloat32(HEADER_BYTES + 4 * (FRAMES + f), f - 5, true);
    for (let i = 0; i < cells; i += 1) {
      raw[HEADER_BYTES + 8 * FRAMES + f * cells + i] = (10 * i + f) % 250;
    }
  }
  return raw;
}
