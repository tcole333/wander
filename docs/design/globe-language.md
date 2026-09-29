# Wander: the globe's language

What the globe shows as time passes, in which channel and material, and how it reveals itself. It
governs everything visible, in stories and in exploration. The PRD says what Wander is and
`streaming.md` how its data moves; this doc says how the globe carries meaning.

## North star

Joseph Wright of Derby's *A Philosopher Lecturing on the Orrery* (about 1766,
`docs/reference/a-philosopher-lecturing-on-the-orrery.jpg`): a lamp hidden behind a boy lights the
faces around an orrery in a dark room. Wander aims for those faces, wonder turning into
understanding. The painting holds both of Wander's modes: the philosopher lecturing (stories) and
the man taking notes at the left (exploration).

## Two tiers

Stories carry history that has a narrative shape: a voyage, an eruption and its aftermath, the way
jazz spread through American cities. Around them the globe itself changes with time everywhere, so
a visitor exploring without a story still watches the ages pass and can notice why things happened
where they did. Influences such as natural resources come out of that exploration rather than out
of dedicated stories.

## Speeds and pace layers

Fernand Braudel described history at three speeds: the ground, nearly motionless (land, climate,
resources); the currents, slow (economies, states, societies); and events, the fast surface. That
is the big picture. The working grain is Stewart Brand's six pace layers, from slowest: nature,
culture, governance, infrastructure, commerce, and fashion and art. Brand observed that the fast
layers get the attention and the slow ones hold the power; the globe gives the slow layers their
share of attention.

Pace layers are distinct from the map layers the Layers panel toggles. Each map layer belongs to a
pace layer: relief, bathymetry, coastlines, land and sea tint, rivers, ecoregions, mountains,
petroleum provinces, minerals and climate to nature; sea names to culture; borders to governance;
the graticule to the instrument. Each event belongs to the pace layer it jolts: an eruption to
nature, a battle to governance, a canal's opening to infrastructure, an embargo to commerce, a
premiere to fashion and art.

## Principles

1. **Meaning over precision, never over truth.** The globe exaggerates so that things can be
   understood, as its relief already does. A channel is exaggerated everywhere, not only where a
   story wants drama. Order and direction stay true: what is bigger stays bigger, what rose still
   rises, what came first still comes first. The convention either shows, as an engraved scale
   does, or is disclosed, as the Credits disclose each illustrative reconstruction. Words stay
   exact and sourced. Estimates look like estimates: softer engraving where data is estimated,
   crisp where it is measured.
2. **Possibilism.** The land offers and people choose. Nature always shows where a resource lies;
   the ground is polished only while people work it, and its goods are drawn moving only while they
   move. The timing comes from people, their technology and wants, so the globe never suggests that
   geography decided what happened, and labels name who acted.
3. **Eras by region.** A region's age is the sum of its pace layers, so places live in different
   eras on the same date (Ernst Bloch's simultaneity of the non-simultaneous): trains run in
   Andalusia while caravans still cross Morocco. No single age is painted over the world.
4. **One channel per pace layer.** Each pace layer and its events keep their own channel and
   material (below), so six kinds of history share the globe without competing. Bertin's visual
   variables divide the channels, and each difference stays the smallest that still reads (Tufte's
   smallest effective difference).
5. **Reveal by scale and attention.** Complexity is always there and shows at its scale, moving from
   the edge of attention to its center when the visitor attends, as in calm technology. The time
   ruler's zoom brings forward the pace layers that move at that pace, the globe's zoom reveals
   finer events, and hover and click bring words (Revealing, below).
6. **The instrument reads the world.** Quantities with no place on the map, such as atmospheric CO2
   and world population, read on the instrument's graduated rings: an engraved scale for each, with
   a pointer that moves with the ruler, like the dials of the Prague astronomical clock.
7. **One set of marks.** Every mark comes from one Isotype-style set (Otto and Marie Neurath, Gerd
   Arntz): one symbol family per pace layer, one size at a given scale, and quantity shown by
   repetition rather than size.
8. **Let the visitor suspect; a label confirms.** The globe explains nothing unasked. It sets things
   side by side, as Minard set the temperature under Napoleon's retreating army, and a one-line
   sourced label confirms what the visitor noticed. Labels read like Judith Schalansky's *Atlas of
   Remote Islands*: a place and one small true story.

## Channels and materials

The slower a pace layer, the deeper in the object it lives: nature is the casting itself, and the
fastest things are paper beside the globe. Everything on the globe is made of the globe (engraved,
inlaid, patinated or cast) and lit by its one lamp, and the ember is the only light it gives off.
The assignment below is the first one, to be judged on renders.

| Pace layer | Pace | What it shows | Its events | Channel and material |
|---|---|---|---|---|
| Nature | millennia | relief, seas, rivers, climate, biomes, where resources lie, disease and hazard belts | eruptions, earthquakes, floods, cold years, epidemics | the casting itself: the bronze's shape, grain and patina, with climate as its verdigris and copper wash |
| Culture | centuries | faiths, languages, the names people give places | new faiths and scripts, schisms, foundings | cut deep and filled: faith pictograms incised and filled with black niello, and place names engraved as they were at that date |
| Governance | centuries to decades | borders, capitals, states | wars, battles, sieges, treaties, revolutions | engraved: boundary lines and state names, re-cut as they change |
| Infrastructure | decades | where people live, cities, roads, railways, sea lanes, mines and wells, cables | openings of canals, railways, bridges and cables | laid on: polish worn into land in use, hair-fine lines for routes (engraved on land, gilt at sea), small cast seals for cities |
| Commerce | years | what moves (silver, sugar, cotton, oil), production and trade | booms, busts, embargoes, rushes | loose on the surface: small cast tokens along the routes, in the goods' own metal where they have one; a route's width for its volume, as in Minard's flow maps, and a slow drift along it for direction |
| Fashion and art | months | works, styles, music, news, lives | premieres, publications, discoveries | paper: the vellum card and its images, beside the globe |

- **Polish belongs to land in use.** Climate keeps its hue and stops dulling the polish of cold land
  (`app/src/look/climateHook.ts`) once settled land arrives, so polish means one thing.
- **The instrument** carries the slow global quantities in brass (principle 6).
- **The room** can carry faster global quantities on paper: a framed print on the wall, barely lit
  by the lamp's spill, such as a chart of world output in the manner of William Playfair's line
  charts, changing with the ruler. Output before 1820 is a rough estimate and is drawn as one.

## Revealing

- **Time zoom decides what moves.** At days, the card and events lead and the slow layers hold
  still. At decades, commerce's flows swell and shrink and railways spread. At centuries, borders
  and names change. At millennia, seas, climate and settled land move. The pace layers moving at
  the ruler's pace come forward, and the rest stay as quiet context. Over long spans, fast layers
  condense into counted marks, so a century of battles reads as a short row rather than a smear.
- **Globe zoom reveals finer events**, as the PRD's detail budget does: a war gives way to its
  battles.
- **Attention brings words**: a label on hover or click, a card in a story. Every large pattern
  meets one human life somewhere, the way Tambora's Rajah of Sanggar does.

## Culture: faiths and names

Filled regions for faiths or languages hide how much they mixed, so culture shows as marks and
names.

- Faiths appear as pictograms of their places of worship, set where their people lived. A mixed
  place shows every faith present, repeated in rough proportion, as mosques beside a synagogue
  would for Tetouan in 1519. A building that carries two faiths' history, such as Córdoba's
  mosque-cathedral or Seville's minaret bell tower, takes a combined mark.
- Every faith people held has a mark, folk and indigenous traditions without buildings included, so
  no belief reads as absence. The marks are respectful, generic symbols.
- Each place is engraved under the name it had at that date: Qurtuba, Tenochtitlan, Edo.
- Country-level estimates of faiths begin around 1900 (the Religious Characteristics of States
  dataset, for example); earlier marks come from historical atlases and sources and are drawn
  softer where estimated.

## Where people lived

The first new layer in time: settled land as polish and cities as raised seals, from population
estimates such as HYDE's (Klein Goldewijk and others), which run from 10,000 BCE to the present. It
comes first because it balances the event index. The index knows what was written down, while
population estimates cover everyone, so inhabited land never reads as empty (Michel-Rolph
Trouillot's *Silencing the Past* on how records fall silent).

## Resources through time

The second. A resource spans three pace layers: nature shows where it lies, infrastructure polishes
it while it is worked, and commerce draws where its output goes. Each wakes when people want it and
fades when they stop, Erich Zimmermann's point that resources are not, they become: Peru's guano
islands brighten and dim, then the Atacama's nitrate, which dulls as synthetic nitrate replaces it.
Oil comes first, as the Century of Oil's production layer. The USGS provinces and deposits give the
shapes, and sources give the years each was worked. Every worked deposit of an era shows, dramatic
history or not, so the pattern a visitor sees is real rather than chosen.

## Links between events

- **Draw what moved, write what it meant.** A line or glow on the globe is a claim that cannot say
  historians disagree, so the globe draws physical, documented movement (tankers, pipelines,
  armies, people, a sulfate veil) and leaves interpretation to the text, hedged in the story's
  voice where historians split. A camera flight between beats also claims a connection.
- **A causal claim cites a source that makes it**, beyond sources for the two events it joins, and
  the fact-check pass checks each one.
- **The event index widens pace layer by pace layer.** Today it holds mostly governance's and
  nature's events: battles, sieges, wars and disasters. Wikidata already holds well over 100,000
  located things with an opening date and thousands of dated universities, for infrastructure and
  culture. Its cause-and-effect statements are patchy and sometimes wrong, so they serve as hints
  for a writer and stay undrawn.

## Budget

New layers in time arrive as small tables, lines and low-resolution global fields, uploaded to the
GPU and released on the CPU, because CPU memory is at its line (`streaming.md` 6, 8.2).

## Later

- **The news horizon**: news spreading from an event along the era's routes at the era's speed, with
  Meanwhile's entries beyond it engraved faintly, since Meanwhile shows a simultaneity no one at the
  time lived. It needs more design once the core layers exist.
- **An explorer's commonplace book** that keeps the connections a visitor has found, like the ship's
  log in *Outer Wilds*, waits for a way to keep a visitor's progress.
