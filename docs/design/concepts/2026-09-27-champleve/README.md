# Wander: champlevé on the bronze globe

Generated on 27 September 2026 with the built-in ImageGen tool.

## Brief

The user asked for historical visuals rendered onto the current bronze base, suggesting champlevé enamel. They previously clarified that ordinary exploration layers can be much less detailed and animated than the dedicated Tambora story.

These concepts preserve the current screenshots' bronze relief, dark lacquer water, warm grazing light, serif labels and brass time ruler. Colored historical information is interpreted as shallow inlay within the terrain. The geography is newly generated regional scenery; these are material mockups, not pixel-identical edits or captures of an implemented renderer.

## Images

Numbers match the order the generated images appeared in the conversation.

| Display order | Concept | Image | Application |
| --- | --- | --- | --- |
| 1 | Cities in Fired Glass | [Open image](cities-in-fired-glass.jpg) | Small architectural pictographs and a ship mark around Venice, c. 1500. |
| 2 | Battle Lines in Enamel | [Open image](battle-lines-in-enamel.jpg) | Cobalt and oxblood formation marks, hollow infantry squares and sparse equipment symbols at Waterloo, 1815. |
| 3 | A City Accretes in Enamel | [Open image](city-growth-in-enamel.jpg) | Irregular ivory, turquoise and blue growth districts with small tools and power symbols around Manchester, 1760–1830. |

## Material direction

Champlevé provides the organizing idea: recessed colored glass separated by exposed metal. [The V&A describes its carved or etched enamel fields](https://www.vam.ac.uk/articles/metalworking-techniques), and [The Met explains how recesses are formed and filled](https://www.metmuseum.org/fr/perspectives/metalworking-champleve-enameling).

For Wander, keep the original bronze terrain exposed around each mark. Use a narrow bare-metal shoulder and subtle inner shadow at the enamel edge; let the glass catch the same light as the terrain. Color identifies the historical information. It does not replace the world material.

The city pictograph is useful at regional scale. Formation shapes provide a compact battle vocabulary. Irregular enamel cells offer a closer city-growth view. Small technological symbols can share the same inlay treatment.

## Review

All three outputs were visually inspected. Each retains a bronze-dominant surface and integrates the colored historical marks into that surface. The generation sometimes gives small equipment symbols a raised edge; a renderer implementation could make these flatter. The growth image uses more district cells than requested and would benefit from reduced detail at wider zooms.

The city and growth outputs are 1672 × 941 PNGs; the battle output is 1671 × 941. All were preserved at their generated size; prompts requested 2048 × 1152. These images show appearance only. No application code, animation, geographic datasets or shaders were changed.

Settlement locations, battlefield arrangements, city footprints and equipment symbols are illustrative. They are not a validated reconstruction. The battlefield legend's arrow should be labelled Movement rather than Artillery in a production interface.

## References supplied to ImageGen

Both user screenshots were attached to every generation: the current bronze lobby and the current Tambora story view. They were used as visual context. The generated city-enamel image was also attached to the battle and growth calls for continuity.

Project palette and typography were taken from the existing [PRD](../../../PRD.md) and [UI tokens](../../../../app/src/story/ui/tokens.css). Historical background for the reused Waterloo and Manchester examples is listed with the [preceding concept set](../2026-09-27-world-details/README.md).

## Exact generation prompts

### Cities in Fired Glass

```text
Use case: ui-mockup.
Create a realistic, production-quality visual concept for WANDER, an interactive historical globe.
Target dimensions: 2048 x 1152 landscape, matching the user's desktop screenshots.
REFERENCE IMAGE 1: the actual current WANDER bronze globe lobby. REFERENCE IMAGE 2: the actual current Tambora story. Both are MATERIAL AND PRODUCT REFERENCES. Preserve the distinctive current base: rugged cast bronze topography, warm copper-gold grazing light, dark oxidized valleys, near-black lacquer water, restrained ivory serif lettering, and brass calendar instrument. Keep this base visually close to the screenshots.
NEW USER REQUEST: the historical visuals are rendered DIRECTLY ONTO THIS EXISTING BRONZE BASE, perhaps as champlevé enamel. The point is to see inlaid visual information as part of the globe's surface. Earlier floating miniature dioramas were too separate from the surface.
CRITICAL MATERIAL: champlevé means shallow cavities cut into the bronze, filled with fused opaque vitreous enamel. Enamel is flush with or just BELOW the bronze surface. Bare metal is left between the enamel cells and catches the same warm key light as the terrain. Fine dark bevel shadow at the cavity edge; glassy highlights, minute surface irregularities, tiny enamel specks, restrained wear. The relief bends continuously through the inlay. NO separate plaques, disks, badges, pins, plinths, floating tiles, cutaway terrain blocks, tall 3D buildings or models standing on top. NO thick added cloisonné wire, jewels, gemstones, embossed toy scenery or translucent neon holograms.
Enamel is local information. At least 80 percent of visible land remains the ORIGINAL bare warm bronze, and water remains dark lacquer. Do not enamel the entire landscape. Use only 3 or 4 colors per image: deep lapis blue, muted turquoise, warm ivory and occasional iron red. Enamel is reflective, NOT luminous or emissive.
Everyday layer scale and complexity: sparse reusable marks with a readable silhouette, useful even with no animation. No smoke, flames, crowds or spectacle.
One coherent app screen, no multi-option grid, no moodboard, no device, no browser frame. The terrain occupies nearly the whole viewport. Small WANDER upper left, restrained compact title beneath, quiet Layers upper right, one modest dark-brass inspection label for the selected place, and the familiar thin brass year ruler along the bottom. No giant story panel, technology dashboard, sidebar inventory or redesign of the product identity. Typography is Libre Baskerville-like and Source Serif-like, legible, with generous spacing. All text English.
Current date is 27 September 2026; display only the historical dates specified in the scene. These are artistic material explorations rather than verified surveyed history.

Concept name: Cities in Fired Glass.
Show a close regional view of the upper Adriatic and Venice around 1500, with bronze Alpine foothills near the upper edge, cast-bronze mainland across the left and top, dark Adriatic water across the lower right, and the Venetian lagoon as a delicate dark inset. This should look like zooming into the user's current bronze globe.
One primary scene: a beautifully legible ENAMELED CITY EMBLEM at Venice, approximately 230 pixels wide in the finished screen. The emblem is an old cartographer's compact town pictograph engraved straight into the surface near the lagoon. It represents a campanile, a low domed basilica, 8 simple roof shapes and a few canal lanes. All architecture is DRAWN AS FLAT ENAMEL CELLS within the bronze; it must not have real 3D building height, individual windows, cast shadows from towers or a raised base. The city silhouette is irregular and merges directly into surrounding bare terrain with no enclosing circle or rectangular plaque. Warm ivory cells for walls, a few iron-red roof cells, deep blue cells within the canals; thin uncut bronze defines architectural lines.
At a quiet smaller scale, two related sparse enameled town pictographs near 'Padua' and 'Ravenna' suggest how the layer behaves across a region. Each is only 4–6 simple cells. Scale difference emphasizes the selected Venice mark.
A fine incised bronze trade route curves out over dark water, with one small FLUSH enamel late-medieval galley silhouette, deep cobalt hull and warm ivory sail, roughly 50 pixels long. No giant ship model.
At the upper left exact small title 'Cities in enamel' and historical date 'ADRIATIC · c. 1500'. Beside the selected mark exact label 'Venice'. One tiny selected-city detail line: 'Port city · Shipbuilding'. A quiet action 'Explore city →'. Place labels are small and do not cover enamel.
Lighting must visibly connect the enamel to the original cast metal: a highlight crosses from bronze lip to shallow smooth glass; enamel cavities follow the curved relief. Camera a close oblique atlas view, enough macro material detail to appreciate the inlay, but still geographic rather than a standalone product photo.
Do not change the world to ceramic, paper, bright green terrain or a jewelry plate. No photoreal city reconstruction. The enchantment comes entirely from a few luminous-looking BUT NON-EMISSIVE glass colors recessed INTO THE USER'S CURRENT BRONZE MAP.
```

### Battle Lines in Enamel

```text
Use case: ui-mockup.
Create a realistic, production-quality visual concept for WANDER, an interactive historical globe.
Target dimensions: 2048 x 1152 landscape, matching the user's desktop screenshots.
REFERENCE IMAGE 1: the actual current WANDER bronze globe lobby. REFERENCE IMAGE 2: the actual current Tambora story. Both are MATERIAL AND PRODUCT REFERENCES. Preserve the distinctive current base: rugged cast bronze topography, warm copper-gold grazing light, dark oxidized valleys, near-black lacquer water, restrained ivory serif lettering, and brass calendar instrument. Keep this base visually close to the screenshots.
NEW USER REQUEST: the historical visuals are rendered DIRECTLY ONTO THIS EXISTING BRONZE BASE, perhaps as champlevé enamel. The point is to see inlaid visual information as part of the globe's surface. Earlier floating miniature dioramas were too separate from the surface.
CRITICAL MATERIAL: champlevé means shallow cavities cut into the bronze, filled with fused opaque vitreous enamel. Enamel is flush with or just BELOW the bronze surface. Bare metal is left between the enamel cells and catches the same warm key light as the terrain. Fine dark bevel shadow at the cavity edge; glassy highlights, minute surface irregularities, tiny enamel specks, restrained wear. The relief bends continuously through the inlay. NO separate plaques, disks, badges, pins, plinths, floating tiles, cutaway terrain blocks, tall 3D buildings or models standing on top. NO thick added cloisonné wire, jewels, gemstones, embossed toy scenery or translucent neon holograms.
Enamel is local information. At least 80 percent of visible land remains the ORIGINAL bare warm bronze, and water remains dark lacquer. Do not enamel the entire landscape. Use only 3 or 4 colors per image: deep lapis blue, muted turquoise, warm ivory and occasional iron red. Enamel is reflective, NOT luminous or emissive.
Everyday layer scale and complexity: sparse reusable marks with a readable silhouette, useful even with no animation. No smoke, flames, crowds or spectacle.
One coherent app screen, no multi-option grid, no moodboard, no device, no browser frame. The terrain occupies nearly the whole viewport. Small WANDER upper left, restrained compact title beneath, quiet Layers upper right, one modest dark-brass inspection label for the selected place, and the familiar thin brass year ruler along the bottom. No giant story panel, technology dashboard, sidebar inventory or redesign of the product identity. Typography is Libre Baskerville-like and Source Serif-like, legible, with generous spacing. All text English.
Current date is 27 September 2026; display only the historical dates specified in the scene. These are artistic material explorations rather than verified surveyed history.

Concept name: Battle Lines in Enamel.
The third supplied image is the new WANDER city-enamel concept. Use it as a reference for the successful bronze base, restrained composition and small locally colored historical marks. Change the setting to Waterloo, 18 June 1815, and change pictorial cities to a simpler TACTICAL ENAMEL vocabulary. Do not reproduce its coast or Venice.
One continuous oblique view of the bronze landscape around Waterloo, gentle ridges and a few engraved rural roads, warm rough metal everywhere, a small stream in dark patina. Avoid turning it into a detailed realistic countryside. Do not add natural grass, trees, hundreds of buildings or soldiers.
In the middle 40 percent of the screen, two sets of shallow ENAMELED FORMATION SHAPES are cut straight into the existing metal terrain: cobalt blue for one side and deep oxblood red for the other, with a handful of ivory accents. Just 7–9 small shapes total. Some are long narrow bars for infantry lines, two are hollow square outlines for defensive squares with bronze interior untouched, one is a short tapered cavalry group. These shapes follow the terrain perspective and slight curvature. They are not raised pieces, containers, gems or military board-game tokens. Their upper surfaces sit a hair BELOW the uncut bronze. Every cavity has a narrow golden exposed bronze shoulder, very soft dark inner bevel, and a low glassy specular glint.
Use 2 compact figurative EQUIPMENT MARKS integrated directly in the landscape near appropriate formations: a simplified flat gun carriage with one bronze wheel and tiny ivory/cobalt enamel barrel, and a tiny crossed-sabres silhouette in bare bronze with an oxblood handle accent. No enclosing shield, coin, disk or badge around these symbols. No 3D cannons or horses. The aim is 2D historical illustration becoming a shallow material layer.
Two exceedingly fine engraved routes with small arrowheads show movement. One pale ivory stippled curved arc hints at artillery influence, avoiding a filled heatmap. Keep the total battle annotation area small relative to the bronze map. Labels only 'Mont-Saint-Jean', 'Hougoumont', 'La Haye Sainte' in readable ivory; exact positions and force order are illustrative.
Near upper left below the small WANDER header: 'Battle lines in enamel', then 'WATERLOO · 18 JUNE 1815'. A very compact dark-brass focus panel at the right edge, about 250px wide, with heading 'Infantry square', a single small enamel hollow-square glyph, the short line 'A formation against cavalry.' and action 'Explore battle →'. This panel is UI only; it must not hide the terrain or become a large story card.
Bottom brass calendar ruler shows '16 JUN', '17 JUN', '18 JUN', '19 JUN', '20 JUN', current date plate '18 JUNE 1815', small Play on left. Along the ruler's upper edge a tiny uncluttered legend uses the SAME enamel marks for 'Line', 'Square', 'Artillery'. No modern map toolbar, health bars or resource counts.
Beauty comes from the contrast between rough bronze and tiny smooth red/blue/ivory inlays, warm gallery lighting, patinated recesses and exact edges. Include enough close grazing light that the material convincingly reads as fired glass INSIDE carved bronze cavities, NOT painted UI floating above terrain.
No explosions, smoke, huge human figures, death, chaos, dramatic clouds or animated battle spectacle. One sparse reusable everyday battle layer.
```

### A City Accretes in Enamel

```text
Use case: ui-mockup.
Create a realistic, production-quality visual concept for WANDER, an interactive historical globe.
Target dimensions: 2048 x 1152 landscape, matching the user's desktop screenshots.
REFERENCE IMAGE 1: the actual current WANDER bronze globe lobby. REFERENCE IMAGE 2: the actual current Tambora story. Both are MATERIAL AND PRODUCT REFERENCES. Preserve the distinctive current base: rugged cast bronze topography, warm copper-gold grazing light, dark oxidized valleys, near-black lacquer water, restrained ivory serif lettering, and brass calendar instrument. Keep this base visually close to the screenshots.
NEW USER REQUEST: the historical visuals are rendered DIRECTLY ONTO THIS EXISTING BRONZE BASE, perhaps as champlevé enamel. The point is to see inlaid visual information as part of the globe's surface. Earlier floating miniature dioramas were too separate from the surface.
CRITICAL MATERIAL: champlevé means shallow cavities cut into the bronze, filled with fused opaque vitreous enamel. Enamel is flush with or just BELOW the bronze surface. Bare metal is left between the enamel cells and catches the same warm key light as the terrain. Fine dark bevel shadow at the cavity edge; glassy highlights, minute surface irregularities, tiny enamel specks, restrained wear. The relief bends continuously through the inlay. NO separate plaques, disks, badges, pins, plinths, floating tiles, cutaway terrain blocks, tall 3D buildings or models standing on top. NO thick added cloisonné wire, jewels, gemstones, embossed toy scenery or translucent neon holograms.
Enamel is local information. At least 80 percent of visible land remains the ORIGINAL bare warm bronze, and water remains dark lacquer. Do not enamel the entire landscape. Use only 3 or 4 colors per image: deep lapis blue, muted turquoise, warm ivory and occasional iron red. Enamel is reflective, NOT luminous or emissive.
Everyday layer scale and complexity: sparse reusable marks with a readable silhouette, useful even with no animation. No smoke, flames, crowds or spectacle.
One coherent app screen, no multi-option grid, no moodboard, no device, no browser frame. The terrain occupies nearly the whole viewport. Small WANDER upper left, restrained compact title beneath, quiet Layers upper right, one modest dark-brass inspection label for the selected place, and the familiar thin brass year ruler along the bottom. No giant story panel, technology dashboard, sidebar inventory or redesign of the product identity. Typography is Libre Baskerville-like and Source Serif-like, legible, with generous spacing. All text English.
Current date is 27 September 2026; display only the historical dates specified in the scene. These are artistic material explorations rather than verified surveyed history.

Concept name: A City Accretes in Enamel.
Reference image 3 is the new WANDER city-enamel concept. Preserve its unaltered-looking bronze base and locally colored historical marks, but explore urban growth through ABSTRACT INLAID DISTRICTS, not another pictorial city skyline.
One continuous close atlas view of Manchester's Irwell valley, current year 1830. Warm rugged bronze all around, narrow dark carved river flowing from upper center through the city toward the lower left. The city is a compact irregular map-shaped group of recessed enamel CELLS that occupy at most 18 percent of the screen. At least 80 percent of all land stays exposed original bronze. No fully enameled map and no naturalistic city.
City composition in the middle-right: approximately 16 broad low-complexity enamel district cells of unequal sizes, separated by the original uncut bronze street strips. The city's changing footprint is legible from three modest color families: a few warm ivory cells at the oldest core, muted turquoise cells spreading along the river, and deep blue cells stretching toward the 1830 railway. These are geographic patches, not circular concentric rings or equally sized mosaic tiles. The edges are irregular but composed, with a few clean angular boundaries following streets and waterways. The enamel follows the map's curved and ridged bronze substrate; smooth low specular glints sit inside the small recesses. Thin slightly rounded exposed bronze edges, dark inner lip, rich fused glass, NO elevated border wire, no chrome.
Within SOME larger enamel cells, leave a few tiny bare-bronze line drawings visible as a reserve pattern: three roof marks, one mill with a chimney, one warehouse. These are simple engraved silhouettes and not three-dimensional buildings. All pattern details are shallow enough to be effectively flat at map scale.
A slender dark-teal canal channel passes through the turquoise district. A thin double bronze railway reaches the blue edge, with one tiny FLUSH ivory-and-cobalt early steam-locomotive pictograph inset near its terminus, about 65 pixels wide. This is an enamel object illustration, not a model, sticker or stand.
Three SMALL technological motifs connect to the town, each shaped directly in the ground with no badge or disk: a warm ivory spindle/shuttle near the old core, a turquoise-and-ivory waterwheel beside the river, and an ivory-and-cobalt beam-engine silhouette beside an industrial cell. These use 3 or 4 bold enamel cavities and bronze linework, no tiny mechanical detail and no gear-decoration wallpaper. The selected steam-engine motif is slightly brighter from reflected lamp light, with a very small label 'Steam power'. All tools remain tiny secondary marks.
UI is minimal and familiar: small WANDER upper left; title 'A city grows in glass'; date 'MANCHESTER · 1760–1830'; below it a calm three-item legend with color strokes labelled '1760', '1800', '1830'. Keep most of the left half open bronze. A compact dark-brass tooltip near the selected engine reads 'Steam power' and 'Mills spread along the canals.' with a quiet 'Inspect →'. No large side panel or standalone object gallery.
Only two geographic labels: 'Manchester' beside the enamel town and 'Irwell' on the river. Bottom has the current familiar brass year ruler with 1760, 1780, 1800, 1810, 1820, 1830; its current-date plate reads '1830'. Small play control. No history thumbnails or charts: the city itself carries the visual story.
Mood is tactile, calm, sophisticated: shallow fired-glass inlays on the SAME bronze map in the user's screenshots. Smooth deep blue contrasts with bumpy warm bronze. Raking light catches the edges without any self-emission. Keep graphic forms beautiful, quiet and easy to read at everyday atlas zoom.
Do not render skyscrapers, 3D houses, architectural miniatures, clay models, pendant charms, many factory chimneys, smoke, game boards, embossed tokens, stained-glass landscape mountains, glowing zones or unrelated brass machines. Urban boundaries are explicitly illustrative and must not be presented as surveyed historical growth data.
```
