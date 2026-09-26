---
id: tambora
title: Tambora
blurb: In April 1815 Tambora explodes, and the veil it spreads across the sky brings cold and hunger from New England to Yunnan.
credits:
  - Drafted by Claude from the sources listed under each beat.
  - Temperatures from the ModE-RA monthly reanalysis.
  - The eruption plume, the ashfall and the spreading veil are illustrative reconstructions, not observations.
  - Maps of 1812, 1813 and 1832 from the David Rumsey Map Collection, David Rumsey Map Center, Stanford Libraries, via Wikimedia Commons.
  - Map of Tambora from Heinrich Zollinger, Besteigung des Vulkanes Tambora (Winterthur, J. Wurster, 1855), drawn by J. M. Ziegler and engraved by R. Leuzinger; ETH-Bibliothek Zürich, Rar 5880.
  - Emigration in 1817, engraved by Lossing & Barritt for Samuel G. Goodrich, Recollections of a Lifetime (1856).
---

## A Mountain Thought Extinct

```beat
id: world-1815
date: "1815-04-01"
precision: month
window: "1815-03-20..1815-04-05"
camera: {target: [118.0, -8.25], viewKm: 14000, tilt: 0, heading: 0, drift: slow}
focal: {qid: Q3591483, date: "1815-04-05"}
image:
  commons: "File:(Composite of) The World on Mercator's projection. Drawn under the direction of Mr. Pinkerton by L. Hebert. Neele sculpt. 352 (IA dr composite-of-the-world-on-mercators-projection-drawn-under-the-directio-00374032).jpg"
  sha1: "c88a5aa67af1f833c8ce86f5cd14ac437c026722"
  crop: [0.01, 0.02, 0.99, 0.965]
  alt: "A hand-colored map of the world on Mercator's projection, engraved in London in 1812 for Pinkerton's Modern Atlas."
layers: [relief, bathymetry, coastline, landSea, water, graticule, labels, borders, events]
effects:
  - pulse: {at: [118.0, -8.25], start: "1812-01-01", end: "1815-04-05", radiusKm: 150, style: rumble}
audio: {cues: [rumble-far]}
meanwhile: auto
sources:
  - {title: "Waterloo 1815: The Hundred Days & Precursory Battles", author: "Anne S. K. Brown Military Collection", publisher: "Brown University Library", year: null, url: "https://library.brown.edu/cds/askb/waterloo/hundred.html"}
  - {title: "The Great Tambora Eruption in 1815 and Its Aftermath", author: "Richard B. Stothers", publisher: "Science 224: 1191-1198, doi:10.1126/science.224.4654.1191 (copy hosted by NASA GISS)", year: 1984, url: "https://pubs.giss.nasa.gov/docs/1984/1984_Stothers_st03310z.pdf"}
  - {title: "Mount Tambora in 1815: A Volcanic Eruption in Indonesia and Its Aftermath", author: "Bernice de Jong Boers", publisher: "Indonesia 60, Cornell University Southeast Asia Program", year: 1995, url: "https://ecommons.cornell.edu/handle/1813/54071"}
  - {title: "Tambora (volcano number 264040)", author: "Global Volcanism Program", publisher: "Smithsonian Institution", year: 2026, url: "https://volcano.si.edu/volcano.cfm?vn=264040"}
```

In April 1815 Napoleon is back in Paris, and the Congress of Vienna is still in session. Java is
under British rule, with Thomas Stamford Raffles as lieutenant-governor. East of Java, beyond Bali
and Lombok, lies Sumbawa, an island of six small sultanates that export rice, honey, horses and
sapanwood. A single mountain fills its northern peninsula, 60 km across: Tambora, over 4,000 m high.
It has not erupted in living memory, and people take it for extinct, or for no volcano at all. But
since 1812 a cloud has hung over the summit, growing darker, and the rumbling grows louder.

## Distant Cannon

```beat
id: sunda
date: "1815-04-05"
precision: day
window: "1815-04-05..1815-04-10"
camera: {target: [118.0, -8.25], viewKm: 1500, tilt: 20, heading: 0, drift: none}
focal: {qid: Q3591483, date: "1815-04-05"}
image:
  commons: "File:East India Isles. Drawn under the direction of Mr. Pinkerton by L. Hebert. Neele sculpt. 352 Strand. London- published April (IA dr east-india-isles-drawn-under-the-direction-of-mr-pinkerton-by-l-hebert-00364021).jpg"
  sha1: "b5f82f9d02c8e96651f4d01fd0d9ba1da889228d"
  crop: [0.38, 0.42, 0.86, 0.89]
  alt: "A hand-colored map of the East India Isles, published in London in 1813: Java and the chain of islands east of it to Timor, Sumbawa among them, with Borneo, Celebes and the Moluccas to the north."
layers: [relief, bathymetry, coastline, landSea, water, labels, borders, events]
effects:
  - plume: {at: [118.0, -8.25], start: "1815-04-05", peak: "1815-04-10", end: "1815-07-15", heightKm: 43, drift: [-0.7, 0.7], seed: 1815}
  - pulse: {at: [118.0, -8.25], start: "1815-04-05", end: "1815-04-06", radiusKm: 1400, style: sound}
  - callout: {at: [119.41, -5.13], text: Makassar}
audio: {cues: [cannon-far]}
meanwhile: auto
sources:
  - {title: "Memoir of the Life and Public Services of Sir Thomas Stamford Raffles (pp. 241-250: the account of the eruption of the Tomboro Mountain collected from the Residents' reports for Raffles, Batavia, 28 September 1815)", author: "Sophia Raffles (ed.)", publisher: "John Murray, London", year: 1830, url: "https://archive.org/details/memoiroflifepubl00raff"}
  - {title: "The History of Java, vol. 1 (footnote, pp. 25-28)", author: "Thomas Stamford Raffles", publisher: "Black, Parbury and Allen, and John Murray, London", year: 1817, url: "https://archive.org/details/b22012382_0001"}
  - {title: "The Great Tambora Eruption in 1815 and Its Aftermath", author: "Richard B. Stothers", publisher: "Science 224: 1191-1198, doi:10.1126/science.224.4654.1191 (copy hosted by NASA GISS)", year: 1984, url: "https://pubs.giss.nasa.gov/docs/1984/1984_Stothers_st03310z.pdf"}
  - {title: "Plinian and co-ignimbrite tephra fall from the 1815 eruption of Tambora volcano", author: "Haraldur Sigurdsson and Steven Carey", publisher: "Bulletin of Volcanology 51: 243-270", year: 1989, url: "https://doi.org/10.1007/BF01073515"}
```

On 5 April 1815, a sound like cannon fire rolls across the islands. On Java it is heard in every
quarter. Troops march out of Yogyakarta, expecting to find a nearby post under attack, and twice
boats put out along the coast to help a ship in distress. At Makassar, 380 km from Tambora, troops
board the East India Company cruiser Benares to hunt pirates; she returns on the 8th having found
none. At Ternate, 1,400 km away, a boat circles the island looking for a ship offshore. Next
morning ash sifts down on Java. So near does the sound seem that each district blames a volcano
close at hand: Merapi, Kelud or Bromo.

## Three Columns of Flame

```beat
id: sumbawa
date: "1815-04-10"
precision: day
window: "1815-04-10..1815-04-11"
camera: {target: [118.0, -8.25], viewKm: 300, tilt: 45, heading: 0, drift: none}
focal: {qid: Q3591483, date: "1815-04-05"}
image:
  commons: "File:ETH-Bib RAR 5880 Karte der Insel Sumbawa und Tambora 1855.jpg"
  sha1: "89111424ccbbe629dc375d90d431c5189c732b72"
  crop: [0.395, 0.02, 0.60, 0.48]
  alt: "An engraved relief map of 1855 of the Sanggar peninsula on Sumbawa, showing Tambora's broad summit crater and the village of Sanggar on the bay."
layers: [relief, bathymetry, coastline, landSea, water, labels, events]
effects:
  - plume: {at: [118.0, -8.25], start: "1815-04-05", peak: "1815-04-10", end: "1815-07-15", heightKm: 43, drift: [-0.7, 0.7], seed: 1815}
  - callout: {at: [118.30, -8.38], text: Sanggar}
  - callout: {at: [117.745, -8.24], text: Pekat}
audio: {cues: [eruption]}
meanwhile: auto
sources:
  - {title: "Memoir of the Life and Public Services of Sir Thomas Stamford Raffles (pp. 248-250: Lt Owen Phillips's report of the Rajah of Sanggar's account)", author: "Sophia Raffles (ed.)", publisher: "John Murray, London", year: 1830, url: "https://archive.org/details/memoiroflifepubl00raff"}
  - {title: "Besteigung des Vulkanes Tambora auf der Insel Sumbawa und Schilderung der Erupzion desselben im Jahr 1815 (pp. 11, 20)", author: "Heinrich Zollinger", publisher: "J. Wurster & Co., Winterthur (ETH-Bibliothek Zürich, e-rara)", year: 1855, url: "https://doi.org/10.3931/e-rara-10991"}
  - {title: "Mount Tambora in 1815: A Volcanic Eruption in Indonesia and Its Aftermath", author: "Bernice de Jong Boers", publisher: "Indonesia 60, Cornell University Southeast Asia Program", year: 1995, url: "https://ecommons.cornell.edu/handle/1813/54071"}
  - {title: "Tambora (volcano number 264040)", author: "Global Volcanism Program", publisher: "Smithsonian Institution", year: 2026, url: "https://volcano.si.edu/volcano.cfm?vn=264040"}
  - {title: "Tambora 1815 as a test case for high impact volcanic eruptions: Earth system effects", author: "Christoph C. Raible, Stefan Brönnimann, Renate Auchmann, Philip Brohan et al.", publisher: "WIREs Climate Change 7: 569-589, doi:10.1002/wcc.407 (open access at PubMed Central)", year: 2016, url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6686350/"}
  - {title: "Plinian and co-ignimbrite tephra fall from the 1815 eruption of Tambora volcano", author: "Haraldur Sigurdsson and Steven Carey", publisher: "Bulletin of Volcanology 51: 243-270", year: 1989, url: "https://doi.org/10.1007/BF01073515"}
```

At about seven on the evening of 10 April, three columns of flame burst from Tambora's crater and
merge high in the air. From Sanggar, its Rajah watches the whole mountain become "like a body of
liquid fire". Stones rain down, a whirlwind flattens nearly every house, and the sea rises nearly
3.7 m higher than anyone has known. Glowing ash flows reach the sea on every side of the
peninsula. The summit collapses into a caldera 6 to 7 km across and more than 1 km deep. Some 8,000
to 12,000 people live in the kingdoms of Tambora and Pekat. Of Tambora's villages only Jempo, with
about forty people, survives. In Pekat not a house is left.

## Ash on the Rice Fields

```beat
id: ash
date: "1815-04-12"
precision: day
window: "1815-04-11..1816-10-26"
camera: {target: [114.5, -8.0], viewKm: 1500, tilt: 30, heading: 0, drift: none}
focal: {qid: Q3591483, date: "1815-04-05"}
image:
  commons: "File:Asiatic Archipelago, by J. Arrowsmith. London, pubd. 15 Feby. 1832 by J. Arrowsmith, 35 Essex Street, Strand. (IA dr asiatic-archipelago-by-j-arrowsmith-london-pubd-15-feby-1832-by-j-ar-0036034).jpg"
  sha1: "a8877be3a365e17d97e65968380eb010246b70dc"
  crop: [0.405, 0.63, 0.56, 0.81]
  alt: "Detail of an 1832 map of the Asiatic Archipelago, from the eastern tip of Java to Flores, with a printed note on the 1815 eruption of 'Tumbora'."
layers: [relief, bathymetry, coastline, landSea, water, labels, events]
effects:
  - plume: {at: [118.0, -8.25], start: "1815-04-05", peak: "1815-04-10", end: "1815-07-15", heightKm: 43, drift: [-0.7, 0.7], seed: 1815}
  - spread: {dataset: ash-1815, wDays: 1, style: ashfall}
  - callout: {at: [114.37, -8.22], text: Banyuwangi}
  - callout: {at: [112.65, -7.16], text: Gresik}
audio: {cues: [ashfall]}
meanwhile: auto
sources:
  - {title: "Memoir of the Life and Public Services of Sir Thomas Stamford Raffles (pp. 241-250: the account of the eruption of the Tomboro Mountain collected from the Residents' reports for Raffles, with Lt Owen Phillips's report from Bima)", author: "Sophia Raffles (ed.)", publisher: "John Murray, London", year: 1830, url: "https://archive.org/details/memoiroflifepubl00raff"}
  - {title: "Mount Tambora in 1815: A Volcanic Eruption in Indonesia and Its Aftermath", author: "Bernice de Jong Boers", publisher: "Indonesia 60, Cornell University Southeast Asia Program", year: 1995, url: "https://ecommons.cornell.edu/handle/1813/54071"}
  - {title: "Tambora und das «Jahr ohne Sommer» 1816: Klima, Mensch und Gesellschaft (Geographica Bernensia G90)", author: "Stefan Brönnimann and Daniel Krämer", publisher: "Geographica Bernensia, University of Bern", year: 2016, url: "https://doi.org/10.4480/GB2016.G90.02"}
  - {title: "Plinian and co-ignimbrite tephra fall from the 1815 eruption of Tambora volcano", author: "Haraldur Sigurdsson and Steven Carey", publisher: "Bulletin of Volcanology 51: 243-270", year: 1989, url: "https://doi.org/10.1007/BF01073515"}
```

On 11 April the afternoon turns to night. At Banyuwangi, facing Bali, candles are needed by one
o'clock and it is pitch dark by four; the dark lasts until two the next afternoon, while ash piles
20 cm deep. At Gresik next morning, breakfast is by candlelight at eleven. On Sumbawa the ash lies
half a meter deep over rice still standing in the fields. People eat dry leaves and sell their
children for rice, and a violent diarrhea, blamed on ash in the water, carries off great numbers.
The Rajah of Sanggar loses a daughter to hunger. Famine takes Lombok and Bali too. Across the
islands, 90,000 to 117,000 people die, most from hunger and disease.

## A Veil Around the World

```beat
id: veil
date: "1815-06-28"
precision: day
window: "1815-04-10..1816-06-10"
camera: {target: [100.0, -5.0], viewKm: 14000, tilt: 0, heading: 0, drift: slow}
focal: {qid: Q3591483, date: "1815-04-05"}
image:
  commons: "File:Joseph Mallord William Turner - The Decline of the Carthaginian Empire - WGA23169.jpg"
  sha1: "055b31adb1fdbcaa56ecf0322f35ec21cdafa15b"
  crop: [0, 0, 1, 1]
  alt: "J. M. W. Turner's The Decline of the Carthaginian Empire, exhibited in 1817: a harbor city under a hazy, blazing sunset."
layers: [relief, coastline, landSea, graticule, labels, events]
effects:
  - spread: {dataset: veil-1815, wDays: 20, style: haze}
audio: {cues: []}
meanwhile: auto
sources:
  - {title: "Tambora 1815 as a test case for high impact volcanic eruptions: Earth system effects", author: "Christoph C. Raible, Stefan Brönnimann, Renate Auchmann, Philip Brohan et al.", publisher: "WIREs Climate Change 7: 569-589, doi:10.1002/wcc.407 (open access at PubMed Central)", year: 2016, url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6686350/"}
  - {title: "Tambora und das «Jahr ohne Sommer» 1816: Klima, Mensch und Gesellschaft (Geographica Bernensia G90)", author: "Stefan Brönnimann and Daniel Krämer", publisher: "Geographica Bernensia, University of Bern", year: 2016, url: "https://doi.org/10.4480/GB2016.G90.02"}
  - {title: "The Great Tambora Eruption in 1815 and Its Aftermath", author: "Richard B. Stothers", publisher: "Science 224: 1191-1198, doi:10.1126/science.224.4654.1191 (copy hosted by NASA GISS)", year: 1984, url: "https://pubs.giss.nasa.gov/docs/1984/1984_Stothers_st03310z.pdf"}
  - {title: "The Climate of London, Deduced from Meteorological Observations, vol. 2 (2nd ed.)", author: "Luke Howard", publisher: "Harvey & Darton, London", year: 1833, url: "https://archive.org/details/b29350529_0002"}
  - {title: "Atmospheric Constitution of New-York, from March to July, 1816", author: "unsigned", publisher: "The Medical Repository, new series, vol. 3, pp. 301-305, New York", year: 1817, url: "https://archive.org/details/sim_medical-repository_1817_3_3"}
```

Tambora's gas outlives its ash. About 60 million tonnes of sulfur dioxide rise 20 to 25 km into
the stratosphere and turn into droplets of sulfuric acid. The cloud circles the tropics, then drifts
toward the poles, a thin veil that dims the sun. By late June it is over England. On 29 June, near
London, Luke Howard notes a twilight "bright orange near the horizon, with a purple glow above". In
spring 1816 a dry fog reddens the sun over New York until sunspots show to the naked eye. And on the
night of 9 to 10 June 1816, the eclipsed moon vanishes entirely from clear skies over London and
Dresden.

## A Wet, Ungenial Summer

```beat
id: europe-1816
date: "1816-07-01"
precision: month
window: "1816-06-01..1816-08-31"
camera: {target: [10.0, 50.0], viewKm: 5000, tilt: 15, heading: 0, drift: none}
focal: {qid: Q209625, at: [6.1833, 46.2203]}
image:
  commons: "File:Ravensburg suppenkueche 1817.jpg"
  sha1: "41b59c909ed29425c3a77cc619228ca8ad3ab707"
  crop: [0.012, 0.035, 0.988, 0.975]
  alt: "A hand-colored print of 1817: townspeople and children with jugs queue at the soup cauldron of the hospital kitchen in Ravensburg while a clerk keeps the list."
layers: [relief, coastline, landSea, water, labels, borders, {climate: {mode: monthly}}, events]
effects:
  - callout: {at: [6.1833, 46.2203], text: Villa Diodati}
audio: {cues: [rain]}
meanwhile: auto
sources:
  - {title: "Disentangling the causes of the 1816 European year without a summer", author: "Andrew P. Schurer, Gabriele C. Hegerl, Jürg Luterbacher, Stefan Brönnimann et al.", publisher: "Environmental Research Letters 14: 094019", year: 2019, url: "https://doi.org/10.1088/1748-9326/ab3a10"}
  - {title: "Tambora und das «Jahr ohne Sommer» 1816: Klima, Mensch und Gesellschaft (Geographica Bernensia G90)", author: "Stefan Brönnimann and Daniel Krämer", publisher: "Geographica Bernensia, University of Bern", year: 2016, url: "https://doi.org/10.4480/GB2016.G90.02"}
  - {title: "Frankenstein; or, The Modern Prometheus (1831 edition, author's introduction)", author: "Mary Wollstonecraft Shelley", publisher: "Henry Colburn and Richard Bentley, London (Project Gutenberg eBook 42324)", year: 1831, url: "https://www.gutenberg.org/ebooks/42324"}
```

The summer of 1816 is the coldest in a European temperature record that runs from 1766 to 2000.
Around Geneva it is 2.5 to 3 °C colder than the summers around it, and at Aarau it rains on 28 of
July's 31 days. "There is not a day on which it does not rain," an Alsatian farmer writes. "The
misery cannot be described." By Lake Geneva, rain keeps Lord Byron and his neighbors, Percy Shelley
and Mary Godwin, indoors for days, and Byron proposes that they each write a ghost story. Mary's
becomes Frankenstein. Harvests shrink, and by 1817 prices have doubled or tripled. Bakers make
smaller loaves, and food riots break out from France to Bavaria.

## Eighteen Hundred and Froze to Death

```beat
id: new-england-1816
date: "1816-06-06"
precision: day
window: "1816-06-05..1817-08-31"
camera: {target: [-72.0, 43.0], viewKm: 1500, tilt: 20, heading: 0, drift: none}
focal: {qid: Q209625, at: [-72.0, 43.0]}
image:
  commons: "File:Recollections of a lifetime - or men and things I have seen - in a series of familiar letters to a friend - historical, biographical, anecdotical, and descriptive (1856) (14740173686).jpg"
  sha1: "688583b7c4ac9f95461867b48dd311dce9299924"
  crop: [0, 0, 1, 1]
  alt: "An 1856 wood engraving, Emigration in 1817: a New England farmer with a staff holds his horse beside a covered wagon; his wife, holding a baby, rides on the load beside a cat, while three children and two dogs wait on the road."
layers: [relief, coastline, landSea, water, labels, borders, {climate: {mode: monthly}}, events]
effects:
  - callout: {at: [-70.8985, 42.5168], text: Salem}
  - callout: {at: [-72.2961, 44.4013], text: Cabot}
audio: {cues: [wind-cold]}
meanwhile: auto
sources:
  - {title: "Historic Storms of New England (ch. 53, The Cold Summer of 1816)", author: "Sidney Perley", publisher: "Salem Press Publishing and Printing Co., Salem, Mass.", year: 1891, url: "https://archive.org/details/historicstormsof00perl"}
  - {title: "Diary of Thomas Robbins, D.D., 1796-1854, vol. 1 (entries of 4 and 5 September 1816)", author: "Thomas Robbins, ed. Increase N. Tarbox", publisher: "Beacon Press, Boston", year: 1886, url: "https://archive.org/details/diaryofthomasrob01robb"}
  - {title: "Recollections of a Lifetime, vol. 2 (pp. 78-80)", author: "Samuel Griswold Goodrich", publisher: "Miller, Orton and Mulligan, New York", year: 1856, url: "https://archive.org/details/recollectionsofl02good"}
```

On 5 June 1816, Salem, Massachusetts, bakes at 92 °F; by sunset the next day it is 43 °F. From 6
to 8 June snow falls on Maine, New Hampshire and Vermont, eighteen inches deep at Cabot. Drought
parches the fields, and frost returns in July and August, killing beans, corn and potatoes. "I
presume no person living has known so poor a crop of corn in New England," a Connecticut minister
writes in September. New Englanders call it the poverty year, and some "eighteen hundred and froze
to death". In summer 1817, as thousands fear their land will become "a part of the frigid zone",
families stream west toward Ohio in wagons, in ox-carts and on foot.

## Famine in the Hills, Cholera in the Delta

```beat
id: yunnan-bengal-1817
date: "1817-08-28"
precision: day
window: "1815-10-01..1817-12-31"
camera: {target: [95.0, 24.0], viewKm: 5000, tilt: 15, heading: 0, drift: none}
focal: {qid: Q2646216, at: [89.2167, 23.1667]}
image:
  commons: "File:Carte indiquant la marche du choléra-morbus depuis l'Inde jusqu'en Europe, 1831 - btv1b84409876.jpg"
  sha1: "46aeb506e3aa0ed8cba6f807f00fb37ebc5ccc82"
  crop: [0.48, 0.32, 0.93, 0.70]
  alt: "Detail of an 1831 French map tracing the march of cholera out of India, with red routes running from Bengal toward Burma and China."
layers: [relief, coastline, landSea, water, labels, borders, {climate: {mode: annual}}, events]
effects:
  - pulse: {at: [89.2167, 23.1667], start: "1817-08-28", end: "1817-12-31", radiusKm: 300, style: contagion}
  - callout: {at: [102.7061, 25.0433], text: Yunnan}
audio: {cues: []}
meanwhile: auto
sources:
  - {title: "嘉庆云南大饥荒(1815—1817)与坦博拉火山喷发 [A serious famine in Yunnan (1815-1817) and the eruption of Tambora volcano] (pp. 79, 82-83)", author: "Yang Yuda, Man Zhimin and Zheng Jingyun", publisher: "Fudan Journal (Social Sciences) 2005(1): 79-85", year: 2005, url: "https://web.archive.org/web/20090326133019/http://www.igsnrr.ac.cn/lwzzImg/1161151232919.pdf"}
  - {title: "Report on the Epidemick Cholera Morbus, as it visited the territories subject to the Presidency of Bengal, in the years 1817, 1818 and 1819 (Introduction pp. xliii-xlv and lx; pp. 3-4)", author: "James Jameson, for the Bengal Medical Board", publisher: "Government Gazette Press, Calcutta", year: 1820, url: "https://archive.org/details/b21971547"}
  - {title: "Tambora und das «Jahr ohne Sommer» 1816: Klima, Mensch und Gesellschaft (Geographica Bernensia G90)", author: "Stefan Brönnimann and Daniel Krämer", publisher: "Geographica Bernensia, University of Bern", year: 2016, url: "https://doi.org/10.4480/GB2016.G90.02"}
```

In Yunnan, in China's far southwest, cold summers ruin the rice and buckwheat three years running.
"Suddenly the weather turned cold as winter," the poet Li Yuyang writes. "The crops that reached
the clouds all withered." By 1817 famine is recorded in 29 of roughly 88 counties, and the starving
fight over clay to eat. In Bengal a drought in 1816 ends in flood, and by mid-August 1817 the lower
delta is "one sheet of water". On 28 August, word reaches the government that cholera is killing 20
to 30 people a day in Jessore. It grows into the first global cholera pandemic. Whether Tambora's
strange seasons set it loose is an open question.
