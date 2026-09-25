# three.js prototype (reference only)

A throwaway prototype from 2026-09-24 that proved the brass-orrery look in three.js, using real
Natural Earth, terrain, and bathymetry data. It is here for its materials, lighting, instrument
geometry, and art direction, not as a code base to extend: it bakes globe textures in the browser
(about 1 s of main-thread work and ~450 MB of JS heap), which the streaming design replaces.

- `src/surface.js`: turns land, coastline, terrain, and bathymetry into albedo, roughness/metalness,
  and normal maps (the recipe the surface shader reproduces)
- `src/instrument.js`: armillary rings, yoke, gears, pedestal, engraved ring textures
- `src/main.js`: museum-lamp lighting, PMREM environment, bloom, markers, labels, camera presets

It expects `data/` and `stories/` folders from the first project's release (everywhen), which
now live in the raw-data folder `~/projects/wander-data` as `legacy-derived/` and `stories/`; the
screenshots in `docs/reference/spike-*.jpg` show what it produced.
