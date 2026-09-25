// Known places the surface checks look at (streaming.md 7.3), shared by the fixture tests and the
// region bake check.

/** GEBCO_2026's highest cell near Tambora's summit, and its height. */
export const TAMBORA_GEBCO_MAX = { lon: 117.9604, lat: -8.2479, meters: 2605 };
/** The highest L7 texel mean on Tambora's rim, lower than any one cell under it. */
export const TAMBORA_TEXEL_M = 2586.3;

/**
 * GEBCO_2026's lowest and highest cells, in meters, around the texel on the dateline at each of
 * L0-L4 on the three faces it crosses, and the texels on either side of it along s: every 15″
 * cell within 1.5 source cells (16′ at L0, 4′ at L1-L2, 1′ at L3-L4) of their sub-samples, read
 * once from the .nc on both sides of ±180°. Away from the shore, as these texels are, a texel's
 * mean of bilinear sub-samples of block means cannot leave that range.
 */
export const DATELINE_GEBCO: readonly {
  face: number;
  lat: number;
  /** [lowest, highest] at L0-L4. */
  meters: readonly (readonly [number, number])[];
}[] = [
  {
    face: 2,
    lat: 0,
    meters: [
      [-5814, -3973],
      [-5698, -4894],
      [-5637, -4959],
      [-5434, -5125],
      [-5404, -5143],
    ],
  },
  {
    face: 4,
    lat: 70,
    meters: [
      [-53, -17],
      [-47, -38],
      [-47, -38],
      [-47, -40],
      [-45, -40],
    ],
  },
  {
    face: 5,
    lat: -70,
    meters: [
      [-3893, -1593],
      [-3781, -3118],
      [-3804, -3137],
      [-3702, -3595],
      [-3702, -3666],
    ],
  },
];
