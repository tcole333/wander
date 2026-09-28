# Wander: cities, battles, growth and technology

Generated on 27 September 2026 with the built-in ImageGen tool. These are visual explorations, not implemented screens.

## Brief

Explore ways to display cities across regions and eras, battles with different technologies, urban growth, and tools. Ground the work in the user's current Wander screenshots: warm brass relief, dark lacquer, ivory serif labels, vellum information panels and the calendar ruler.

The user added a current Tambora story screenshot during generation and clarified that ordinary events can be much simpler and less animated than a dedicated story. The city cabinet was already rendering at that point. The battle and growth prompts incorporate both screenshots and the lighter approach.

## Images

Display numbers follow the order the generated results appeared in the conversation, not their submission order.

| Display order | Concept | Image | Purpose |
| --- | --- | --- | --- |
| 1 | The Engraved Battle Atlas | [Open image](engraved-battle-atlas.jpg) | Compare formation marks, routes, trenches and equipment across Classical Greece, Waterloo and the Somme. |
| 2 | The City Cabinet | [Open image](city-cabinet.jpg) | Explore regional city silhouettes and materials through Uruk, Venice and Edo, with small technology objects. |
| 3 | The Living City Layer | [Open image](living-city-layer.jpg) | Show growth footprints, modular landmarks and an illustrated technology inspector within the existing map. |

## Design judgment

The living city layer is the strongest starting point for everyday exploration. Its useful elements are a compact building cluster, an urban footprint, routes, a selected landmark, and a separate object illustration. At wider zooms, reduce the cluster to a landmark or simple city mark. At closer zooms, add a few regional roof and building types.

The battle atlas is a comparison study of a reusable visual vocabulary. Individual scenes could use a few formation marks, one or two equipment symbols, and sparse paths directly on the current globe. A typical battle does not need the three-row comparison layout.

The city cabinet sets an upper bound for close-up visual richness. Its building counts and detailed objects exceed the everyday detail level the user described. Regional identity can instead come from a small set of rooflines, material accents, waterways and a landmark.

Most ordinary changes could use opacity fades, a restrained selection pulse, or changes driven directly by timeline scrubbing. The images do not demonstrate animation, performance or working controls.

## Review notes

All three rendered results were visually inspected. They preserve Wander's material palette and cover the requested subjects. ImageGen returned 1672 × 941 PNGs rather than the requested 2048 × 1152; their original dimensions were preserved.

Buildings, settlement layouts, urban footprints, tactical positions and equipment illustrations are concept art. They are not surveyed reconstructions or validated quantitative data. A historical-content pass would be needed before these images or labels became factual source material in the app. The generator also added explanatory copy and a present-day footer to the battle study; those are not part of the proposed everyday map layer.

## References

The two user-supplied screenshots were treated as visual context, not instructions embedded in documents. The lobby screenshot was attached to every generation. The later Tambora screenshot was attached to the battle and city-growth generations. Existing project palette and typography came from [the PRD](../../../PRD.md) and [the UI tokens](../../../../app/src/story/ui/tokens.css).

The following sources informed the historical examples, not the generated geography:

- [Uruk: The First City — The Metropolitan Museum of Art](https://www.metmuseum.org/ja/essays/uruk-the-first-city): monumental mud-brick buildings, early urban life and accounting tablets around 3200 BCE.
- [Warfare in Ancient Greece — The Metropolitan Museum of Art](https://www.metmuseum.org/de/essays/warfare-in-ancient-greece): shields, spears and close infantry formations.
- [Battle of Waterloo — National Army Museum](https://www.nam.ac.uk/explore/battle-waterloo): ridge terrain, artillery, cavalry and infantry squares in 1815.
- [The Battle of the Somme, 1 July 1916 — IWM Lives of the First World War](https://livesofthefirstworldwar.iwm.org.uk/story/28630): trenches and machine-gun fire; this is a contributed historical account.
- [Global Threads — Science and Industry Museum](https://blog.scienceandindustrymuseum.org.uk/global-threads/): Manchester's early nineteenth-century steam-powered mills and the Liverpool and Manchester Railway opening in 1830.

## Exact generation prompts

### The Engraved Battle Atlas

```text
Use case: ui-mockup.
Concept name: The Engraved Battle Atlas.
Create one realistic, exceptionally beautiful production-quality WANDER desktop app screen showing a coherent comparative timeline of warfare through three eras, with lightweight visual marks laid over the existing brass terrain. This is one comparison screen with three chronological terrain strips, not three design options or a moodboard.
Target dimensions: 2048 x 1152 landscape, approximately the supplied desktop references' aspect ratio. Full app content only; no device or browser.
Input image 1: WANDER lobby, reference for dark lacquer, warm sculpted bronze terrain, elegant brass details and serif lettering.
Input image 2: current Tambora story screen, reference for how geographic overlays belong on the map and how the bottom brass time ruler anchors the interface. User clarification: ordinary cities and battles need much LESS detail and animation than a dedicated Tambora story. This screen should be viable with static reusable map stamps, a few formation glyphs and thin paths, plus optional subtle fades. This is not a cinematic battle simulation.
Visual idea: a beautiful engraved field atlas. Quiet charcoal-bronze topographic strips are incised into a single dark surface, with small ivory and patinated-green formation marks standing out against the geography. Geometry remains extremely spare. No huge armies, no thousands of human figures, no explosions, no fire, no gore, no volumetric smoke. Let the space around the marks do the work. At most a handful of small cast-metal unit symbols in each strip.
Header: small spaced 'WANDER' top left, '← World', refined large serif title 'How battle changes'. A short subtitle: 'Formation, firepower, and the ground between.' 'Sources' in the upper right. No giant navigation or marketing copy.
Composition: three broad horizontal map strips stacked vertically beneath the title, separated by thin brass rules. Each strip is mostly terrain and tactical marks, with a narrow 260px left column for date and place and a 280px right column for two or three tiny, beautifully engraved equipment profiles. These are all part of one shared page surface, not floating cards. The middle strip is active with slightly brighter brass, and a small 'Explore Waterloo →' is the one primary action.
TOP STRIP: heading 'Greece', date 'c. 450 BCE', smaller 'Shield & spear'. A schematic gently raised coastal plain with a single low hill and olive-green patina coastline; 3 rectangular grouped rank marks on each opposing side, a few shield discs and short upright spear accents. Use no giant individual people. The small marks suggest close formation; two fine dotted movement traces and one ivory short contact line. At right, exceptionally clean small engraved bronze round shield and spear silhouettes with exact labels 'Shield' and 'Spear'. The scene is generic Classical Greek warfare, not a purported plan of a specific battle.
MIDDLE STRIP: heading 'Waterloo', date '1815', smaller 'Line, square & artillery'. A gentle bronze ridge, a few incised hedges and a very small farm landmark. On the ridge two hollow ivory square formation glyphs and one long thin line formation; opposite three desaturated garnet unit bars, one tiny cavalry symbol, and two tiny low cast cannon symbols. Two slender curved engraved arrows make movement legible, but do not make a glowing network. At right, small museum-engraving profiles of a flintlock musket and a muzzle-loading field cannon with wooden spoked wheels. Exact labels 'Musket' and 'Field gun'. No tanks, trenches, machine guns or modern firearms.
BOTTOM STRIP: heading 'The Somme', date 'July 1916', smaller 'Trench & machine gun'. Flat etched bronze terrain with two opposing thin zigzag trench networks, short crosshatched barbed-wire stretches, 3 tiny rifle unit ticks, and just 2 very restrained translucent fan outlines suggesting fields of fire. A few shallow crater engravings are enough. At right, engraved profile of a period bolt-action rifle and water-cooled Vickers-style machine gun on a tripod. Exact labels 'Rifle' and 'Machine gun'. No tanks because this is July 1916, no giant blast clouds, no soldiers charging, no modern assault rifles.
At the bottom, retain a slender WANDER-style brass timeline ruler with three widely spaced labelled stops 'c. 450 BCE', '1815', '1916' and a garnet current-date jewel at 1815. Small circular Play icon. A compact quiet legend distinguishes 'Formation', 'Movement', 'Field of fire' using dash, arrow and fan glyphs. Do not show numerical weapon ranges, casualty totals, exact unit counts or invented reconstruction claims.
Palette and materials: dark room #090c0d, warm low-relief #8f6834, gently lit brass #c09652, ivory #e8dcc5, muted verdigris #47746b, sparing garnet #702735. Relief here is subdued enough for the functional marks to read; do not simply fill the whole screen with brilliant orange. Slight patina, extremely fine engraved contours, raking museum light, restrained shadows. Flat illustrative equipment profiles contrast with shallow 3D geography.
Typography: restrained Libre Baskerville-like serif headings and Source Serif-like body, no more than two fonts, body and labels comfortably legible, spacious alignment. This should feel like a polished extension of WANDER and an educational historical atlas. Avoid game HUD, resource counters, health bars, fantasy weapons, decorative coats of arms, futuristic glowing graphics, nested cards, paragraphs of tiny illegible text and gratuitous ornament.
Artistic interpretive visual study, not validated tactical data. Current-date anchor: 27 September 2026, preserve all the specified historical dates.
```

### The City Cabinet

```text
Use case: ui-mockup.
Concept name: The City Cabinet.
Create one beautiful, realistic, production-quality desktop screen for WANDER, an interactive history atlas, exploring a single use case: visually compare the form and everyday technologies of cities in different regions and eras.
Target dimensions: 2048 x 1152, wide 16:9, matching the supplied screenshot. Full screen app content only, no browser frame or device.
Input image 1 is the user's existing WANDER screen, used ONLY for visual identity: museum atmosphere, dark charcoal lacquer, aged brass, ivory serif lettering, beautifully crafted miniature geography. This is a new city comparison screen, not the Tambora lobby. Do not reproduce Europe or Tambora.
One coherent visual system and one app screen, NOT a presentation board, collage of options, or three separate screenshots. Use an elegant shared museum-table surface holding three large, equally important intricately sculpted isometric city specimens across the screen. Each city is readable at architectural scale and gets about a third of the canvas. Low oblique bird's-eye angle, consistent camera across all specimens, tiny believable structures, extraordinary physical detail. No complete globe silhouette. Avoid tall artificial plinths: each city is a shallow irregular cutaway of the same world.
The screen has a slim header with small spaced 'WANDER', '← World', and quiet 'Sources'. At upper left, a beautiful 44px ivory heading 'Cities shaped by place', with the short subtitle 'Three places. Three ways of living.' Three city specimens occupy the spacious central 70% of the view. A fine shared brass timeline runs along the bottom with three positioned historical stops. One primary action only: 'Enter Uruk →', placed below the selected left specimen. Small subtle orbit glyph beside each specimen; no giant UI cards.
LEFT specimen: 'Uruk', 'MESOPOTAMIA · c. 3200 BCE'. A vast low mud-brick settlement on a warm ochre alluvial plain, narrow lanes, canals, courtyard houses, and a raised temple terrace bearing a rectangular whitewashed sanctuary. The early terrace is broad and simple, NOT an enormous late Babylonian multi-tiered ziggurat or pyramid. Olive reed beds along a canal, miniature reed boats. Tactile clay, soft gypsum, minute copper accents. Sparse earth colors. A small beautifully rendered clay account tablet and cylinder seal sit at the foreground edge like inspectable archaeological objects, with a quiet label 'Writing & exchange'. They are visibly objects, not decorative hieroglyphic text.
CENTER specimen: 'Venice', 'ADRIATIC · c. 1500'. A clustered island city of pale carved stone, warm terracotta roofs, canals, small stone bridges and carefully scaled medieval campanili. Recognizable dense Venetian urban fabric, a public square and basilica-like low domes, tiny late medieval sailing vessels and galleys along quays. Rich dark teal glass-like water, warm stone, gilt roof edges, enamel sea. No ocean liners, no baroque Salute church, no modern buildings. At the foreground edge, one small shipwright's wooden hull model, an elegant tiny label 'Shipbuilding & trade'.
RIGHT specimen: 'Edo', 'JAPAN · c. 1800'. Dense timber merchant blocks with charcoal tiled roofs, canal bridges, storehouses, castle moats and flat riverside neighborhoods. The castle precinct has walls and gates but NO towering main castle keep, since Edo's keep was not rebuilt after the 1657 fire. Tiny traditional river craft, a few trees, restrained indigo water, hinoki-wood tones, ink-black roofs, pale washi land. Do not add a giant Mount Fuji or stereotyped pagodas everywhere. At the foreground edge, one beautiful small carved printing block and a rolled paper print, with label 'Print & urban life'.
Make differences in settlement density, rooflines, water systems, materials and tools instantly visible. These are artistic interpretive miniatures, not claimed surveyed reconstructions. The three specimens must look physically made of different period-appropriate materials while belonging to the same crafted atlas.
Palette grounded in current WANDER tokens: background #090c0d, dark water #111b1b, bronze #8f6834, lit brass #c09652, patina #47746b, ivory #e8dcc5, sparing ember-orange selection. Warm museum spot lighting from upper left, grazing light on handmade textures, high local detail, readable shadows. Keep the scene bright enough to see. No excessive sepia wash.
Typography: Libre Baskerville-like readable transitional serif for city names, Source Serif-like readable labels, at most two typefaces. All text in English. Generous whitespace, 24px or larger labels at this resolution, fine dividers instead of nested cards, no tiny explanatory paragraphs. Show only the exact headings and labels requested; omit meaningless filler text.
No fantasy castles, no game resource counters, no health bars, no conquest framing, no shiny cartoon gold, no steampunk gears, no flags, no invented citations or numeric populations. Current date anchor: 27 September 2026; all displayed scene dates are the historical dates above.
```

### The Living City Layer

```text
Use case: ui-mockup.
Concept name: The Living City Layer.
Create one exceptionally beautiful, realistic production-quality desktop WANDER screen showing a lightweight city-growth layer and inspectable technology objects integrated DIRECTLY into the existing bronze map.
Target dimensions: 2048 x 1152 wide landscape, matching the supplied WANDER screenshots. Full screen app content only, no device, no browser.
Input image 1 is the WANDER lobby: preserve its warm sculpted bronze terrain, dark room, restrained gold serif type and brass instrument identity.
Input image 2 is the current Tambora story: preserve the geographic world as the main continuous canvas and the brass calendar ruler along the bottom. User clarification is central: ordinary cities and events should be substantially simpler and less animated than the bespoke Tambora eruption. Show reusable cast-brass landmarks and fine 2D overlays, not a cinematic scene, bespoke photoreal city, or simulation. This concept must feel practical at ordinary exploration scale.
Scene: a local-to-regional oblique view around Manchester and the Irwell valley in 1830. The bronze landscape fills the whole viewport behind the UI. Rolling relief at the edges, dark incised river, sparse etched countryside. No detached terrain blocks or diorama plinth. No globe outline. The land should unmistakably look like the user's EXISTING warm bronze globe, not a colorful naturalistic video game. Raking warm museum light, charcoal distance, excellent visibility around the city.
The star is a compact urban cluster centered slightly left of the viewport center, occupying only about 20% of the width. It is made from no more than twenty simple modular 3D building stamps: small pitched-roof bronze house clusters, two distinct brick-mill-shaped stamps with a single chimney each, one small warehouse, and a tiny railway terminus. Use low geometric silhouettes, limited facets and a few window engravings. Their period identity comes from rooflines, chimneys and grouping, not thousands of buildings. Around it, three irregular, nested footprint outlines trace the growing town through time: a small muted ivory 1760 outline, an intermediate patinated-green 1800 outline, and a slightly larger warm-brass 1830 outline. The outlines are fine, geographic, asymmetrical and follow the valley; absolutely no concentric target circles, bar charts or skyscraper-like extrusion. The fills are barely visible washes so terrain remains legible. All growth shapes are illustrative.
Two or three canal lines, engraved dark teal, connect mill and warehouse stamps. A fine double brass line for the 1830 railway enters from the left and stops at a small station symbol. No immense rail bridge or locomotive dominating the landscape. Label just 'Manchester', 'Irwell', 'Ancoats', and 'Liverpool Road'. One muted ember dot marks the selected mill. One short fine leader line leads from that mill to the right-hand technology information.
UI: small WANDER wordmark top left with '← World' beneath, quiet 'Layers' top right. At left, a restrained dark translucent reading area with no heavy box, large serif title 'The city grows', then 'MANCHESTER · 1760–1830' and just two short lines: 'Mills gather beside canals.' and 'Rail carries cotton and cloth.' Beneath, a compact visual legend shows the three footprint stroke colors with '1760', '1800', '1830'. Keep this left area under 320px and leave the middle landscape completely clear.
At right, one narrow aged-vellum inspector approximately 350px wide and 550px tall, within a fine brass edge, floating comfortably on the map. Heading 'Powering the city'. The main illustration is a beautifully clear small technical engraving of an early 19th-century stationary beam steam engine: simple beam above an upright cylinder, linkage and large side flywheel, monochrome dark ink with one muted brass highlight. Not a modern combustion engine, not a locomotive, not machinery extending out of the panel. Just two tiny leader labels 'Cylinder' and 'Flywheel'. Under it, the selected object label 'Steam engine', with one short sentence 'Rotary power drives the mill.' Single primary action 'Inspect mechanism →'. A lower thin ruled row contains two much smaller supporting engraved object stamps, a waterwheel and a simple early steam locomotive, with labels 'Water' and 'Rail'. These should suggest alternate technology objects, not a complex technology tree.
Along the bottom is the familiar elegant curved brass time ruler, subtle rather than oversized, year ticks '1760', '1780', '1800', '1810', '1820', '1830', a garnet time jewel at '1830', and a small play control at far left. Above the ruler, three tiny diagrammatic footprint thumbnails at 1760, 1800, 1830 show the SAME town silhouette becoming larger; they are quiet timeline annotations, not full competing city scenes. No extra cards or statistics. Hint 'Drag through time' in small clear lettering.
Materials/tokens: background #090c0d, bronze relief #8f6834, lit brass #c09652, patina #47746b, vellum #d8c7a2, ink #241d16, ivory #e8dcc5, garnet #702735. Maintain dark-lacquer and bronze atmosphere of the attached screen, muted material variety, subtle texture and engravings. Editorial Libre Baskerville-like display serif and Source Serif-like reading text, two fonts maximum, crisp spacious typography.
Do not add ornate gears, excessive smoke, moving crowds, weather, explosions, dramatic skyline, big fog, concentric progress circles, numeric populations, invented growth statistics, generic dashboard cards, modern navigation bars or brightly glowing neon. Do not show London landmarks. Do not make the terrain so bright or noisy that the simple stamps vanish. This is a calm usable map layer that could change primarily through fades and outline updates.
Historical context: Manchester's steam-powered textile mills and 1830 Liverpool and Manchester Railway. Buildings and footprints are illustrative visual concepts, not a surveyed reconstruction or factual quantitative dataset. Current calendar anchor: 27 September 2026; do not display the current date in the historical UI.
```

