// Starting values for timing and feel constants, one entry per name in section 10 of
// docs/design/streaming.md. Tests read them from here. Durations are milliseconds, sizes are
// bytes, and a { lite, full } pair holds per-tier values.

const KiB = 1024;
const MiB = 1024 * KiB;

export const tunables = {
  // CSS px of screen error before a node refines; merge at `merge` times that. Section 6's
  // budgets were modelled with these values, so changing them invalidates the budgets.
  refinePx: { lite: 1.5, full: 0.83, merge: 0.7 },
  // Visible width at the closest story and explore view over L7, doubling for each coarser level
  // under the view (owner decision 1).
  zoomFloorKm: 30,
  // Relief exaggeration: land displaces by kLand·max(h, 0), sea by kSea·min(h, 0) with Bathymetry
  // on (5.6 rule 7).
  kLand: 8,
  kSea: 8,
  // Skirt depth below a node's boundary, in its own texels, lowered radially (5.6 rule 8).
  skirtTexels: 1,
  // The camera stays the larger of minKm and ofView of the view's own distance (before any slide)
  // above the terrain ceiling, and the line from the target to it clears the terrain by lineDeg
  // (5.7).
  cameraClearance: { minKm: 2, ofView: 0.25, lineDeg: 2 },
  revealHold: 300,
  revealMorph: 700,
  tileFade: 250,
  bevelFade: 400,
  borderFade: 400,
  borderRest: 250,
  // Border previews dissolving into each other while the clock moves (streaming.md 3.3).
  borderScrubFade: 120,
  // View widths, km across, over which borders fade out as the view closes in: gone at near.
  borderCloseKm: { near: 220, far: 400 },
  // View widths, km across, over which the inner border lines fade in as the view narrows: full
  // at near.
  borderInnerKm: { near: 4500, far: 9000 },
  // View widths, km across, over which the inner border lines dim, on a log scale, to
  // ETCHED_LOOK.inner.close of their brightness at near and closer (look/bordersHook.ts,
  // innerShare).
  borderInnerCloseKm: { near: 1000, far: 2000 },
  // View widths, km across, over which the etched outer border line grows, on a log scale, from
  // its near size at near to ETCHED_LOOK.far times it at far and wider (look/bordersHook.ts,
  // etchedScale).
  borderWeightKm: { near: 14_000, far: 32_000 },
  l7WarnViewKm: 400,
  eventQueryHz: 30,
  eventMarkers: { lite: 80, full: 140 },
  eventLabels: { lite: 24, full: 40 },
  parentSplitPx: 150,
  parentMergePx: 120,
  // Events per declutter cell, and the cell's side in mark diameters (markPx): 64 CSS px where
  // marks are 16 px across, 176 where they are 44.
  declutterPerCell: 2,
  declutterCellMarks: 4,
  // Score margin, on the 0-1000 event score scale, a newcomer needs to displace an incumbent.
  hysteresisScore: 20,
  eventFade: 300,
  // The share of the ruler's visible width that counts as now, centered on the playhead.
  nowShare: 0.1,
  // Years the ruler shows as Explore opens, centered on the opening event.
  exploreOpenYears: 200,
  // The narrowest and widest Explore's tape shows: at 10 days the now window's one-day floor
  // never outgrows the glass, and at 5,000 years the tape never repeats the overview.
  exploreMinSpanDays: 10,
  exploreMaxSpanYears: 5000,
  // Explore's overview is logarithmic in the years before 2000's end plus this many.
  overviewWarpYears: 100,
  // The span's change per wheel pixel over Explore's ruler, and per pinch pixel (the globe's), as
  // e^(rate·px): a 100 px notch shows 1.49 times as much.
  timeWheelRate: 0.004,
  timePinchRate: 0.01,
  // A flicked tape coasts with this time constant, at most this many spans.
  timeFlickTauS: 0.3,
  timeFlickMaxSpans: 2,
  // A flight between dates lasts 0.22 + 0.11·log2(1 + distance/span) s, within these.
  timeFlightS: { min: 0.22, max: 0.9 },
  // A held arrow glides after `delay` ms, from `from` to `to` spans a second over `ramp` ms.
  timeHoldGlide: { delay: 300, from: 0.25, to: 0.85, ramp: 2000 },
  // A mark's diameter in CSS px by the view's width in km, log-interpolated between the rows and
  // held beyond them: one size at a given scale (globe-language.md, principle 7).
  markPx: [
    { km: 300, px: 44 },
    { km: 1000, px: 32 },
    { km: 3000, px: 22 },
    { km: 12_000, px: 14 },
  ],
  // The fewest device pixels a mark spans, so its glyph reads where the globe is drawn at one
  // device pixel a CSS px: there marks at world view are 16 CSS px, not 14.
  markMinDevicePx: 16,
  // Marks the look inlays in one 32 CSS px screen tile: focal first, then hovered, then by score.
  markTileCap: 8,
  // A mark's roughness floor, and the cap on the luminance the lamp gives it: no mark but the
  // focal one reaches the bloom's threshold (1.05).
  markRoughMin: 0.35,
  markSpecMax: 0.9,
  // A state name's em on screen, CSS px, by plane: it fades in over `in`, is drawn no larger than
  // `cap`, so an empire's name never outweighs the map, and fades out over `out` as its region's
  // smaller windows take over (look/namePlacing.ts).
  namePx: {
    outer: { in: [7, 9.5], cap: 26, out: [44, 58] },
    inner: { in: [9, 12], cap: 20, out: [32, 44] },
  },
  // The full name's em on screen, CSS px, from which a region shows it rather than its short name.
  nameFullPx: { outer: 12, inner: 13 },
  // A state name fading in as it takes a place, or out as it gives way.
  nameFade: 250,
  // State names the look cuts in one 32 CSS px screen tile.
  nameTileCap: 6,
  meanwhileCount: 3,
  meanwhileMinKm: 2000,
  // How long Explore's clock and view stand still before Meanwhile asks the event worker again.
  meanwhileRest: 250,
  // Explore never opens on any of the visitor's last this many openings.
  openingsRecent: 5,
  placeLabelsMax: 30,
  // clamp(S / speed, min, max), with S the van Wijk-Nuij path length and rho its curvature.
  flightDuration: { speed: 1.2, min: 1600, max: 4500, rho: 1.42 },
  // Route flights: mostly sailed distance, with enough calendar time to pass ports continuously.
  voyageDistanceWeight: 0.9,
  // Following width is this share of the leg's sailed km, clamped in km.
  voyageWidth: { ofDistance: 0.8, min: 1500, max: 6500 },
  // Base lift/settle time plus sailed km / kmPerSecond; durations are milliseconds.
  voyageDuration: { base: 4000, kmPerSecond: 1200, min: 6000, max: 18000 },
  // Share of the path used at each end to blend between the beat and following views.
  voyageBlend: 0.15,
  // Fraction of the flight at which the readiness gate is checked.
  gateAt: 0.7,
  holdMax: 1500,
  retargetBlend: 300,
  rmDissolve: 400,
  rmHoldMax: 2500,
  hoverQueue: 150,
  titleFontWait: 1000,
  // Concurrent fetches: total, the most that next and background share, and background's floor.
  inFlight: { total: 12, nextAndBackgroundMax: 4, backgroundMin: 1 },
  queueDrop: 300,
  // Fraction of a superseded body already received above which it is allowed to finish.
  finishIfReceived: 0.7,
  // Milestone 1 starts these high for its single request queue (5.2).
  stallBytes: 10_000,
  stallHeaders: 10_000,
  // Applied with jitter.
  retryDelays: [500, 2000, 8000],
  degradeFor: 30_000,
  motionLodRate: { screensPerSecond: 1, levelsPerSecond: 1 },
  uploadAnimated: { lite: 256 * KiB, full: 512 * KiB },
  uploadIdle: { lite: 1 * MiB, full: 2 * MiB },
  uploadStopMs: 1,
  uploadSlowCall: 0.5,
  // Frames before a freed pool slot is reused.
  slotQuarantine: 2,
  lodBiasStep: 0.25,
  lodBiasRelax: { after: 5000, belowOccupancy: 0.8 },
  overlaySlots: { lite: 160, full: 256 },
  probeFrames: 120,
  probeGpuMs: 12,
  probeMissFrac: 0.1,
  governor: {
    // Step render scale down when more than this fraction of vsyncs is missed over the window.
    downMissFrac: 0.1,
    downWindowFrames: 120,
    // Step up after this long with GPU p90 under the fraction of the frame interval, or after a
    // probe of upProbe with no misses.
    upAfter: 10_000,
    upGpuP90Frac: 0.55,
    upProbe: 30_000,
    // Revert a step up if more than this fraction is missed within the window, then back off.
    revertMissFrac: 0.05,
    revertWindow: 5000,
    backoff: 120_000,
  },
  renderScale: {
    lite: { min: 0.75, max: 1.25 },
    full: { min: 1.0, max: 2.0 },
    step: 0.25,
    start: 1.0,
  },
  plumeParticles: { lite: 1500, full: 4000 },
  restoreTimeout: 3000,
  labelSyncTimeout: 3000,
  // Years of visible ruler span at or under which monthly climate frames are drawn.
  climateMonthlySpan: 20,
  climatePrefetchYears: 2,
  climateSwitchFade: 300,
  // Kelvin at which the diverging climate palette saturates, either side of zero: 1816's summer
  // runs 2-5 K under the average in Europe and New England, which ±4 K spreads over the palette.
  climateRangeK: 4,
  detents: { maxPerSecond: 25, scheduleAhead: 50 },
  loopCrossfade: 50,
  bedCrossfade: 750,
  hideRamp: 100,
  showFade: 300,
  // Encoded samples per story, and decoded samples resident at once.
  audioEncodedMax: 320 * KiB,
  audioDecodedMax: 8 * MiB,
} as const;

export type Tier = 'lite' | 'full';
export type TunableName = keyof typeof tunables;
