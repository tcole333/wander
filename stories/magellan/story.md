---
id: magellan
title: Magellan–Elcano
blurb: Five ships sail west from Spain in search of cloves. Across the Atlantic, through a strait and over an ocean of hunger, their voyage becomes a circuit of the earth.
credits:
  - Drafted by Codex from the sources listed under each beat.
  - The route between recorded landfalls and positions, its intermediate dates and its motion are illustrative reconstructions, not a continuous observed track. The historical images include later maps and imagined scenes.
---

## Five Ships for the Spice Islands

```beat
id: sanlucar-out
date: "1519-09-20"
precision: day
window: "1519-09-20..1519-10-03"
camera: {target: [-6.35, 36.8], viewKm: 700, tilt: 20, heading: 0, drift: none}
focal: {qid: Q1225170, at: [-6.35, 36.8], date: "1519-09-20"}
image:
  commons: "File:Sanlucar barrameda vista panoramica 1567 Wijngaerde.jpg"
  sha1: "89fd30a8fc718f657b750660adc245fa23f3d937"
  credit: "Anton van den Wyngaerde"
  crop: [0.18, 0.02, 0.80, 0.98]
  alt: "Sanlúcar de Barrameda in a drawing of 1567: boats in the river below a town climbing toward its castle."
layers: [relief, bathymetry, coastline, landSea, water, graticule, labels, events]
effects:
  - route: {dataset: route, wDays: 7, style: fleet}
audio: {cues: []}
meanwhile: auto
sources:
  - {title: "The First Voyage Round the World, by Magellan (Pigafetta's account, pp. 35–41, 58, 127, 161)", author: "Antonio Pigafetta, translated and edited by Lord Stanley of Alderley", publisher: "Hakluyt Society, London", year: 1874, url: "https://archive.org/details/firstvoyageround00piga/page/35/mode/2up"}
  - {title: "The First Voyage Round the World, by Magellan (letter of Maximilianus Transylvanus, pp. 187–188)", author: "Maximilianus Transylvanus, in Lord Stanley of Alderley (ed.)", publisher: "Hakluyt Society, London", year: 1874, url: "https://archive.org/details/firstvoyageround00piga/page/187/mode/2up"}
```

On 20 September 1519, five ships leave Sanlúcar de Barrameda, where the Guadalquivir opens into
the Atlantic. Ferdinand Magellan, a Portuguese captain in the service of Charles of Spain, is
looking for a western passage to the Moluccas, the islands where cloves grow. Somewhere beyond
the coast of South America, he hopes to find a way through. At night a light burns at the stern
of his flagship, the Trinidad, for the other ships to follow. Among those aboard is Antonio
Pigafetta, eager to see these things for himself. He will keep a record of the voyage.

## Fresh Food Across the Atlantic

```beat
id: brazil
date: "1519-12-13"
precision: day
window: "1519-10-03..1519-12-27"
camera: {target: [-25.0, -8.0], viewKm: 10500, tilt: 0, heading: 0, drift: slow}
focal: {qid: Q1225170, at: [-43.15, -22.9], date: "1519-12-13"}
image:
  commons: "File:AtlasMiller BNF desplegable Atlantico.jpg"
  sha1: "134645b3ecaa42a0a3dcbf1fa1c8fc732f695cc3"
  credit: "Attributed to Lopo Homem, Pedro Reinel, Jorge Reinel and António de Holanda"
  collection: "Source gallica.bnf.fr / Bibliothèque nationale de France"
  crop: [0.02, 0.03, 0.98, 0.96]
  alt: "The Atlantic in the Miller Atlas of about 1519, with ships between the coasts of Brazil and Africa and painted figures among the trees on shore."
layers: [relief, bathymetry, coastline, landSea, graticule, labels, events]
effects:
  - route: {dataset: route, wDays: 7, style: fleet}
  - callout: {at: [-43.15, -22.9], text: Rio de Janeiro}
audio: {cues: []}
meanwhile: auto
sources:
  - {title: "The First Voyage Round the World, by Magellan (Pigafetta's account, pp. 41–44, 57; chronology, p. lix)", author: "Antonio Pigafetta, translated and edited by Lord Stanley of Alderley", publisher: "Hakluyt Society, London", year: 1874, url: "https://archive.org/details/firstvoyageround00piga/page/41/mode/2up"}
  - {title: "The First Voyage Round the World, by Magellan (Albo's log, pp. 211–213)", author: "Francisco Albo, in Lord Stanley of Alderley (ed.)", publisher: "Hakluyt Society, London", year: 1874, url: "https://archive.org/details/firstvoyageround00piga/page/211/mode/2up"}
  - {title: "The First Voyage Round the World, by Magellan (letter of Maximilianus Transylvanus, p. 188)", author: "Maximilianus Transylvanus, in Lord Stanley of Alderley (ed.)", publisher: "Hakluyt Society, London", year: 1874, url: "https://archive.org/details/firstvoyageround00piga/page/188/mode/2up"}
```

Rain and contrary winds delay the ships off Africa. South of the equator, the North Star slips
out of sight. On 13 December they enter the bay of Rio de Janeiro, and fresh food comes aboard:
fowls, fish, sweet potatoes and pineapples. People on shore trade for knives, fishhooks, mirrors
and bells. Pigafetta exchanges a playing card for five fowls. In the long houses, cotton hammocks
hang above warming fires. The fleet fills its stores, then turns south along the coast. The
passage to the spice islands still lies somewhere ahead.

## Winter at San Julián

```beat
id: san-julian
date: "1520-03-31"
precision: day
window: "1520-03-31..1520-08-24"
camera: {target: [-67.7, -49.3], viewKm: 300, tilt: 25, heading: 0, drift: none}
focal: {qid: Q1225170, at: [-67.7, -49.3], date: "1520-03-31"}
image:
  commons: "File:Plan du port de St. Julien suivant les observations des Espagnols en 1746 - par M. Bellin Ing(énieur) de la Marine - btv1b53121656g.jpg"
  sha1: "125b21594c715f242715b5163f3f44c6d1845127"
  credit: "Jacques-Nicolas Bellin"
  collection: "Source gallica.bnf.fr / Bibliothèque nationale de France"
  crop: [0.14, 0.14, 0.86, 0.83]
  alt: "Bellin's chart of San Julián, published in 1756 from Spanish observations of 1746: a narrow entrance, soundings and islands inside the long harbor."
layers: [relief, bathymetry, coastline, landSea, water, labels, events]
effects:
  - callout: {at: [-67.7, -49.3], text: San Julián}
audio: {cues: []}
meanwhile: auto
sources:
  - {title: "The First Voyage Round the World, by Magellan (Albo's log, p. 218)", author: "Francisco Albo, in Lord Stanley of Alderley (ed.)", publisher: "Hakluyt Society, London", year: 1874, url: "https://archive.org/details/firstvoyageround00piga/page/218/mode/2up"}
  - {title: "The First Voyage Round the World, by Magellan (Pigafetta's account, pp. 55–57)", author: "Antonio Pigafetta, translated and edited by Lord Stanley of Alderley", publisher: "Hakluyt Society, London", year: 1874, url: "https://archive.org/details/firstvoyageround00piga/page/55/mode/2up"}
  - {title: "The First Voyage Round the World, by Magellan (letter of Maximilianus Transylvanus, pp. 192–194)", author: "Maximilianus Transylvanus, in Lord Stanley of Alderley (ed.)", publisher: "Hakluyt Society, London", year: 1874, url: "https://archive.org/details/firstvoyageround00piga/page/192/mode/2up"}
```

On 31 March 1520, the fleet enters San Julián on the Patagonian coast. Winter is approaching.
Magellan cuts the food allowance, and men who see no end to the land ask to turn home. Captains
rise against him. He breaks the mutiny: Luis de Mendoza is stabbed, Gaspar de Quesada beheaded.
Juan de Cartagena and a priest are left ashore. The Santiago is wrecked while exploring farther
along the coast. In the harbor the remaining ships are caulked, and the crews wait through the
cold. They do not leave until 24 August.

## A Door Between the Mountains

```beat
id: strait
date: "1520-11-28"
precision: day
window: "1520-10-21..1520-11-28"
camera: {target: [-72.0, -53.2], viewKm: 850, tilt: 35, heading: 0, drift: none}
focal: {qid: Q1225170, at: [-74.7, -52.6], date: "1520-11-28"}
image:
  commons: "File:The First Map of the Strait of Magellan, 1520 WDL3972.png"
  sha1: "990280db353192df52327fb74880ced9411a3ea3"
  credit: "Antonio Pigafetta, reproduced in Carlo Amoretti's 1800 edition"
  collection: "Biblioteca Nacional de Chile, via the World Digital Library"
  crop: [0.08, 0.065, 0.90, 0.925]
  alt: "Pigafetta's map of Patagonia and the strait, reproduced in 1800, with south at the top and blue water winding between brown shores."
layers: [relief, bathymetry, coastline, landSea, water, labels, events]
effects:
  - route: {dataset: route, wDays: 7, style: fleet}
  - callout: {at: [-68.35, -52.33], text: Cape of the Virgins}
  - callout: {at: [-74.7, -52.6], text: Cape of Desire}
audio: {cues: []}
meanwhile: auto
sources:
  - {title: "The First Voyage Round the World, by Magellan (Pigafetta's account, pp. 57–61, 64)", author: "Antonio Pigafetta, translated and edited by Lord Stanley of Alderley", publisher: "Hakluyt Society, London", year: 1874, url: "https://archive.org/details/firstvoyageround00piga/page/57/mode/2up"}
  - {title: "The First Voyage Round the World, by Magellan (Albo's log, pp. 218–220)", author: "Francisco Albo, in Lord Stanley of Alderley (ed.)", publisher: "Hakluyt Society, London", year: 1874, url: "https://archive.org/details/firstvoyageround00piga/page/218/mode/2up"}
```

On 21 October, an opening appears beyond the Cape of the Virgins. Inside it, one narrow passage
leads to a bay, then another passage and another bay. Snow covers the mountains. Where anchors
cannot find the bottom, the sailors carry their mooring lines ashore. The San Antonio turns back
for Spain. Magellan sends a boat ahead, and its men return with news of open sea; he weeps for
joy. On 28 November 1520, the three remaining ships clear the western end of the strait. Behind
them is the Cape of Desire. Ahead is the Pacific.

## Biscuit Dust and Leather

```beat
id: pacific
date: "1521-02-01"
precision: month
window: "1520-11-28..1521-03-05"
camera: {target: [-155.0, -8.0], viewKm: 16500, tilt: 0, heading: 0, drift: slow}
focal: {qid: Q1225170, at: [-152.0, -13.0], date: "1521-02-01"}
image:
  commons: "File:Ortelius - Maris Pacifici 1589.jpg"
  sha1: "763244422d912d6aec4b2b8724cfe9e24fde130f"
  credit: "Abraham Ortelius"
  crop: [0.02, 0.02, 0.98, 0.98]
  alt: "Ortelius's Pacific map of 1589, with Asia on the left, the Americas on the right and the Victoria under sail across the broad ocean."
layers: [relief, bathymetry, coastline, landSea, graticule, labels, events]
effects:
  - route: {dataset: route, wDays: 7, style: fleet}
audio: {cues: []}
meanwhile: auto
sources:
  - {title: "Magellan's Voyage Around the World, vol. 1 (pp. 55–61, 83–85)", author: "Antonio Pigafetta, translated and edited by James Alexander Robertson", publisher: "The Arthur H. Clark Company, Cleveland", year: 1906, url: "https://archive.org/details/magellansvoyagea01piga/page/83/mode/2up"}
  - {title: "The First Voyage Round the World, by Magellan (Albo's log, pp. 220–223, entries for December 1520 to March 1521)", author: "Francisco Albo, in Lord Stanley of Alderley (ed.)", publisher: "Hakluyt Society, London", year: 1874, url: "https://archive.org/details/firstvoyageround00piga/page/220/mode/2up"}
```

The sea stays calm. Fresh provisions run out. The biscuit is dust crawling with worms and
fouled by rats; the drinking water is yellow and rotten. Sailors cut the oxhide that protects the
rigging, soak it in the sea, then warm it over embers to make it chewable. Even rats become
scarce. Gums swell over teeth until men cannot eat. Pigafetta counts nineteen deaths from the
sickness, besides a captive Patagonian and a man from Brazil. The islands they find offer only
birds and trees, with no anchorage. Still the ships sail west.

## Canoes Around the Ships

```beat
id: guam
date: "1521-03-06"
precision: day
window: "1521-03-06..1521-03-09"
camera: {target: [144.8, 13.4], viewKm: 300, tilt: 20, heading: 0, drift: none}
focal: {qid: Q1225170, at: [144.65, 13.3], date: "1521-03-06"}
image:
  commons: "File:Antonio Pigafetta Ladroni.jpg"
  sha1: "70546f09c6fc14c38b9920a6c0f91a9b4b6610d6"
  credit: "After Antonio Pigafetta, in Stanislaus von Prowazek's Die deutschen Marianen (1913)"
  crop: [0.02, 0.025, 0.98, 0.665]
  alt: "A later reproduction of Pigafetta's island sketch: three islands, one labeled Isole de li Ladroni, with a dashed course passing between them."
layers: [relief, bathymetry, coastline, landSea, water, labels, events]
effects:
  - route: {dataset: route, wDays: 7, style: fleet}
audio: {cues: []}
meanwhile: auto
sources:
  - {title: "The First Voyage Round the World, by Magellan (Pigafetta's account, pp. 68–71)", author: "Antonio Pigafetta, translated and edited by Lord Stanley of Alderley", publisher: "Hakluyt Society, London", year: 1874, url: "https://archive.org/details/firstvoyageround00piga/page/68/mode/2up"}
  - {title: "The First Voyage Round the World, by Magellan (Albo's log, pp. 223–224, 6–9 March 1521)", author: "Francisco Albo, in Lord Stanley of Alderley (ed.)", publisher: "Hakluyt Society, London", year: 1874, url: "https://archive.org/details/firstvoyageround00piga/page/223/mode/2up"}
  - {title: "Magellan's Voyage Around the World, vol. 1 (p. 247, note 179, identifying Guam)", author: "James Alexander Robertson, editor and translator of Antonio Pigafetta", publisher: "The Arthur H. Clark Company, Cleveland", year: 1906, url: "https://archive.org/details/magellansvoyagea01piga/page/247/mode/2up"}
```

On 6 March 1521, canoes come out from Guam to meet the ships. Their triangular mat sails drive
them so swiftly that Albo thinks they fly. Either end can serve as the bow. Islanders board
the ships, and a party takes the flagship's skiff. Magellan goes ashore with armed men to
recover it. They burn houses and boats; Pigafetta records seven islanders killed. As the fleet leaves,
canoes pursue it and stones fly toward the decks. Pigafetta sees women crying and tearing their
hair. The ships sail on, leaving grief behind them.

## The Shallows at Mactan

```beat
id: mactan
date: "1521-04-27"
precision: day
window: "1521-03-16..1521-04-27"
camera: {target: [123.98, 10.32], viewKm: 120, tilt: 30, heading: 0, drift: none}
focal: {qid: Q2091449, at: [124.015, 10.311], date: "1521-04-27"}
image:
  commons: "File:Magellans death.jpg"
  sha1: "294c87736bcde9e8803f269e6990e63f428896f6"
  credit: "Unknown engraver, about 1860"
  crop: [0.015, 0.20, 0.985, 0.985]
  alt: "An imagined scene of Magellan's death in an engraving of about 1860: armed islanders surround an armored man in shallow water, with ships behind him."
layers: [relief, bathymetry, coastline, landSea, water, labels, events]
effects:
  - route: {dataset: route, wDays: 7, style: fleet}
  - callout: {at: [123.91, 10.29], text: Cebu}
  - callout: {at: [124.015, 10.311], text: Mactan}
audio: {cues: []}
meanwhile: auto
sources:
  - {title: "The First Voyage Round the World, by Magellan (Pigafetta's account, pp. 71–74, 99–103)", author: "Antonio Pigafetta, translated and edited by Lord Stanley of Alderley", publisher: "Hakluyt Society, London", year: 1874, url: "https://archive.org/details/firstvoyageround00piga/page/99/mode/2up"}
```

On 16 March the fleet sights Samar in the Philippines. Nearby, islanders bring fish, palm wine
and coconuts, and the sick rest ashore. But at Mactan, Lapulapu refuses the submission Magellan
demands for Spain and the ruler of Cebu. Before dawn on 27 April 1521, Magellan comes to force
him. The boats cannot cross the rocky shallows. Forty-nine men wade toward shore, beyond the
help of their boat guns. The defenders aim at their unarmored legs. As his men retreat,
Magellan falls in the water under their weapons. Pigafetta escapes wounded. The voyage goes
on without its captain.

## The Cloves of Tidore

```beat
id: tidore
date: "1521-11-08"
precision: day
window: "1521-05-01..1521-12-21"
camera: {target: [127.4, 0.45], viewKm: 350, tilt: 30, heading: 0, drift: none}
focal: {qid: Q1225170, at: [127.4, 0.65], date: "1521-11-08"}
image:
  commons: "File:B26056059K - Les Isles Molvcqves; Celebes, Gilolo.jpg"
  sha1: "6ee77374db82486a0c7d280dc961338416e9c002"
  credit: "Nicolas Sanson; A. Peyrounin, engraver"
  collection: "NLB Singapore, David Parry Southeast Asian Map Collection"
  crop: [0.545, 0.64, 0.985, 0.975]
  alt: "The Moluccas inset on Sanson's map of 1652, with Ternate and Tidore beside the larger island of Gilolo."
layers: [relief, bathymetry, coastline, landSea, water, labels, events]
effects:
  - route: {dataset: route, wDays: 7, style: fleet}
  - callout: {at: [127.4, 0.65], text: Tidore}
audio: {cues: []}
meanwhile: auto
sources:
  - {title: "The First Voyage Round the World, by Magellan (Pigafetta's account, pp. 103–106, 122–129, 144–146)", author: "Antonio Pigafetta, translated and edited by Lord Stanley of Alderley", publisher: "Hakluyt Society, London", year: 1874, url: "https://archive.org/details/firstvoyageround00piga/page/124/mode/2up"}
```

With too few men to work three ships, the survivors burn the Concepción. The Trinidad and
Victoria wander through the islands, taking pilots by force to guide them toward the cloves.
On 8 November 1521 they anchor at Tidore. Sultan al-Mansur welcomes them, and cloth, hatchets
and glass pass ashore in exchange for spice. The holds fill. But when the ships prepare to
leave, water pours into the Trinidad. The sultan sends divers to search her hull; they cannot
find the leak. She must stay for repairs. On 21 December, the Victoria sails alone.

## Against the Cape

```beat
id: good-hope
date: "1522-05-19"
precision: month
window: "1521-12-21..1522-05-22"
camera: {target: [50.0, -32.0], viewKm: 11000, tilt: 0, heading: 0, drift: slow}
focal: {qid: Q1225170, at: [18.0, -35.0], date: "1522-05-19"}
image:
  commons: "File:1591 map of Africa by Filippo Pigafetta.jpg"
  sha1: "e153d7e657e59782b3e6ee6c2f7102a672eb0595"
  credit: "Filippo Pigafetta"
  crop: [0.025, 0.43, 0.98, 0.99]
  alt: "Southern Africa on Filippo Pigafetta's map of 1591, with the Cape of Good Hope at the foot and ships in the surrounding seas."
layers: [relief, bathymetry, coastline, landSea, graticule, labels, events]
effects:
  - route: {dataset: route, wDays: 7, style: fleet}
  - callout: {at: [18.5, -34.36], text: Cape of Good Hope}
audio: {cues: []}
meanwhile: auto
sources:
  - {title: "The First Voyage Round the World, by Magellan (Pigafetta's account, pp. 146, 159–161)", author: "Antonio Pigafetta, translated and edited by Lord Stanley of Alderley", publisher: "Hakluyt Society, London", year: 1874, url: "https://archive.org/details/firstvoyageround00piga/page/159/mode/2up"}
  - {title: "The First Voyage Round the World, by Magellan (Albo's log, pp. 233–235, February–May 1522)", author: "Francisco Albo, in Lord Stanley of Alderley (ed.)", publisher: "Hakluyt Society, London", year: 1874, url: "https://archive.org/details/firstvoyageround00piga/page/233/mode/2up"}
  - {title: "Magellan's Voyage Around the World, vol. 2 (p. 236, note 637, on the Cape passage; pp. 238–239, crew list)", author: "Antonio Pigafetta, translated and edited by James Alexander Robertson", publisher: "The Arthur H. Clark Company, Cleveland", year: 1906, url: "https://archive.org/details/magellansvoyagea02piga/page/236/mode/2up"}
```

Juan Sebastián Elcano commands the Victoria. From Timor she heads into the Indian Ocean,
keeping clear of Portuguese ports. The meat spoils for want of salt, leaving rice and water.
The ship leaks. Some men want to seek help at Mozambique; others insist on reaching Spain.
Off southern Africa, west winds drive against them. On 16 May 1522, Albo records a damaged
foremast and foreyard. At last the ship works round the Cape of Good Hope and turns into the
Atlantic. The cloves are still aboard, and the men must keep the hull afloat.

## Back at the River Mouth

```beat
id: sanlucar-home
date: "1522-09-06"
precision: day
window: "1522-07-09..1522-09-06"
camera: {target: [-6.35, 36.8], viewKm: 14000, tilt: 0, heading: 0, drift: slow}
focal: {qid: Q1225170, at: [-6.35, 36.8], date: "1522-09-06"}
image:
  commons: "File:Detail from a map of Ortelius - Magellan's ship Victoria.png"
  sha1: "9cdc6a76e957a5fabdb3a6ef1593cf5c362aca19"
  credit: "Abraham Ortelius"
  crop: [0.02, 0.02, 0.98, 0.98]
  alt: "The Victoria under billowing sails and red pennants, a detail from a map by Ortelius dated 1590."
layers: [relief, bathymetry, coastline, landSea, graticule, labels, events]
effects:
  - route: {dataset: route, wDays: 7, style: fleet}
audio: {cues: []}
meanwhile: auto
sources:
  - {title: "The First Voyage Round the World, by Magellan (Pigafetta's account, pp. 39, 161–162)", author: "Antonio Pigafetta, translated and edited by Lord Stanley of Alderley", publisher: "Hakluyt Society, London", year: 1874, url: "https://archive.org/details/firstvoyageround00piga/page/161/mode/2up"}
  - {title: "Letter to Charles V, Sanlúcar, 6 September 1522 (extract in The Longest Voyage: The Return, section Elcano's letter to Emperor Charles V)", author: "Juan Sebastián Elcano", publisher: "Archivo General de Indias and Acción Cultural Española, Google Arts & Culture", year: 1522, url: "https://artsandculture.google.com/story/the-longest-voyage-the-return/zAVhmCkls3oeTA"}
```

Hunger drives the Victoria into Portuguese Cape Verde. Men sent ashore for rice learn that
their Wednesday is Thursday: sailing west around the earth, they have lost a day. The
Portuguese detain the boat and thirteen men, and the ship escapes. On 6 September 1522 she
reaches Sanlúcar again. Pigafetta counts eighteen men, most of them sick. Elcano writes to
Charles that they have gone round the whole world, setting out westward and returning from
the east. Of the five ships, the Victoria alone completes the circle.
