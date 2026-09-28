# Wander: one globe through three eras

Generated on 25 September 2026 with the built-in ImageGen tool.

The user's idea: the globe and design theme change with the historical age
selected on the timeline. These three images explore that idea using a shared
Africa–Europe–western Asia view and closely matched interface composition.

| Display order | Date and story | Image | Material language |
| --- | --- | --- | --- |
| 1 | 1348: The Black Death | [Ink and Vellum](1348-ink-and-vellum.jpg) | Layered vellum, mineral pigments, ink and warm daylight |
| 2 | 1816: Tambora's aftermath | [Bronze and Enamel](1816-bronze-and-enamel.jpg) | Bronze relief, dark enamel seas and warm museum light |
| 3 | 1973: The Century of Oil | [The Scientific Atlas](1973-scientific-atlas.jpg) | Pearl-white relief, optical-blue oceans and luminous markings |

## Design intent

The camera, globe silhouette, broad relief, story-column placement, controls and
timeline scale stay anchored. Date, narrative, imagery, thematic overlays, surface
materials, palette and lighting change.

The first image uses [Paper World](../2026-09-25-explorations/paper-world.jpg)
as visual inspiration. Both later images use the first generated image as the
edit target to keep the comparison coherent.

The [PRD](../../../PRD.md) supplies the three story subjects. Era treatments
are artistic interpretations; they do not assert a universal regional style.
Geography, timeline placement, historical-image studies and effects are concept
renderings, not validated production data.

A useful next experiment would interpolate the materials and lighting while
scrubbing the time ruler. These still images establish the endpoints; they do
not demonstrate the transition or working navigation.

## Exact prompts

### 1348 — Ink and Vellum

Reference image: `docs/design/concepts/2026-09-25-explorations/paper-world.jpg`.

```text
Use case: ui-mockup.
Asset type: WANDER desktop app design study of one globe whose material language evolves as the user scrubs through historical time.
Primary request: create one extraordinarily beautiful, realistic, production-quality app screen. The same geography, view and UI anatomy will be retained across three historical dates. This image establishes the composition. The changing era should be expressed by materials, light, typography accents and historical content; orientation and interaction landmarks remain continuous.
Target dimensions: 1600 x 1000, landscape 8:5. A SINGLE full-screen desktop web application, straight-on UI, no browser chrome, device mockup, external title, collage, split screen, or specimen sheet. Everything fits naturally with no clipping.
Product: immersive history exploration on a continuously rotatable and zoomable relief globe. Stories advance through historical beats, with a calendar timeline, concise narrative, period-image study, Sources disclosure, Continue story, Layers and Meanwhile. It must feel immediately usable and magical, not a busy game or dashboard. All shown historical imagery and thematic overlays are concept studies. Today's date is 25 September 2026; display only the historical date below.
The reference image supplies the standard of tactile relief, beautiful editorial typography and gentle visual hierarchy. Recompose it into the fixed layout described next. Keep sophisticated craft, but use the specified new orientation and selected story; do not copy the reference's marketing-style heading, story catalog or camera view.

FIXED COMPOSITION, important:
- Warm base app canvas. Top left small spaced serif wordmark "WANDER" at x45, y35. Immediately beneath it at y90, a quiet left-arrow "Stories" affordance. At the top right a small "Layers" control and sound icon. No other top navigation.
- A complete spherical globe 770px in diameter centered at x650, y440, filling the middle-left with beautiful negative space around it. Its whole circular silhouette stays visible between y55 and y825. No armillary, stand or rings.
- Camera center around 15° E, 20° N: Africa in the lower middle, Europe above, the Mediterranean in the upper middle, the Arabian Peninsula and western Asia at upper right; India barely visible near the globe's right-hand limb. North is up. Recognizable real coastline geography, dramatically sculpted but consistent relief and bathymetry. Maintain exactly this camera orientation and globe silhouette for the series.
- A 330px-wide story column begins at x1200, y150 on the right, flush with the background, not enclosed inside a card. A small date line, two-line 38px serif title, 17px body with generous leading; then a horizontal historical-image study around 330 x 180px, a tiny caption, a Sources / Read more row, one 330 x 54px main "Continue story" button, and a quiet "Meanwhile, elsewhere" link. The column ends at y740. The image and UI may never overlap the globe.
- Bottom 110px is a fixed horizontal timeline across the page with a subtle separator above. A small circular Play control at x65,y909. A calibrated straight track runs x150 to x1530 at y905. Major year ticks are "1200" at x150, "1400" at x495, "1600" at x840, "1800" at x1185, "2000" at x1530; place intermediate decade ticks correctly. Years are evenly spaced; the current-date knob MOVES to the correct position for the year rather than re-centering the ruler. Highlight only the current year label above the knob, leaving other year labels below the track. This series demonstrates the same continuous time ruler through multiple eras.
- Beneath the globe at x280,y824, a discreet instruction "Drag to turn · Scroll to get closer".
Typography: one restrained contemporary oldstyle serif for display, one very readable humanist sans-serif for controls/body. The layout and type metrics should survive theme changes. Reading contrast must remain excellent. Surface detail is exquisite but labels sparse. No fake technological dashboard, metrics, extra tabs, search, login, all-stories card grid, loading indicator, decorative panels, huge fictional compass, illegible calligraphy, fantasy geography, or dense scatter of pins.

Concept name: Ink and Vellum.
Date: 1348, the Black Death.
This is a manuscript-inspired artistic interpretation of the era, not a claim that the historical world shared one universal map style. The digital UI remains simple and legible.
Material direction: a sumptuous yet airy pale-vellum atlas globe, warm ivory lowlands and sculpted layered paper ridges, mineral sage-green uplands, warm brown fine pen hatching, muted indigo-blue watercolor seas with inked sea-floor contours. Geographic relief feels made of delicately carved and layered vellum. Tiny tasteful gold-leaf accents along a few coast edges, only 2% of the surface, with fine ink place labels. A few light engraved geographic grid lines. The object's fine relief catches soft warm daylight from upper left. Background ivory with an almost imperceptible paper fiber, no tabletop, books or medieval scenery.
Historical effect: a small translucent madder-red watercolor wash over parts of southern Europe and fine muted red route threads around the Mediterranean, suggesting the story's spread. Only a few subtle dots. One small active wine-red halo near northern Italy labeled "The Black Death". This is illustrative, not a quantitative data map. Preserve globe material visibility.
All UI uses dark walnut/green-black ink. The highlighted timeline handle and Continue button use muted madder red. Fine ruled lines look like carefully laid ink, with no ornate parchment frame. No Gothic lettering, distressed illegible labels or arbitrary ornamental creatures.
Exact story text:
Date "1348"
Title "The Black Death"
Body "Trade routes connect distant cities. Along them, plague moves across the Mediterranean and into Europe."
Historical image study: a tasteful small illuminated-manuscript-style harbor scene with sailing vessels and medieval town architecture, no sick or dying people, shown in the right-column image slot. Small caption "Manuscript study".
Links "Read more" and "Sources".
Primary action "Continue story".
Quiet secondary link "Meanwhile, elsewhere".
Timeline: place current-date knob near x405 for 1348; the date "1348" is above that knob. All base ticks remain 1200,1400,1600,1800,2000 at their specified positions. Do not add a second date control.
The result should feel like an exquisite centuries-old atlas made touchable and alive inside a very clear contemporary history application.
```

### 1816 — Bronze and Enamel

Edit target: the first generated screen, saved here as `1348-ink-and-vellum.jpg`.

```text
Use case: style-transfer.
Asset type: a second WANDER era-state concept screenshot, edited from the supplied first screen.
Primary request: transform the supplied image from the manuscript year 1348 to the industrial-era year 1816. This is THE SAME APP AT A LATER POSITION ON ITS TIMELINE. The user's central idea is that materials age while the globe and navigation stay anchored.
Target dimensions: match the input exactly, landscape around 1600 x 1000 (8:5). One complete screen.
INPUT IMAGE ROLE: the attached Ink and Vellum screen is the EDIT TARGET and authoritative composition/geometry reference.

PRESERVE STRICTLY:
The same Africa–Europe–western Asia geography, globe orientation, whole round silhouette, mountain geometry, geographic extent, camera angle and globe center/radius. Preserve every UI element's position and footprint: upper-left WANDER and Stories, upper-right Layers/audio, the right-hand narrative column, date/title/body/image/links/button footprints, all margins and spacing, bottom ruler geometry, and drag hint. Preserve text hierarchy and reading type sizes. Do not add mechanical rings, a stand, pedestal, physical room or new tools. The globe must remain in the exact same screen position and orientation as the source.

CHANGE ONLY THE ERA EXPRESSION AND STORY:
Date advances to 1816; all theme materials, lighting and ink colors evolve coherently.
Globe land becomes extraordinarily sculpted, finely milled aged bronze with warm polished ridgeline edges and dark grooves, small controlled verdigris in valleys. Same terrain geometry as the source. Oceans become very dark teal enamel, with fine engraved bathymetric contours and visible sea-floor relief. Only delicate scientific meridians; avoid heavy antique ornament. Background becomes deep smoked green-charcoal, nearly black, with a gentle warm museum glow behind the globe. Light remains from upper left, now a warm low museum lamp; enough fill that continents and labels stay readable.
The same UI lines become thin aged-brass rules, main narrative text warm ivory, button amber-cream with dark ink, the exact same timeline track becomes a subtly satin-brass strip with engraved ticks and garnet-red playhead. Button and layout remain contemporary and restrained, no rivets, gearwork, Gothic type or ornament framing.
Remove all plague labels, red Mediterranean spread and medieval route traces. Instead a restrained pale blue / icy-cyan translucent climate tint lightly washes Europe and the North Atlantic, with underlying relief still visible. A single small cool-white focus near central Europe is labeled "Summer 1816". This is an illustrative rendering of the story's climate layer; do not add invented numerical data.
Exact right-column text:
Date "1816"
Title "A year without a summer"
Body "In the year after Tambora erupts, cold reaches far beyond Sumbawa. Across Europe, an unfamiliar summer unfolds."
Change the image in the SAME right-column slot to a tasteful sepia engraving-style landscape of fields and a rural village under a dramatic cold summer sky, small caption "Landscape study". Not a fake photograph and no fabricated historical artist credit.
Retain "Read more", "Sources", "Continue story", "Meanwhile, elsewhere", "Drag to turn · Scroll to get closer", "Stories", "Layers", "WANDER".
TIMELINE: preserve the same 1200–2000 scale and major tick positions exactly. Move the active knob from 1348 to 1816, just to the right of the 1800 tick, 8% of the distance from the source image's 1800 tick to its 2000 tick; label "1816" above it. Remove the old 1348 knob and label completely. The plot's spacing, height, Play control and ruler endpoints are otherwise unchanged.
Current calendar date is 25 September 2026; this scene's historical date is 1816. This is a new concept image at the specified later era, not a historical accuracy claim for the decorative material language.
Make the transformation striking but unmistakably the same object and interface. No collage.
```

### 1973 — The Scientific Atlas

Edit target: the first generated screen, saved here as `1348-ink-and-vellum.jpg`.

```text
Use case: style-transfer.
Asset type: a third WANDER era-state concept screenshot, edited from the supplied first screen.
Primary request: transform the supplied manuscript-era WANDER screen into a luminous scientific atlas at the year 1973. This is THE SAME APP AND GLOBE AT A LATER POSITION ON ITS TIMELINE. The user's central idea is that materials evolve as time moves, while navigation and the geographical view remain anchored.
Target dimensions: match the supplied image exactly, landscape around 1600 x 1000 (8:5). Single complete app screen.
INPUT IMAGE ROLE: the supplied Ink and Vellum screen is the EDIT TARGET and authoritative composition/geometry reference. Keep its geography and exact composition, but replace its medieval-inspired material treatment with the future-facing modern visual language below.

PRESERVE STRICTLY:
The same Africa–Europe–western Asia geographical view, entire round globe silhouette, orientation, scale, center, every recognizable coastline and relief shape. North up, Africa lower middle, Europe above, Arabia to the right. Preserve UI positions and footprints exactly: WANDER and Stories upper left, Layers/audio upper right, right-hand narrative column with date/title/body/illustration/links/button, fixed bottom time track and Play, the tiny drag hint, every margin and the font sizes. No new dashboard widgets, orbital satellites, extra panels, armillary rings or charts. The globe should look physically continuous with the other states.

NEW ERA AND MATERIALS:
Date is 1973. The same sculpted land becomes luminous pearl-white mineral / glazed scientific ceramic, with sharply readable fine relief and very subtle cool grey-green variation in lowlands. Oceans become deep transparent cobalt and petrol-blue optical glass, revealing the SAME carved sea-floor relief below. The globe feels illuminated from within very softly, with a thin pale blue optical rim and strong physical dimensionality. No see-through hollow sphere, laser wireframe or hologram, no neon cyberpunk.
Base app background is a calm deep midnight navy-blue, with a very subtle cool halo behind the globe. Light still comes from upper left, now soft cool-white scientific gallery light with warm glints at active events. Thin UI lines are pearl-grey or silver. White/ivory text, crisp and sparse. An amber marker and amber main action preserve warm human focus. Type metrics and the editorial serif remain the same, with contemporary sans-serif controls. Avoid an abrupt shift to an unrelated futuristic app.
Remove all plague wash, medieval route traces and old dates. A few thin luminous amber outlines softly identify petroleum areas in Arabia and the Persian Gulf without covering land relief. One tiny amber focus near the Gulf has the label "Oil embargo". A few lines may extend along sea routes in the eastern Mediterranean and Indian Ocean but keep the globe uncluttered. No invented statistics.
Exact right-column text:
Date "1973"
Title "Oil reshapes the world"
Body "An embargo turns petroleum into a source of global pressure. Follow the connections between oil, trade and power."
Replace the image in the SAME right-column image slot with a beautiful restrained monochrome editorial illustration resembling a late-twentieth-century printed halftone of a tanker and refinery; label "Industry study". No fake named source or real photograph attribution.
Retain all other interface wording and the same placements: "Read more", "Sources", "Continue story", "Meanwhile, elsewhere", "Drag to turn · Scroll to get closer", "Stories", "Layers", "WANDER".
TIMELINE: preserve the exact 1200–2000 scale, major tick positions, spacing, endpoints and Play control from the input. Move the knob to 1973, 86.5% of the distance from the source image's 1800 tick to its 2000 tick, just before the 2000 tick. Label "1973" above it. Remove the old 1348 knob/label completely. The date changes by moving the knob, never by moving the ruler or inserting another date widget.
The historical scene date is 1973; today is 25 September 2026. Materials are an artistic interpretation of this broad scientific / contemporary period.
Make this magical, calm and precise. The paper-to-glass transformation should be clear, and the layout should remain immediately familiar. No multiple screens or collage.
```

