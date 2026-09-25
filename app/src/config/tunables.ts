// Starting values for timing and feel constants, one entry per name in section 10 of
// docs/design/streaming.md. Tests read them from here. Durations are milliseconds, sizes are
// bytes, and a { lite, full } pair holds per-tier values.

const KiB = 1024;
const MiB = 1024 * KiB;

export const tunables = {
  // CSS px of screen error before a node refines; merge at `merge` times that. Section 6's
  // budgets were modelled with these values, so changing them invalidates the budgets.
  refinePx: { lite: 1.5, full: 0.83, merge: 0.7 },
  // Visible width at the closest story and explore view (still open: owner decision 1).
  zoomFloorKm: 100,
  revealHold: 300,
  revealMorph: 700,
  tileFade: 250,
  bevelFade: 400,
  borderFade: 400,
  borderRest: 250,
  borderWarnYears: 20,
  l7WarnViewKm: 400,
  eventQueryHz: 30,
  markers: { lite: 80, full: 140 },
  labels: { lite: 24, full: 40 },
  parentSplitPx: 150,
  parentMergePx: 120,
  // Events per 64 px screen cell.
  declutterPerCell: 2,
  // Score margin, on the 0-1000 event score scale, a newcomer needs to displace an incumbent.
  hysteresisScore: 20,
  eventFade: 300,
  meanwhileCount: 6,
  meanwhileMinKm: 2000,
  placeLabelsMax: 30,
  // clamp(S / speed, min, max), with S the van Wijk-Nuij path length and rho its curvature.
  flightDuration: { speed: 1.2, min: 1600, max: 4500, rho: 1.42 },
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
  stallBytes: 2500,
  stallHeaders: 4000,
  // Applied with jitter.
  retryDelays: [500, 2000, 8000],
  degradeFor: 60_000,
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
  // Kelvin at which the diverging climate palette saturates, either side of zero.
  climateRangeK: 6,
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
