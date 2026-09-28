# Magellan–Elcano draft: issue #63

The draft has ten beats from Sanlúcar on 20 September 1519 to the Victoria's return on
6 September 1522. `story.md` credits Codex and distinguishes the reconstructed track and later
illustrations from observations. `data/route.geojson` follows the Trinidad through Mactan, then
the Victoria. The story schema accepts a named `route` effect with the same fields and defaults
as `spread`; neither effect is built by that schema.

The app's entry point, lobby, effect implementation and audio are unchanged. This story is not
wired into the site. There is no media lock or authored Meanwhile file. The separate fact-check
and the owner's voice edit remain the next editorial steps; this handoff is their source map.

## Source key

Page references below are printed pages, not Internet Archive image numbers. The story gives
full title, author, publisher, year and URL for every cited work.

- **P**: Antonio Pigafetta, translated and edited by Lord Stanley of Alderley,
  [The First Voyage Round the World, by Magellan](https://archive.org/details/firstvoyageround00piga),
  Hakluyt Society, London, 1874, account on pp. 35–163.
- **A**: Francisco Albo, “Log-Book of Francisco Alvo or Alvaro,” in the same
  [Stanley volume, pp. 211–236](https://archive.org/details/firstvoyageround00piga/page/211/mode/2up).
  This is an abridged log: brackets and omissions matter, particularly in the Indian and final
  Atlantic passages.
- **T**: Maximilianus Transylvanus, letter about the voyage, in the same
  [Stanley volume, pp. 179–210](https://archive.org/details/firstvoyageround00piga/page/179/mode/2up).
  This is a contemporary report from returned participants, not an eyewitness diary aboard.
- **R1 / R2**: Antonio Pigafetta, translated and edited by James Alexander Robertson,
  [Magellan's Voyage Around the World, volume 1](https://archive.org/details/magellansvoyagea01piga)
  and [volume 2](https://archive.org/details/magellansvoyagea02piga), Arthur H. Clark, Cleveland,
  1906. Separate editorial notes are identified as such below.
- **E**: Juan Sebastián Elcano, letter to Charles V, Sanlúcar, 6 September 1522, extract and
  manuscript image in the Archivo General de Indias / Acción Cultural Española exhibition
  [The Longest Voyage: The Return](https://artsandculture.google.com/story/the-longest-voyage-the-return/zAVhmCkls3oeTA),
  section “Elcano's letter to Emperor Charles V,” manuscript leaf 2r. The draft uses that
  displayed extract, not an assertion that the whole manuscript has been transcribed here.

## Beat-by-beat fact-check map

There are **no direct quotations** in the ten paragraphs. Albo's flying canoes, Pigafetta's
counts and Elcano's letter are paraphrased. Dates, quantities and qualitative claims follow.
Image dates and depicted counts have their own table below. Camera widths, targets, crops,
the seven-day route width and the choice of a representative day for a month are authored
presentation values, not measurements reported by the witnesses.

| Beat | Every historical date and count in the paragraph or beat fields | Other claims and source locations |
|---|---|---|
| `sanlucar-out` | **20 September 1519**, departure and beginning of window: P p. 40. **Five ships**: P pp. 36, 39; T pp. 187–188. Window ends **3 October 1519**, departure from Tenerife: P p. 41. | Magellan's Portuguese origin and service to Charles, western spice project: P pp. 36–40; T pp. 187–188. Night light and following the flagship: P p. 37. Trinidad as flagship: P p. 58. Pigafetta's reasons for joining and writing: P pp. 35–36. The river mouth is a modern geographic identification of the named port. |
| `brazil` | **13 December 1519**, arrival: A p. 213; Stanley's chronology p. lix. **Five fowls for a playing card**: P p. 43. Window **3 October–27 December 1519**: P p. 41 and A p. 213. | Rain and contrary winds off Africa: P pp. 41–42. North Star lost: P p. 43. Food, barter and Pigafetta's card: P p. 43. Cotton hammocks and fires: P p. 44. A dates Rio departure to 27 December; Stanley's introductory chronology gives 26 December. The draft follows the log for that boundary. |
| `san-julian` | **31 March 1520**, arrival; **24 August 1520**, departure and end of window: A p. 218. No exact mutiny day or winter duration is asserted in the paragraph. | Reduced allowance and requests to return: T pp. 192–193. Mendoza stabbed, Quesada beheaded, Cartagena and the priest abandoned, Santiago wrecked: P p. 56. Caulking the surviving ships and waiting: P pp. 56–57. The events span the stay; the opening date does not date every punishment. |
| `strait` | **21 October 1520**, entrance and beginning of window: P p. 57; A p. 218. **28 November 1520**, Pacific exit: P p. 64. **Three remaining ships** follows Santiago's loss (P p. 56) and San Antonio's desertion (P pp. 59–60); the three-ship Pacific passage is also explicit in R1 pp. 83–85. | Successive narrows and bays, snow and lines carried ashore: P pp. 57–59; A pp. 219–220. San Antonio turns home: P pp. 59–60. Scouting boat, open sea, Magellan's tears and Cape of Desire: P p. 60. The course follows the modern strait's main channel, not each reconnaissance branch. |
| `pacific` | **February 1521** is the displayed precision. The representative **1 February** and **13° S** latitude are A p. 222; the longitude is reconstructed. Window begins **28 November 1520**, P p. 64, and ends **5 March 1521**, the editorial day before the 6 March landfall, P p. 68 / A p. 223. **Nineteen deaths from sickness, besides a Patagonian and a Brazilian**: R1 pp. 83–85. | Calm sea, biscuit dust, worms and rat filth, yellow water, oxhide soaked and warmed, rats, swollen gums, islands without anchorage: R1 pp. 83–85; A pp. 221–223. Do not turn nineteen into the total loss: Pigafetta adds the two captives separately. The draft does not repeat his inconsistent “three months and twenty days” as an elapsed-time calculation. |
| `guam` | **6 March 1521**, arrival: P p. 68; A p. 223. **Seven islanders killed**, attributed to Pigafetta: P p. 68. Window ends **9 March 1521**, A p. 224. | Triangular mat sails and reversible bow/stern: P p. 70. Albo's comparison to flight: A p. 223. Skiff taken, expedition ashore, houses and boats burned: P p. 68. Pursuing canoes, stones, women crying and tearing their hair: P p. 69. The skiff belongs to the flagship; Trinidad is identified on P p. 58. The selected image is a later reproduction of Pigafetta's island drawing, not a canoe photograph. |
| `mactan` | **16 March 1521**, Samar sighting and start of window: P p. 71. **27 April 1521**, battle: P pp. 99–103. **Forty-nine men** wading ashore: P p. 100. | Recovery on the nearby island and fish, palm wine and coconuts: P pp. 71–74. Lapulapu's refusal and Magellan's demands for Spain and Cebu: P pp. 99–100. Arrival before dawn, rocky shallows, boat guns out of reach, exposed legs, retreat, death and Pigafetta's wound: P pp. 100–103. The QID is the battle, Q2091449; the ship track stays at Cebu. |
| `tidore` | Window starts **1 May 1521**, the Cebu banquet and departure: P pp. 104–106. **Three ships** reduced to two by burning Concepción: P pp. 105–106. **8 November 1521**, Tidore arrival: P p. 124. **21 December 1521**, Victoria departs alone and window ends: P pp. 144–146. | Insufficient men for Concepción: P pp. 105–106. Forced pilots: P pp. 121–123. Sultan's welcome: P pp. 124–126; the name is normalized from the account's Raja Sultan Manzor to al-Mansur. Cloth, hatchets and glass traded for cloves: P pp. 127–129. Trinidad's leak, divers and repair decision: P pp. 144–146. |
| `good-hope` | Display precision is **May 1522**, with nominal date **19 May**. A p. 235's editorial bracket gives **18–19 May** for rounding; R2 p. 236, note 637, gives **22 May** for finally clearing the Cape. The window is **21 December 1521–22 May 1522**, P p. 146 and that R2 note. **16 May 1522**, damaged foremast and foreyard: A p. 235. | Elcano commands Victoria: R2 pp. 238–239, returned crew list. Leaving Timor and avoiding Portuguese ports: P p. 159. Unsalted meat spoils, rice and water, leak and debate about Mozambique: P p. 160. Contrary west winds: A pp. 234–235. Cargo survives: P pp. 160–162. Pigafetta's 6 May Cape date is not silently adopted over the log; no exact rounding day appears in the prose. |
| `sanlucar-home` | Window starts **9 July 1522**, shipboard Cape Verde arrival: P p. 161; A p. 235. **Wednesday / Thursday** and **one day** difference: P p. 161; A p. 235. **Thirteen detained**: P p. 162. **6 September 1522**, return: P p. 162 and E. **Eighteen men, mostly sick**, expressly Pigafetta's count: P p. 162. **Five original ships, one completing the circuit**: P pp. 39, 56, 59–60, 105–106, 144–146, 162. | Hunger and rice, detention and escape: P pp. 160–162; A pp. 235–236. Elcano's account of going west and returning east around the world: E, displayed extract from leaf 2r. Eighteen is attributed rather than presented as a settled count of every person aboard, including Asian passengers. The story stops at Sanlúcar, before Seville and the thanksgiving procession. |

## Images and attribution

All ten originals or Commons derivatives were visually inspected. Their exact file titles and
40-character SHA1 values in `story.md` came from the read-only Commons API on 28 September 2026:
`action=query`, `prop=imageinfo`, `iiprop=url|sha1|extmetadata`. No media prebuild was run.
The listed crop coordinates are proposals for the framed card; the owner still needs to render
the actual frame. The rights labels below are those returned by Commons.

| Beat | Image, date and rights | Attribution and qualification |
|---|---|---|
| Departure | [Wyngaerde's Sanlúcar panorama](https://commons.wikimedia.org/wiki/File:Sanlucar_barrameda_vista_panoramica_1567_Wijngaerde.jpg), **1567**, public domain | Credit Anton van den Wyngaerde. Later town view, not an eyewitness image of the departure. Crop keeps the river and town. |
| Brazil | [Miller Atlas Atlantic sheet](https://commons.wikimedia.org/wiki/File:AtlasMiller_BNF_desplegable_Atlantico.jpg), **about 1519**, public domain | Credit the attributed Homem, Reinel and de Holanda makers. Collection line: **Source gallica.bnf.fr / Bibliothèque nationale de France**. Contemporary geography rather than a scene of this landfall. The Commons file is small; check legibility after baking. |
| San Julián | [Bellin harbor plan](https://commons.wikimedia.org/wiki/File:Plan_du_port_de_St._Julien_suivant_les_observations_des_Espagnols_en_1746_-_par_M._Bellin_Ing(énieur)_de_la_Marine_-_btv1b53121656g.jpg), **1756**, from observations of **1746**, public domain | Jacques-Nicolas Bellin; same BnF collection line. Later chart, not a sixteenth-century survey. Crop removes the broad blank margins. |
| Strait | [Pigafetta strait map, WDL3972](https://commons.wikimedia.org/wiki/File:The_First_Map_of_the_Strait_of_Magellan,_1520_WDL3972.png), reproduction in **1800**, public domain | Antonio Pigafetta, reproduced in Carlo Amoretti's edition. **Biblioteca Nacional de Chile, via the World Digital Library**. The file title's 1520 is not the reproduction date. South is at the top; do not rotate the original to imply a modern chart. |
| Pacific | [Ortelius's Maris Pacifici](https://commons.wikimedia.org/wiki/File:Ortelius_-_Maris_Pacifici_1589.jpg), **1589**, public domain | Abraham Ortelius. Later map with Victoria pictured; not a plotted track measured in 1521. |
| Guam | [Pigafetta island sketch](https://commons.wikimedia.org/wiki/File:Antonio_Pigafetta_Ladroni.jpg), reproduced in Prowazek's **1913** book, public domain | “After Antonio Pigafetta, in Stanislaus von Prowazek's Die deutschen Marianen (1913).” The source page identifies a reproduction through a 1908 publication. Its Commons DateTimeOriginal says 1520; that should not be mistaken for the date of this printed image. Alt text's **three islands** is a visible image count. Crop removes the later German caption. |
| Mactan | [Magellan's death engraving](https://commons.wikimedia.org/wiki/File:Magellans_death.jpg), **about 1860**, public domain | Unknown engraver. Explicitly an imagined scene, not evidence for clothing, weapons, ship positions or the exact place of death. |
| Tidore | [Sanson's Moluccas map](https://commons.wikimedia.org/wiki/File:B26056059K_-_Les_Isles_Molvcqves;_Celebes,_Gilolo.jpg), **1652**, CC0 | Nicolas Sanson; A. Peyrounin, engraver. Retains the collection wording from Commons: **NLB Singapore, David Parry Southeast Asian Map Collection**. Crop selects the lower-right inset containing Ternate and Tidore. |
| Cape | [Africa map by Filippo Pigafetta](https://commons.wikimedia.org/wiki/File:1591_map_of_Africa_by_Filippo_Pigafetta.jpg), **1591**, public domain | Filippo Pigafetta, not Antonio. Crop selects southern Africa. |
| Return | [Victoria detail from Ortelius](https://commons.wikimedia.org/wiki/File:Detail_from_a_map_of_Ortelius_-_Magellan%27s_ship_Victoria.png), **1590** according to this file's metadata, public domain | Abraham Ortelius. Later ship image; does not depict the exhausted condition at the return. This file's edition date differs from the 1589 Pacific map used above. |

## Route conventions and decisions

The source is one GeoJSON **Feature** with one **LineString**, 117 vertices and 117 dates.
`properties.kind` is `route`, `epoch` is `1519-09-20`, and `grid` is null because a line has no
spread raster grid. These choices fit 3.9 without inventing the future compiled `fx` artifact.

- `dates[i]` and `vertices[i]` describe `geometry.coordinates[i]`. Every vertex has citations
  with a source ID and page or dataset section. Full references live in `properties.sources`.
- `dateBasis` separates recorded dates from estimates. Every estimate has a `dateRange` bounded
  by the cited chronology. Long undated stretches, particularly Cebu–Brunei–Tidore, are not
  presented as a recovered daily log. The northern Borneo refit's **42 days** comes from P
  pp. 118–119; its assigned arrival and departure dates are both estimates.
- `positionBasis` separates named landfalls, logged latitudes and authored course/channel
  controls. For a logged latitude, the note states the reported value and explicitly calls
  the longitude reconstructed. No historical longitude has been treated as Greenwich longitude.
  Named ports use approximate modern waters at or outside their entrances, not surveyed berths.
- The strait and Cebu joins follow the modern channel between the places the accounts name.
  Natural Earth 1:10m land, version 5.1.1, supplies a modern geometry reference only. Channel
  control dates in the strait are interpolated by distance within 21 October–28 November.
  Consecutive controls can share a day; that is the precision of the source, not a timed fix.
- `legs[i]` explicitly names its `from` and `to` vertices. **Every leg is uncertain and at sea**,
  including stays at approximately located anchorages; it inherits its endpoints' citations.
  The future builder can map those booleans to 3.6's uncertain and sea bits. This source does
  not decide whether a compiled vertex carries its incoming or outgoing leg's flags.
- Great-circle interpolation must use the short arc across the Pacific antimeridian. Sparse
  ocean legs omit tacks. In particular, Stanley abridges Albo's final Atlantic crossing; the
  offshore controls there are illustrative and do not establish a particular Azores detour.
- `vesselChange` switches from Trinidad to Victoria at Cebu on **27 April 1521**. It is an
  editorial change of representative vessel, not a claim that Elcano assumes command then.
  The battle's small-boat trip is not the Trinidad's track. Santiago's reconnaissance, San
  Antonio's desertion and Trinidad's later attempted return across the Pacific are excluded.
- Mazaua is provisionally located at Limasawa, as in the note on P p. 83; this does not settle
  the competing first-mass-location claims. The positions at Malua/Alor, northern Borneo and
  the waters near Sarangani remain approximate identifications. Neither San Pablo nor Tiburones
  is pinned to a confidently named modern Pacific island.

**Calendar exception to 3.9:** the brief specifically asks for 20 September 1519 and
6 September 1522. The story and route preserve the conventional historical civil date labels,
rather than shifting the Julian dates ten days into the proleptic Gregorian calendar. The
existing date parser accepts those labels and computes with its Gregorian day numbers.
This is explicitly recorded in the route's `calendar` property; it needs resolution before
cross-calendar event matching or publication, rather than a silent conversion in this draft.
At Cape Verde, the westbound ship's diary is one day behind local reckoning. The route keeps
the log's labels through that passage and the conventional shore date for the return; it does
not invent the day or longitude where an international date line was crossed.

The **Cape date** is a separate source conflict: Pigafetta's 6 May, Stanley's editorial
18–19 May and Robertson's 22 May are not silently collapsed into one observed instant.
The beat displays month precision; the route uses a nominal 19 May bounded by 18–22 May and
cites both editors. The numeric first-crew total is omitted because the accounts and later
reconstructions count the expedition differently.

Other authored choices: `style: fleet` is a name for the future drawing, and `wDays: 7` is a
provisional visual width, not evidence of seven-day positional accuracy. The expedition QID
Q1225170 is reused with explicit local date/place overrides for nine beats; Mactan has its own
event QID. No weather is inferred from the grain or colors of the selected images.

## What the engine and editorial work still need

- **Route drawing and build:** read the dataset, densify sea legs at the specified 10 km,
  interpolate dates by distance, keep the Pacific antimeridian join short, draw at sea level,
  and distinguish the uncertain course. Review the illustrative timing while scrubbing.
  `route` currently parses only; the effects code is unchanged.
- **1520s borders:** no suitable snapshot is available, so no beat enables `borders`.
- **Relief:** every camera respects the supplied floor: the closest is Mactan at 120 km,
  other local views are 300–850 km, and ocean views are 10,500–16,500 km. The present Mactan
  view cannot explain the reef and wading distance in relief. A later close view of those
  shallows, the San Julián entrance or the strait's narrowest reaches would need a regional
  relief review and potentially L7. No closer camera or new bake is smuggled into this task.
- **Sound:** the story needs its surf-and-timber bed. Every `audio.cues` list is empty. No
  unimplemented cue names are promised; any rigging, surf or hull cue needs design and audition.
- **Media and integration:** Claude must bake and inspect the actual framed images and captions,
  resolve the media lock, then undertake the separately scoped lobby and story wiring.
- **Meanwhile:** every beat says `auto`. The stage must pick entries before their lines are
  written and checked. The expedition QID and calendar choice need care in that selection.

Beats weighed and omitted: a separate Río de la Plata/Santa Cruz search (kept in the track),
Homonhon recovery and the Cebu alliance/conversions (compressed into the lead-in to Mactan),
the **1 May** Cebu banquet killings (a window boundary and route departure, not a standalone
paragraph), Brunei and the northern Borneo refit (route only), an isolated stop for Amsterdam
Island (route only), Cape Verde as a separate beat (combined with the return), and the
Trinidad's failed Pacific return (outside the chosen vessel track). This keeps ten beats and
gives the oceans, strait, island encounters and African passage room.

## Validation

The story/route tests check prose length, image hashes, required source fields, camera floors,
route references, valid and ordered vertex dates, bounded estimates, connected uncertain sea
legs, citations and the vessel change at Cebu. The schema tests cover `route` fields, defaults
and malformed entries alongside `spread`.

A one-off geographic check sampled each short great-circle leg at no more than 2 km spacing:
**29,819 samples, none inside Natural Earth 1:10m land polygons**. Regional diagnostic maps
were inspected while correcting the coastal joins. This is a modern coast sanity check, not
proof of the historical course, navigability, shoal clearance or the rendered effect.

Final checks on 28 September 2026:

| Directory | Command | Result |
|---|---|---|
| `app/` | `npm test` | 70 files, **749 tests passed**. Includes every story folder and the new route checks. |
| `app/` | `npm run lint` | ESLint and Prettier passed. |
| `app/` | `npm run build` | TypeScript and the Vite production build passed. |
| `pipeline/` | `uv run pytest` | **1,233 passed**. |
| `pipeline/` | `uv run ruff check .` | Passed. |
| `pipeline/` | `uv run ruff format --check .` | Passed; 59 files already formatted. |

The initial build caught unchecked array indexing in the new test; that was corrected and
the app tests, lint and production build were rerun successfully. A separate comparison of
the story's ten filenames and SHA1 pins against the saved Commons API responses matched all
ten. The route has 56 recorded dates and 61 explicitly estimated dates.

`npm run e2e`, `npm run e2e:gpu`, GPU renders and the final card-frame inspection were not run:
the worktree brief assigns browser and GPU work to Claude. There was no `prebuild media`,
`publish-data`, remote write, push, issue or pull request. Research downloads and temporary
coast diagnostics stayed under `/private/tmp/magellan-research/`.

The schema change is commit `9e713a4` (`feat(app): accept named route effects in stories`).
The story, route, source map and story/route tests are the accompanying
`feat(stories): draft the Magellan–Elcano circumnavigation` commit on
`codex/63-magellan-story`.
