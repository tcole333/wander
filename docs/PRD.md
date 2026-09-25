# Wander: product requirements

Wander is a desktop web experience for exploring history on a 3D globe built like a brass museum
orrery. It launches as a public showpiece at `wander.traviscole.xyz` with five guided stories, and
grows into open-world exploration of everything that happened, everywhere, over time.

The visual and motion reference is the Game of Thrones title sequence: a clockwork map inside an
armillary sphere, with relief pushed far past reality so mountains and sea trenches read at a glance.
See `docs/reference/ui-inspo.jpg` for the target mood, and `docs/reference/spike-*.jpg` plus the
prototype source in `docs/reference/spike/` for the three.js prototype that proved the look.

## Goals

- **Delight on the first visit.** Someone who has never heard of Wander opens it, picks a story,
  and enjoys it without instructions.
- **Showpiece craft.** The globe, the instrument, the motion, and the sound feel like one crafted
  object. Nothing pops in, hitches, or shows a spinner mid-story.
- **Grounded in real history.** The narrative is sourced. The visuals may dramatize, the way a good
  documentary or museum diorama does.
- **Built to grow.** v1's data, time model, and rendering are the foundation for open-world
  exploration, which follows v1 as the next release.

## Experience

### First visit: the lobby

A short opening plays, a few seconds long and skippable: the armillary rings swing into place and
the globe settles. The visitor lands in the lobby: the instrument at world view, slowly turning,
with the stories presented as plaques and faint ambient events from the global event index glowing
on the globe. Choosing a story flies the camera into its first beat.

### Stories

A story is a sequence of beats. Each beat sets:

- a date or date range
- a camera view
- a focal event
- a title and a short narrative of about a paragraph, with "Read more" for depth (60-120 words is
  a starting guide, not a limit)
- a framed image card (see below)
- which layers are on, and which effects play
- sources

Play advances through beats with camera flights between them; next and back step manually. At any
beat the visitor can break out: scrub time, spin and zoom the globe, open Meanwhile, toggle layers.
"Resume story" returns to the beat they left.

**Beat display.** Date, title, and narrative in a vivid, plain, present-tense voice ("On 10 April
1815, Tambora explodes."). Sources sit in a collapsed list under the text. The copy never talks
about what the app does or does not show.

**Image cards.** Most beats carry one historical image (painting, engraving, period map, or
photograph) from Wikimedia Commons, shown as a framed card with a one-line credit. Framing and
toning keep images consistent with the brass look.

### Time and detail

Two controls, two axes:

- **Time** is a brass ruler along the bottom of the instrument. It zooms from centuries down to
  days and always labels in calendar terms (years, months, days), never decimal years. Story beats
  appear as pips on it. In a story the ruler animates between beats; dragging it breaks out into
  exploration. The span of time that counts as "now" follows the ruler's zoom, so there is no
  separate window-width control.
- **Space** is the globe. Zooming in reveals finer events.

What appears is decided by a **detail budget**: the most important events that are both in view
and in the current time window. Events nest (a war contains its battles), so at world scale the war
shows, and as the visitor zooms into the region the battles take over while the war remains as an
outline and label behind them. Events fade in and out with a little hysteresis so they never
flicker while scrubbing or zooming. A story's focal events always show.

### Camera

Dragging spins the globe with north kept up. The wheel zooms continuously from the whole
instrument down to island scale; the armillary rings fade as the camera passes through them. Named
camera views exist only as story beats.

### Meanwhile

A panel listing notable events happening elsewhere at the same time as the current beat or scrub
position, drawn from the global event index and ranked by notability. Each story can pin or hide
specific entries. Each entry shows its direction from the current view as a compass bearing (an
idea from the first prototype that worked well), and selecting it flies the globe there.

### Layers

Every layer toggles independently:

- relief (land and sea floor, exaggerated)
- coastlines, land, lakes, and rivers
- bathymetry
- the 42 major mountain ranges
- historical climate: monthly temperature anomalies, 1421-2008
- ecoregions and biomes
- petroleum provinces
- critical-mineral deposits
- historical borders

Borders come from the historical snapshot nearest the current date, and the snapshot's year is
always shown.

Several layers are present-day data (coastlines, rivers, ecoregions, geology, deposits). The
Credits panel lists each source and its date once; the rest of the interface stays free of
caveats.

### Effects

Stories use effects to show what happened: an eruption plume, a spreading epidemic, a fleet's
route, a year of cooling. Where real data exists it drives the effect (the ModE-RA reanalysis shows
the actual 1816 cooling after Tambora). Where it does not, the effect is illustrative. Effects are
functions of story time, so scrubbing backward and forward always shows the right state.

### Audio

- Mechanical interface sounds: gear detents as the ruler passes years and months, a soft whir on
  camera flights, a clunk on beat changes. They vary and stay restrained so they never become
  grating.
- An ambient bed per story: a low rumble for Tambora, surf and timber for Magellan, and so on,
  over quiet museum room tone.

Sound starts when the visitor enters from the lobby (browsers block audio before that) and has a
mute toggle. Sounds are mostly synthesized with Web Audio, plus a few CC0 recordings where
synthesis falls short. A music score and narration are candidates for after v1.

### Article view

Every story is also readable as a plain illustrated article: the same text, images, dates, and
sources on a normal web page. It is linkable and shareable, and it is what visitors see when WebGL
is unavailable.

### Credits

One panel lists every data source with its attribution and date, and every image with its credit.

## Visual direction

A crafted bronze globe with raised, engraved land, dark lacquered oceans, and relief exaggerated
far beyond reality, especially when zoomed out. Aged-brass armillary rings, a yoke, and restrained
gearwork, all lit by one warm museum lamp in a dark room. Engraved lines for coastlines, rivers,
graticule, and borders. The active event glows ember orange.

Starting palette, carried over from the first prototype:

| Token | Value | Use |
| --- | --- | --- |
| ground | `#090c0d` | the dark room and negative space |
| ocean-lacquer | `#111b1b` | oceans |
| bronze-relief | `#8f6834` | land material |
| brass-lit | `#c09652` | lit edges, rings, ornament |
| verdigris | `#47746b` | patina and secondary state |
| vellum | `#d8c7a2` | narrative cards |
| ink | `#241d16` | text on vellum |
| garnet | `#702735` | time playhead and focus |
| ember | `#e8662c` | the active event |
| ivory-text | `#e8dcc5` | text on dark surfaces |

Type: a transitional serif with tabular numerals, starting with Libre Baskerville for display and
Source Serif 4 for reading (both OFL-licensed and self-hosted).

## v1 stories

Each story exercises something the others don't, so together they prove the engine.

1. **Tambora, 1815-1816.** The eruption, an illustrated ash plume, and ModE-RA's real temperature
   record through the "year without a summer." Built first, as the end-to-end slice.
2. **Magellan-Elcano circumnavigation, 1519-1522.** An animated route across open ocean and
   sea-floor relief.
3. **The Century of Oil, 1933-1974.** Iran, Mexico's 1938 expropriation, and the 1973 embargo, on
   the petroleum provinces layer. Merges the first prototype's three petroleum stories.
4. **The Black Death, 1346-1353.** An area spreading over time along trade routes, with ecoregions
   as backdrop.
5. **The California Gold Rush, 1848-1855.** Migration routes and the minerals layer.

Any of these can be swapped if it isn't landing, as long as the set still covers routes, spreading
areas, climate data, and the thematic layers.

## Content and sourcing

- A story is one Markdown file: a small data block per beat (date, camera, focal event, layers,
  effects, image, sources) and the beat's prose. One schema validates every story at build time.
- Claude drafts stories from real sources; the owner edits the voice and approves.
- Every beat cites at least one source (title, author or publisher, link). Dates, numbers, and
  quotes come from a cited source. Illustrative visuals do not need sources.
- Before a story ships, a separate fact-check pass verifies each claim against its cited source.
- Stories may be more liberal in sourcing than the future open-world mode, which leans on Wikidata.

## Data

Raw sources live outside the repo in `~/projects/wander-data`, described by its `manifest.json`
(source, license, attribution, checksum per file):

- GEBCO_2026: global land and sea-floor elevation at 15 arc-seconds (relief)
- Natural Earth: coastlines, land, lakes, rivers, bathymetry
- ModE-RA: monthly temperature anomaly reanalysis, 1421-2008
- RESOLVE Ecoregions 2017
- USGS World Petroleum Provinces (2000) and critical-mineral deposits (2017)
- GMBA mountain inventory (42 selected ranges)
- historical-basemaps: border snapshots from prehistory to 2010 (GPL-3.0; derived border files keep
  that license)
- Wikidata: events, queried directly over SPARQL (WDQS or QLever)

**Global event index.** v1 builds an index of dated, located Wikidata events across all eras,
ranked by notability (how many Wikipedia language editions cover each event) and linked through
"part of" relations (war to battle). It powers Meanwhile and the lobby's ambient events in v1 and
open-world exploration after. Cleaning its quality (junk events, wrong coordinates, fuzzy dates) is
ongoing work that starts in v1.

## Technical approach

- **App:** TypeScript, Vite, React, react-three-fiber with drei, Zustand for app state, three.js
  WebGLRenderer.
- **Prebuild:** Python (uv) turns raw sources into web-ready assets offline; the browser does no
  geographic processing.
- **Hosting:** Cloudflare Pages for the app at `wander.traviscole.xyz`; Cloudflare R2 for data
  assets; GitHub Actions CI on the public repo.
- **Asset delivery and streaming:** see [`docs/design/streaming.md`](design/streaming.md). In
  short: the globe surface streams as small cube-sphere tiles of elevation and coastline data styled
  live in the shader; overlays and events are prebuilt; every file is immutable and content-hashed;
  the next beat loads while the current one is read, and camera flights wait gracefully for it.

## Done for v1

- All five stories live at `wander.traviscole.xyz` in current desktop Chrome, Safari, and Firefox.
- First meaningful frame in under 3 seconds on normal broadband (25 Mbps with a cold cache), and
  beats still land smoothly at 5 Mbps.
- At least 45 fps at 1440x900, measured as a 95th-percentile frame time of 22 ms or less, with
  quality stepping down automatically on weaker GPUs. During development this is measured on the
  owner's MacBook Pro (Apple M5); lower-end machines (an M1-class Mac and an Intel Iris Xe laptop)
  get checked before launch.
- Arrow keys step through beats and space plays or pauses.
- The reduced-motion setting is respected.
- Every story works as an article, which also serves visitors without WebGL.
- A fresh clone builds, runs, and passes its tests in minutes using small committed sample data.

## Out of scope for v1

- Phones and tablets.
- The open-world explore entry in the lobby (built behind a flag, shipped in v1.1).
- Search, accounts, saved views, and user-made stories.
- Translation.
- A music score and narration (decided after hearing v1's audio).

## Milestones

1. **Tambora slice, deployed.** Starts with the de-risk experiments listed in the streaming design,
   then the lobby, the Tambora story, the globe around it, its climate and 1815 border layers,
   Meanwhile drawn from events worldwide during Tambora's years, basic audio, and deployment.
2. **Magellan, and the global event index across all eras.**
3. **The Century of Oil, the Black Death, and the Gold Rush.**
4. **Polish to the v1 bar.**
5. **v1.1: open-world exploration.**

## Open questions

- Music score and narration, after hearing v1's audio.
- Whether close story views need the finest terrain level, decided by looking at the Tambora close
  view on real GEBCO data.
- How to balance the event index's notability ranking across eras and regions (Wikidata skews
  heavily toward Europe and recent centuries).
