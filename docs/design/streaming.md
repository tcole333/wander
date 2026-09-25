# Wander: asset storage, delivery and streaming

Merged design, 2026-09-24, revised after a fact-check, a PRD-conformance audit and a buildability
review. It is written for whoever builds milestone 1 and what follows. It works under the owner's
decisions: every layer independently toggleable; an all-eras event index built for explore in v1;
desktop only; audio in v1; a museum-exhibit stance with exaggerated relief; beat stories with
break-out; framed image cards; borders from the nearest historical-basemaps snapshot with its year
shown; TypeScript, Vite, React, r3f, drei, Zustand; a Python (uv) offline prebuild; Pages at
`wander.traviscole.xyz` and R2 at `wander-data.traviscole.xyz`; a public GitHub repo with Actions CI.

Tags: **[M]** measured (file or source named; **[M proxy]** when the machine, browser or format differs
from the target), **[S]** docs or source code, **[D]** arithmetic from [M]/[S], **[model]** output of
`work/judge/beats_judge.py` (camera footprints × planning tile sizes, not a measured build), **[E]**
estimate that the first build or the named experiment replaces. Paths inside tags and in this key are
relative to `docs/design/measurements/`; every other path is relative to the repo root. Timing and feel constants
are named in `code` and listed once in section 10; they live in `app/src/config/tunables.ts`, and tests
read them from there. `app/src/config/tunables.test.ts` checks that file against section 10's table,
and `pipeline/tests/test_constants.py` checks `shared/constants.json` against the magics in section 3,
the cube constants in 3.0 and the layer order in 3.9, so renaming any of these means updating both.

Repo layout: `app/` is the npm project (the app); `pipeline/` is the uv project (the prebuild), with its
config, queries and test excerpts; `shared/constants.json` is read by both; `stories/<story>/` holds
each story's source; `build/` (git-ignored) holds prebuild output: one root per profile in the R2 key
layout (`build/out/` for global, `build/region/`, `build/fixture/`), stage records in
`build/stages/<profile>/` (7.2) and caches in `build/cache/`. `uv run prebuild` runs in `pipeline/`,
and `npm run <script>` in `app/`; both resolve `build/` from the repo root, whatever their working
directory.

---

## 1. Summary

The globe is an equiangular cube-sphere quadtree of 256-texel tiles with 4-texel borders: L0-L4
everywhere, L5-L6 over land and shelf, L7 only in listed story regions (~15.5K tiles). A tile holds
GEBCO height codes plus shoreline and rivers-and-lakes distance fields, and the shader computes the
brass look. Tiles sit in fixed GPU array pools drawn by one instanced draw; seam rules keep edges
closed and every node draws its deepest resident ancestor, so there are no holes. Thematic layers and
border snapshots are prebaked id + distance tiles in one overlay pool, toggled by uniforms. Events
cover all eras as paged columnar JSON held by one worker. ModE-RA ships per year on its native grid.
Stories compile in CI into bundled JSON; data is immutable whole files on R2, pinned by a bundled
`release.json`. Milestone 1 is a Tambora slice deployed end to end (section 8).

---

## 2. Decisions

| Area | Decision | Why |
|---|---|---|
| **Surface tiling** | Equiangular cube sphere, a quadtree per face, 256² tiles plus a 4-texel border of real neighbor data. Conventions in 3.0; `cube.py` and `cube.ts` are checked against each other in CI. | No polar singularity, small streaming units, and 25% fewer texels than equirect at equal density [D]. |
| **Surface content** | `.wst` (3.1): int16 height codes, u8 shoreline and u8 rivers-and-lakes distance fields, edge profiles. The shader computes color, roughness, normals and engraving (a port of the spike's `surface.js`). No KTX2, Basis, albedo or normal maps. | A palette change is a GLSL edit, and there is no transcoder or per-browser format split. GEBCO L6 height alone measured 25-37 KiB mean [M `alt/gebco_tiles.json`]. |
| **Levels and coverage** | L0-L4 everywhere. L5-L6 where the tile or its border touches land or shelf (GEBCO > −200 m, or a Natural Earth (NE) 10m land or minor-island polygon, dilated one texel). Minor islands (2 km² or smaller) count as land here and in the shore field (owner decision 12); NE 5.1.2 land already holds nearly all of them (2,709 of the 2,795 as identical parts), so joining them adds only slivers. L7 only inside `pipeline/config/l7.yaml` regions. About 15.5K tiles [M ETOPO estimate, `work/asset-sizing/cube-land-fraction.json`]. | A global L7 raises the median beat from 2.2 to 3.2 MB for a gain seen only on close views [model]. L6 (611 m) is a deliberate reduction from GEBCO's ~464 m spacing. |
| **Geometry and seams** | One instanced draw of a shared 33² grid (17² on lite) with skirts. Balanced levels, canonical edges, parent-position morphs and batched reveals (5.6). The `surfaceHeight()` GLSL is shared with attached geometry. | One level apart the seam step is 155-324 m p95; three levels apart it is a 4-6 km cliff at ×8 [M `work/critic-smoothness/seamstep*.json`]. |
| **Physical layers** | Independent uniforms: Relief (`kLand`), Bathymetry (`kSea` + depth bands), Coastline, Land/sea tint, Rivers & lakes, Graticule (analytic), Labels (ocean and sea names). Depth bands are GEBCO contours at Natural Earth's depth intervals, and the legend names both sources (owner decision 4). | Owner: nothing is always on. Contours cost 0 bytes and match the drawn seafloor; keeping the signed seafloor costs ~10 KB on coastal tiles [M]. |
| **Thematic overlays** | Prebaked `.wot` id + distance tiles (3.2) on the surface's cube addresses, L0-L5, in one shared overlay pool with a per-layer indirection texture. Constant and empty tiles get no file. | Independent toggles rule out one global 8192×4096 raster per layer (128 MiB of GPU each); tiles keep memory proportional to the view. |
| **Minerals, mountains, labels** | Minerals: JSON, 2,121 points, instanced markers on `surfaceHeight()`. Mountains: an overlay layer built from the legacy-derived 42-range GMBA v2.0 selection. Place labels: troika inlay text, at most `placeLabelsMax` shown; polity names follow Borders, range names follow Mountains, ocean and sea names follow Labels. Petroleum and minerals are present-day geology, dated in Credits. | A raster decal follows exaggerated relief for free; outline ribbons would need ~2 km densification not to cut through ridges. |
| **Historical borders** | 54 world snapshots (`places.geojson` is not one). The snapshot nearest the cursor date (3.0; ties go to the earlier), with no per-beat pins. The plaque always names it ("Borders: 1878 snapshot"). All 54 previews stay resident; detailed `.wot` tiles stream for the snapshot shown. A snapshot change crossfades over `borderFade`: previews while scrubbing, detail once the ruler rests for `borderRest`. | Owner decision. A coarse global raster cannot hold island-scale shape (a 4096-wide raster samples ~9.8 km), so previews stand in only while scrubbing. |
| **Event index** | All eras in v1. Columnar JSON `.wev` (3.4): a 4,096-row stratified overview, then `all.wev`, or era pages once the corpus passes 100K rows or 16 MiB decoded. One event worker holds and queries it (5.3). | Under gzip, JSON is within ~14% of the best binary (1,032 vs 891 KB for 48.8K rows) [M `work/revision/evjson.json`, `work/wikidata/encode_results.json`] and needs no encoder/decoder pair. A worker keeps a ~10× explore corpus off the main thread. |
| **ModE-RA** | Native 192×96 Gaussian grid. One file per year per variable (mean, spread), u8 with a per-frame offset and scale (3.5), plus one annual-mean file. GPU: a 60-month ring and three annual arrays. | Nothing clips (1814-1817 spans −15.57 to +7.74 K); the step stays ≤ 0.1 K in all but 30 of 7,056 months; ~105-112 KB per year [M]. ES3 guarantees only 256 array layers [S]. |
| **Effects** | Pure functions of historical and presentation time, prepared one beat ahead, with programs compiled in the lobby. Spread: u16 arrival days (3.6). Route: a dated polyline densified to 2 km on land and 10 km at sea; land legs follow `surfaceHeight()`, sea legs sit at sea level. Plume: seeded analytic particles, noted as illustrative in Credits. | Scrubbing backwards needs no replay. u8 ten-day steps cannot hold 1346-1353 (2,921 days) [M `codex/review-events-climate-measurements.json`]. |
| **Story compile and media** | `uv run prebuild media --story <id>` on the owner's machine fetches and encodes media and resolves events into a committed lock. `npm run stories` is pure and runs in CI: zod schema, sanitized HTML, JSON bundled into the app, prerendered article pages. Source format in 3.9. | A text edit ships with a push; bundling the JSON removes the only Pages fetch after boot. Media prep is asset prep, so it sits in the uv prebuild with the event build it depends on. |
| **Per-beat planning** | `lod.ts` plans each beat at run time, at the real viewport and tier: critical set, then desired set (5.7). Residency and eviction rules are in 5.5. Flight-corridor and N+2 prefetch are deferred. | Keeping roots, view N and N+1 critical on the GPU peaks at 206 of 256 slots on the full tier; also keeping N+1's desired set and N−1 overflows on 10 of 41 transitions [model `work/critic-smoothness/poolpressure.json`]. |
| **Transitions** | van Wijk-Nuij flights with a readiness gate: a late beat slows into a short hold, then lands on ancestors (5.7). Optional refinement never blocks. | Flight + hold covers the largest critical set down to ~5.5 Mbps and the median down to ~2 Mbps [D from the model]. |
| **Audio** | Web Audio. The AudioContext resumes in the Enter click handler. Buses ui, bed and cue. UI sounds are synthesized on the audio clock (`detents`; the flight whir via `setTargetAtTime`); beds are synthesis plus short CC0 mono AAC loops joined with `loopCrossfade` at loop points from the lock, and beds change over `bedCrossfade` (3.9). Sample sizes start at `audioEncodedMax` / `audioDecodedMax`. | The PRD puts synthesis first; AAC decodes in every target browser. The allowance is a starting value, raised after the Tambora bed is heard. |
| **Hosting** | App on Pages at `wander.traviscole.xyz`: one entry bundle, no lazy chunks, same-origin workers built at boot. Data on R2 at `wander-data.traviscole.xyz`: immutable whole files (2 KB to ~3 MB) under content-versioned keys. Binaries are gzip streams stored as `application/octet-stream` with no `Content-Encoding`, inflated by `DecompressionStream`; small JSON is plain and edge-compressed. | A first-level name is covered by Universal SSL. `new Worker()` needs a same-origin script. Whole files give simple cancellation and whole-response caching. Stored `Content-Encoding` passthrough on R2 is unverified. |
| **Browser caching** | The HTTP cache with `immutable`, plus an in-memory compressed-byte cache for the current story (16 / 32 MiB, lite / full). No Service Worker or Cache API in v1. | A SW brings update skew, and Safari clears script-writable storage after 7 days without interaction; a story's tiles fit the byte cache. |
| **Scheduling** | Main-thread fetches (so preloads apply) in three classes, with a stall watchdog and no throughput estimator. 2 decode workers and 1 event worker. Uploads admitted by bytes (5.2, 5.4). | At 150 ms RTT six streams of ~45 KB objects top out near 14 Mbps [D], so 12 fetches run at once. Flights gate on readiness, so an estimator would only add false alarms. |
| **GPU pools** | Fixed pools allocated at boot and written through three's public `copyTextureToTexture`, one call per mip (recipe in 5.5). No private three fields. | It keeps one instanced draw, hardware mipmapping and exact `surfaceHeight()` on documented API [S three 0.186.1]. |
| **Quality tiers** | Two tiers, lite and full, fixed before a story starts, plus a render-scale governor (5.8). | No program compiles after the lobby. |
| **Anti-aliasing** | Canvas `antialias: false`; SMAA in the composer; MSAA only on full, and only if E1 shows headroom. | r3f's default `antialias: true` plus three's 4-sample output target would add ~60 MiB at 1440×900 [S r3f 9.8.1, three 0.186.1 `WebGLOutput.js`]. |
| **Context loss, deploys** | In-place restore by re-running the boot GPU init from the byte cache, with a reload as fallback (5.9). Nothing is fetched from Pages after boot. R2 keys are never overwritten or deleted in v1. `release.json` is bundled, with an immutable copy on R2. | With three-managed pools, restore is the boot path again, and it avoids the extra click a reload needs for audio. Old tabs can live for days. |
| **Fonts and labels** | Source Serif 4, the reading face (latin + italic, woff2), on Pages, preloaded. Libre Baskerville, the display face, and the troika label face (`.woff`, subset to exactly the characters used) load from R2 after the first frame. troika's `unicodeFontsURL` points at a same-origin 404, and the labels stage checks glyph coverage. Event labels are one DOM layer placed in one rAF pass. | troika reads `.woff` but not `.woff2` and otherwise fetches fallbacks from jsDelivr; a missing glyph would hang its label silently [S troika 0.52.5 `FontResolver.js`]. One drei `<Html>` per label creates its own React root [M]. |

---

## 3. Formats

All binary files are gzip streams of packed little-endian bytes with no implicit padding. Headers are
padded so every typed array starts at a multiple of its element size. Each file starts with a 4-byte
magic and a u8 format `version`. Key names are content hashes or layer versions:

- `<sha16>` is the first 16 hex characters of the SHA-256 of the file's stored bytes (for a binary,
  the gzip stream).
- `<ver8>` is the first 8 hex characters of the SHA-256 over one line `"<path> <sha256>\n"` per file
  of the layer, sorted bytewise: `<path>` is relative to the layer root (`7/1/103/50.wst`,
  `bounds.bin`) and `<sha256>` is the full hex digest of the stored bytes. The full key cannot be
  hashed, because it contains `<ver8>`. A layer is written to a temporary directory and renamed to
  its `<ver8>` once every file is hashed.

A format version is `version` in a binary header and `v` in JSON; `ver` is always a layer version.
Magics, sentinels, the layer order (3.9) and the cube constants (face table, tile size, border and
Earth radius, 3.0) live in one `shared/constants.json`, read by Python and imported by TypeScript.

### 3.0 Conventions

**Cube sphere** (`cube.py` and `cube.ts` implement exactly this):
1. Globe frame G, right-handed: +X = (0°N, 0°E), +Y = (0°N, 90°E), +Z = north pole. three.js space is
   (G.y, G.z, G.x): north is +Y and longitude 0 faces +Z. Distances use the mean Earth radius
   R = 6,371,008.8 m.
2. Faces as (center C, U, V):

   | Face | C | U | V |
   |---|---|---|---|
   | 0 (+X) | (1,0,0) | (0,1,0) | (0,0,1) |
   | 1 (+Y) | (0,1,0) | (−1,0,0) | (0,0,1) |
   | 2 (−X) | (−1,0,0) | (0,−1,0) | (0,0,1) |
   | 3 (−Y) | (0,−1,0) | (1,0,0) | (0,0,1) |
   | 4 (+Z) | (0,0,1) | (0,1,0) | (−1,0,0) |
   | 5 (−Z) | (0,0,−1) | (0,1,0) | (1,0,0) |

   U × V = C on every face. Faces 0, 1 and 4 meet at the Kirkuk corner (45°E, 35.26°N), so each
   level L has three corner tiles (x, y) there, with n = 2^L (item 4): face 0 (n−1, n−1), face 1
   (0, n−1) and face 4 (n−1, 0).
3. `p = normalize(C + tan(πs/4)·U + tan(πt/4)·V)`, with s, t in [−1, 1]. The inverse is
   `s = (4/π)·atan((p·U)/(p·C))`, and likewise t with V. A point belongs to the face of its largest
   |component| (the sign picks + or −); ties go to the lowest face index.
4. Tile (f, L, x, y): n = 2^L; x runs along U and y along V; y = 0 at t = −1; s spans
   [−1 + 2x/n, −1 + 2(x+1)/n], and t likewise.
5. Positions are exact binary fractions of face-global integers, so a border texel and the
   neighboring tile's interior texel at the same place get bit-identical coordinates (a per-tile form
   such as `s0 + (i + 0.5)·(2/n)/256` can round differently in the two tiles). With G = 256x + i
   (t likewise, from y and j):
   - texel (i, j), with i, j in −4..259, is centered at s = −1 + (2G + 1)/(256n)
   - height sub-sample a in 0..3 (4×4 per texel, 3.1): s = −1 + (8G + 2a + 1)/(1024n)
   - texel corner c in 0..256: s = −1 + (256x + c)/(128n)
   - shore and water subpixel A (3.1): s = −1 + (2A + 1)/(1024n). Sub-samples and subpixels are the
     same points (A = 4G + a).

   Border texels beyond a face edge use the same formulas (tan stays finite) and sample the source
   there. The stored index is i + 4; row 0 is j = −4 (smallest t); textures upload with
   `flipY = false`.
6. Tile-local τ in [0, 1] maps to `uv = (4 + 256τ)/264`, which is the same uv at mips 1 and 2 (and
   `(2 + 128τ)/132` for overlays). Mesh vertex k of 33 sits at texel corner 8k (16k on the 17² grid).
7. Edges: N is corner row 256 (t max), S is row 0, E is column 256, W is column 0. Entries run in
   increasing s (N, S) or increasing t (E, W). Across a face edge, each face meets this neighbor edge:

   | Face | N | E | S | W |
   |---|---|---|---|---|
   | 0 | 4 S | 1 W | 5 N | 3 E |
   | 1 | 4 E | 2 W | 5 E, rev | 0 E |
   | 2 | 4 N, rev | 3 W | 5 S, rev | 1 E |
   | 3 | 4 W, rev | 0 W | 5 W | 2 E |
   | 4 | 2 N, rev | 1 N | 0 N | 3 N, rev |
   | 5 | 0 S | 1 S, rev | 2 S, rev | 3 S |

   Eight of the 12 face edges run the same way on both faces. On the four reversed ones (2N–4N,
   3N–4W, 1S–5E, 2S–5S), entry k is the neighbor's entry 256 − k, and along-edge tile index a is the
   neighbor's n − 1 − a. On a face edge the build writes the shared values in each tile's own order.
   Each edge-profile entry has one owner: the lowest-numbered face among the faces that meet at its
   corner point, read from this table, never from a float comparison (3.1, Edges).
8. Node index (availability bitmap, `index.bin`, `bounds.bin`) = `2(4^L − 1) + f·4^L + y·2^L + x`. Bit
   k is byte k>>3, bit k&7, least significant bit first.
9. Cross-check: the fixture build writes Python samples to
   `build/stages/fixture/expect/cube-samples.json`, with fields lon, lat, L, f, x, y, node, s, t, i, j
   and center (the texel-center vector in G). Vitest compares s and t in Python's face frame:
   `cube.ts` evaluates `faceSt(py.f, p)` on its own direction vector p, within 1e-9. f, x, y and node
   must be equal when the point is at least 1e-8 (in s and in t) from every tile edge, face edges
   included; i, j and the center vector (at most 1e-12 per component) must be equal when it is at
   least 1e-8 from every texel edge. Nearer an edge, numpy and V8 may differ in the last ulp of
   `atan` and pick different tiles or texels.

**Equirect rasters** (spread fields, border previews, ModE-RA): row 0 is the northmost. Texel (i, j) is
centered at lon = west + (i + 0.5)·(east − west)/w and lat = north − (j + 0.5)·(north − south)/h. West is
less than east, and east may run to 540 for boxes that cross the dateline. Previews cover −180..180
and 90..−90. ModE-RA columns are cell centers from −180° in 1.875° steps, and its rows are the 96
Gaussian latitudes.

**Time:** a date is a day number since 0001-01-01 in the proleptic Gregorian calendar with astronomical
years (1 BC is year 0). The build computes day numbers with integer arithmetic, never Python
`datetime` or JS `Date`, since neither reaches deep time. Event files and CPU code hold them as float64,
which is exact for integers to 2^53. Shaders get float32 days relative to an effect or beat epoch,
because float32 days since 0001 step by 1/16 day around 1815 [D].

**Border years:** historical-basemaps names BC years historically. The build converts `world_bcN` to
astronomical year 1 − N (`world_bc1` → 0, `world_bc123000` → −122999), and `release.json` holds only
astronomical years. A snapshot's date is 1 July of its year; the snapshot with the smallest
|cursor day − snapshot day| wins, and ties go to the earlier one. The plaque prints historical years
("1 BC"). Layer keys use the source stem: `borders-1815`, `borders-bc123000`.

**Sentinels:** in u16 id and slot fields, `0xFFFF` means empty. `0xFFFE` means "has a file" in
`index.bin` and "constant tile, id in G" in the indirection texture. Feature id 0 means none, so real
ids run 1..0xFFFD. Spread days use 65535 for never.

### 3.1 Surface tile `surf/<ver8>/<L>/<face>/<x>/<y>.wst`

```
'WST1' u8 version | u8 face | u8 level | u8 flags (bit0 has inland water, bit1 all sea)
u16 x | u16 y
f32 qLand          meters per code at or above −200 m; one value per level
f32 qDeep          = 4·qLand, meters per code below −200 m
i16 codeMid        ⌊(codeMin + codeMax)/2⌋; the GPU stores code − codeMid
i16 codeMin | i16 codeMax          over the stored 264² and the edge profiles; for decoding only
                                   (LOD uses the meter bounds in bounds.bin, 3.8)
i16 edge[4][257]   edge profiles N, E, S, W at texel corners 0..256 (3.0 item 7)
u16 height[264*264]  zigzag(code − pred), pred = left + up − upleft (0 outside the grid)
u8  shore[264*264]   (s − pred) mod 256; s = min(255, rha(128 + 16·d)), d = signed texels to the
                     NE 10m land ∪ minor-islands boundary, clamped ±8 (land > 0; lakes count as land)
u8  water[264*264]   same predictor and encoding; d = signed texels to lakes ∪ buffered rivers,
                     inside < 0
```

- **Height values:** each texel is the mean of its 4×4 bilinear sub-samples (3.0 item 5) of GEBCO
  meters, taken from the coarsest source whose cell is no larger than the texel, or 15" where none
  is: 15" at L5-L7, a 1' block mean at L3-L4, 4' at L1-L2 and 16' at L0 (the coverage stage builds
  these overviews once). The 16 sub-samples are summed in a fixed order, t outer and s inner, then
  multiplied by 1/16.
- **Reading GEBCO:** rows run south first (row 0 is 89.998°S). Cells are center-registered, and
  centers are computed from the index (lon = −180 + (i + 0.5)/240, lat = −90 + (j + 0.5)/240), not
  read from the file. The build's own numpy bilinear sampling wraps longitude modulo 86,400 columns
  and clamps rows at the poles, which have no row of their own.
- **Coastal clamp:** where the unclamped shore distance has |d| ≤ 2 texels, d > 0 gives max(h, 0),
  d < 0 gives min(h, 0) and d = 0 gives 0. Inland depressions such as the Dead Sea keep their
  negative heights.
- **Rounding:** rha(x) rounds half away from zero, everywhere in the build: r = trunc(x), plus
  sign(x) when |x − r| ≥ 0.5. `np.round` rounds half to even and is never used.
- **Codes to meters:** `c200 = rha(−200/qLand)`. For `c ≥ c200`, `h(c) = c·qLand`; below it,
  `h(c) = c200·qLand + (c − c200)·qDeep`. A height's code is the rha of the inverse. qLand is chosen
  per profile and level: the smallest multiple of 1/64 m, starting from max(2 m, texelM/1000)
  rounded up, at which every tile the profile bakes at that level spans at most 4,096 codes over its
  clamped 264² and edge profiles, where texelM = (π/2)·R/(256·2^L). A conservative bound from the
  raw source is tried first, and a tile's exact fields are computed only when it fails. The coverage
  stage reports qLand per level; expect ≤ 3 m at L5 [E]. Then `|code − codeMid| ≤ 2048`, which
  half-float holds exactly.
- **Flags:** bit0 is set when some texel has water d < 0, and bit1 when every texel has shore d < 0.
- **Vector preparation,** once per layer when it loads, in the parent process (workers receive WKB):
  1. `make_valid`
  2. drop Null island (a 1 km square NE places at 0°N 0°E) and apply the class filters; the NE land
     feature with no attributes (2,773 small islands) stays
  3. union the layer: NE land ∪ minor islands (owner decision 12) for the shore; lakes for water
  4. segmentize to at most 0.1° in lon and lat

  The union keeps overlapping features from canceling under even-odd fill, as they would at Georgian
  Bay, North Channel and Saginaw Bay inside Lake Huron, Whitefish Bay inside Lake Superior, and two
  small islands that overlap NE land. NE coastline and ocean are not read.
- **Per-tile clip:** the clip box is the raster's lon/lat footprint, padded by at least 0.1° plus the
  largest river half-width, and spans all longitudes when the tile holds a pole. Clipped geometry is
  segmentized again, which splits only the new clip-edge segments, so every segment that reaches a
  raster is the same whichever tile clipped it.
- **Shore and water fields:** each tile rasterizes 1152² subpixels, 4× over the 264² tile plus a
  12-texel margin (texels −16..271), at the face-global subpixel centers (3.0 item 5).
  - Vertices project to subpixel coordinates A_s = (s + 1)·512n − 0.5 and A_t = (t + 1)·512n − 0.5,
    the continuous form of 3.0 item 5's A (the center of subpixel A sits at A_s = A), with straight
    segments between them. Polygons fill by the even-odd rule. A subpixel is river when its center
    lies within the river's half-width of a segment, by an exact point-to-segment distance.
  - An exact Euclidean distance transform gives each subpixel E, the distance in subpixels from its
    center to the nearest center of the other class. D = +(E − 0.5) inside the mask and −(E − 0.5)
    outside it. The shore mask is land, so land is positive. The water mask is lakes ∪ buffered
    rivers, and the water field negates D, so water is negative (the header above). A texel's d is
    the mean D of its 2×2 central subpixels divided by 4 (subpixels to texels), and ±∞ when the
    raster holds only one class. The stored byte is min(255, rha(128 + 16·clamp(d, −8, 8))).
  - The margin exceeds the ±8 reach, so every value depends only on its position.
- **Water:** NE lakes and river lines, without canals or reservoirs. Reservoirs on an allowlist of
  natural lakes whose level a dam or control structure later raised, lowered or regulated stay, and
  a dropped reservoir's Lake Centerline still draws (owner decision 13). Lakes draw at every level.
  Rivers by level: scalerank ≤ 2 at L0-L1, ≤ 4 at L2, ≤ 6 at L3, and all at L4 and deeper.
  Half-width is `max(0.35 texel, halfWidthKm[scalerank] / texel_km(L))`.
  `pipeline/config/water.yaml` holds `halfWidthKm` for scalerank 0-12 and the allowlist, keyed by
  NE id. The shader holds on-screen line width with `fwidth`.
- **Edges:** within a face, border texels equal the neighbor's interior values because both are the
  same function of position. Across a face edge the texel grids do not line up, so each edge-profile
  entry is computed once, by its owner face (3.0 item 7): the rha mean of the four owner-face texel
  codes around its corner, from the clamped field, owner-frame border texels included. Owner-frame
  texels are computed as strips by the same functions of position, so the owner's tile need not be
  baked. Every tile that shares the corner writes that code in its own order, and a tile's corner
  entries agree: N[0] = W[256], N[256] = E[256], S[0] = W[0] and S[256] = E[0].
- **Decode (TS worker):** inflate, undo the predictor, then build mips 132 and 66 with integer
  arithmetic, `m = (a + b + c + d + 2) >> 2`, for codes, shore and water alike. Mips are built only
  here. Output: R16F offsets (code − codeMid) and RG8 (shore, water) for 3 mips, the R16F edge
  profiles, the meter bounds, a 33² Float32 meter grid, and the compressed buffer handed back (5.2).
  The measured 0.32 ms per tile is a proxy [M proxy: the older two-plane format on an M5]; E1
  re-measures.
  - R16F values are f16 bits from an exact integer-to-half conversion (|v| ≤ 2048; Node 22 has no
    `Float16Array`). The decoder is a pure function that does not import three; the worker wraps it
    and posts its results with `{ transfer }`.
  - The meter bounds are [floor(h(codeMin)), ceil(h(codeMax))] (3.8). In the 33² grid, interior
    vertex k (at corner 8k) is h of the mean of the four mip-2 codes around it, and boundary vertices
    are h of the edge-profile code at their corner. Both are exact dyadic values, so Python and
    TypeScript agree bit for bit.
  - It rejects a wrong key, magic, version or length, a qLand that is not positive or a qDeep other
    than 4·qLand, any |code − codeMid| > 2048, and a codeMin or codeMax that does not match the
    planes and edges.
- **GPU per slot:** R16F 178.7 KiB + RG8 178.7 KiB + edges 2 KiB = **359 KiB** [D].
- **Size:** GEBCO L6 height alone measured 24.8 KiB mean / 43.8 p90 on random windows, 37.4 KiB on
  land-heavy windows and 53-66 KiB on major ranges, with zstd-19 on lat/lon windows rather than cube
  tiles [M `alt/gebco_tiles.json`]. gzip runs ~11% larger [M `work/vector-runtime/hlevels.json`], shore
  adds 4-20 KB on coastal tiles [M `work/judge/coastfield2.json`], and water is unmeasured. Planning:
  ~50-65 KB per L5-L6 land or shelf tile and ~85 KB on mountains [E]; E1 replaces this with the first
  cube-tile bake. Levers if needed: a 5 m step at L6 (~20% smaller) and a coarser shore step.

### 3.2 Overlay tile `ov/<layer>/<ver8>/<L>/<face>/<x>/<y>.wot`

The layers are `ecoregions`, `petroleum`, `mountains` and `borders-<stem>` (one per snapshot).

```
'WOT1' u8 version | u8 face | u8 level | u8 flags | u16 x | u16 y | u16 layerId
four 132×132 planes (2-texel border of real neighbor data), each (v − pred) mod 256:
  idLo, idHi   feature id, u16, 0 = none, exact
  dist         min(255, 16·d), d = texels to the nearest boundary between different ids
  aux          borders: the source's boundary-precision class of the nearest boundary;
               mountains: spine distance, min(255, 16·d); otherwise 0
```

- **`ov/<layer>/<ver8>/index.bin`** (gzip): one u16 per node L0..maxLevel by node index (3.0): `0xFFFE`
  means a file exists, `0xFFFF` means empty, and any other value is a constant feature id (no file).
  That is 8,190 entries (16 KB raw) at maxLevel 5.
  ```
  'WOI1' u8 version | u8 maxLevel | u16 pad | u16 entry[2(4^(maxLevel+1) − 1)]
  ```
- **`meta.json`:** `id → {name, attrs, color, labelPoint}`, the offline 4-coloring for border
  snapshots, the source and the license.
- **GPU:** a 132² RGBA8 array plus a 66² mip. Ids are read with `texelFetch`; distance is read with
  filtered `texture()`. The mountain hatch is procedural from the fill id, and its outline comes from
  `dist`.
- **Indirection:** one RG16UI array texture, (6·2^maxLevel) × 2^maxLevel per layer at the deepest
  `maxLevel` of any layer (192×32 at L5), one array layer per active overlay channel (at most 6). R
  holds the slot (`0xFFFE` constant, `0xFFFF` empty); G holds the resident tile's level, or the
  constant id.
- **Tint:** fills stop one texel short of a boundary, so the id stair-steps sit under an untinted
  margin. Along coasts, fills are clipped by the surface's shore channel.

### 3.3 Border previews `ov/borders-previews/<ver8>/previews.bin`

```
'WBP1' u8 version | u8 pad | u16 count (54) | u16 w (512) | u16 h (256) | i32 years[54] (astronomical)
u8 dist[54][256][512]   equirect (3.0); min(255, 16·d) in preview texels to the nearest border
```

On the GPU this is one R8 array of 54 layers, 6.75 MiB [D].

### 3.4 Event files `ev/<ver8>/{overview,all,p00..p23,long}.wev`

These are gzip'd UTF-8 JSON, one object of parallel arrays. Rows are in score order within each file.

```
{ "v": 1, "rows": n, "classes": [...],        // classes only in the overview
  "row":   [...],   // global row id (rank in the full score order); the unique key across files
  "qid":   [...],   // Wikidata Q-number as an integer
  "lon":   [...], "lat": [...],               // degrees × 1e5, integers
  "t0":    [...], "t1":  [...],               // day numbers (3.0); [t0, t1] covers the date's precision
  "prec":  [...], "cls": [...], "score": [...],   // Wikidata precision 0-14; class index; score 0-1000
  "flags": [...],   // bit0 location inherited (P276/P131), bit1 derived parent position,
                    // bit2 multi-location, bit3 date conflict resolved by rule, bit4 curated
  "unc":   [...],   // location uncertainty radius in km (0 = point)
  "parent":[...],   // global row of the display parent, −1 = none
  "ext":   [[row, w, s, e, n], ...],   // bbox × 1e5 for parents and multi-location events
  "label": [...] }
```

- **Typed arrays in the worker:** Float64 for t0 and t1 (Int32 days wrap silently before about
  5.88 Myr BCE, and Wikidata holds events at −15 Myr); Int32 for row, qid, lon, lat and parent;
  Uint16 for score and unc; Uint8 for prec, cls and flags; labels as one UTF-8 blob with Uint32
  offsets. That is about 73 B per row decoded [D]. The build asserts that every t0 and t1 round-trips
  exactly.
- **Split rule:** `overview.wev` holds 4,096 rows, with equal quotas per era bin × macro-region cell
  (~21 rows each), filled by score, and leftovers by score. If the corpus is at most 100K rows and
  16 MiB decoded, the rest goes into `all.wev`. Otherwise it is split into `p00..p23` by era bin: a row
  goes into every bin it overlaps, except rows spanning more than 3 bins, which go into `long.wev`.
- **Committed config:** `pipeline/config/era-bins.yaml` (24 bins in astronomical years, edges −∞,
  −1e5, −4e4, −1e4, −5000, −3000, −2000, −1000, −500, 0, 250, 500, 750, 1000, 1200, 1400, 1500, 1600,
  1700, 1800, 1850, 1900, 1950, 2000, +∞); `pipeline/config/macro-regions.geojson` (8 macro-regions);
  `pipeline/config/classes.yaml` (the class allowlist and weights, which keep out sporting seasons and
  similar noise); `pipeline/queries/*.rq` with each export's timestamp.
- **Cleaning (build):**
  - **Dates** are normalized to proleptic Gregorian. The original string, calendar and alternate claims
    go to `details/<n>.json` (built in v1, loaded in v1.1).
  - **Places:** direct coordinates first, then inherited ones (flagged). Unlocated parents take the
    centroid of their children, then the P17 centroid, then an override.
  - **Hierarchy:** one canonical display parent per event.
- **Score:** the per-era percentile of `log2(1 + sitelinks)`, counting Wikipedia sitelinks only (the
  PRD's language editions), times the class weight, plus curated
  boosts, scaled to 0-1000. Owner decision 3 adopts the quotas above.
- **Deep time:** storage and bins take any date. Owner decision 2 admits only well-known deep-time
  events, such as the Ries impact at −15 Myr, shown in a compressed deep-time segment of the time
  ruler. The fixture has a −15 Myr row.

### 3.5 Climate `fd/modera/<ver8>/{mean,spread}/<year>.bin` and `annual.bin`

```
'WCY1' u8 version | u8 variable (0 mean, 1 spread, 2 annual mean) | i16 firstYear | u16 frames
u16 nlat (96) | u16 nlon (192) | u16 pad
f32 scale[frames] | f32 offset[frames]    K = u8·scale + offset; 255 = missing
u8 data[frames][96][192]    native grid (3.0): row 0 = 88.57°N (Gaussian latitudes in release.json)
```

- **Scaling:** per frame, offset = the frame's minimum and scale = max(0.1 K, (max − min)/254), so
  nothing clips. The step is 0.1 K except in 30 of 7,056 wide-range months (up to 0.137 K, February
  1984); spread stays under 0.04 K. The build reports the largest step. The coldest 1814-1817 month is
  December 1817, at −15.57 K. Measured with gzip-9: ~105-112 KB per year per variable, and 2.98 MB
  for `annual.bin` [M, fact-check re-encode of the ensmean NetCDF].
- Year files have 12 frames. `annual.bin` has 588 frames, 1421-2008. Months follow the source's
  `(year, month)` indexing; its hour offsets are not reinterpreted through dates.
- **GPU:** an R8 ring of 60 monthly layers (1.1 MB), and the annual means in three arrays covering
  1421-1617, 1617-1813 and 1813-2008 (197/197/196 layers). The boundary year sits in both neighbors,
  so interpolation never spans two textures. Per-frame scale and offset live in a small LUT texture.
- **Shader:** mix frames `floor(m)` and `ceil(m)`, sample bicubically on the sphere through a 96-entry
  latitude LUT, and apply a diverging palette that saturates at `climateRangeK`, independent of the
  data values.
- **Monthly or annual:** monthly frames are drawn when the ruler's visible span is at most
  `climateMonthlySpan` and the cursor year's file is resident; otherwise annual, crossfading over
  `climateSwitchFade`. The legend reads "Annual mean" whenever annual data is drawn.

### 3.6 Effect data

- **Spread `fx/<sha16>.bin`:**
  ```
  'WFX1' u8 version | u8 kind (1 = spread) | u8 planes (1 arrival; 2 arrival + clearing) | u8 pad
  i32 epochDay | u16 w | u16 h | f32 bbox[4] (west, south, east, north; equirect, 3.0)
  u16 days[planes][h][w]    days since epochDay; 65535 = never
  ```
  - **GPU:** R16F, with "never" mapped to 65504 (the half-float maximum). It is exact to 2,048 days,
    then in 2-day steps to 4,096 and 4-day steps to 8,192; the build warns past 8,192 days (~22 years).
  - **Shader:** `coverage = smoothstep(arrival − wDays, arrival, t)`, with `t` in days since the epoch
    and `wDays` the front width from the story (3.9). The glowing front is the contour of `arrival`
    at `t`. With two planes, a cell shows while `arrival ≤ t < clearing`.
  - **Grid:** 0.1° by default, 0.05° where needed. One u16 plane at 0.05° over a 72° × 40° box measured
    417 KB gzip on a synthetic field [M `work/story-first/spread.json`]. The build reports each size,
    and the story core absorbs it.
  - **Credits:** the field is noted as an authored reconstruction, not an observed daily front.
- **Route `fx/<sha16>.json`:** `{"v":1, "epochDay":…, "pts":[[lon,lat,dayOffset,flags],…],
  "labels":[{"i":…,"text":…}]}`. Densified along great circles, with dates interpolated by distance.
  flags: bit0 uncertain leg, bit1 sea.
- **Plume:** parameters only, in the story JSON:
  `{at:[lon,lat], start, peak, end, heightKm, drift:[e,n], seed}`.

### 3.7 Compiled story JSON (bundled into the app, one per story)

```
{ "v":1, "id":"tambora", "title", "blurb", "credits":[…], "eventsVer":"…",
  "core": [{"key":"img/<sha16>-256.avif","bytes":…}, {"key":"fx/<sha16>.bin","bytes":…},
           {"key":"fd/modera/<ver8>/mean/1815.bin","bytes":…},
           {"key":"ov/borders-1815/<ver8>/index.bin","bytes":…}, {"key":"aud/<sha16>.m4a","bytes":…}, …],
  "bed": {"synth":{…}, "loops":[{"key","gain","loopStart","loopEnd"}], "oneShots":[…]},
  "beats": [{
    "id", "date": {"t", "t0", "t1", "precision"},           // day numbers (3.0)
    "camera": {"target":[lon,lat], "viewKm", "tilt", "heading", "drift"},
    "focal": {"qid", "label", "t", "at":[lon,lat]},
    "html": "<p>…</p>",
    "image": {"preview", "avif", "jpg", "w", "h", "crop":[x0,y0,x1,y1], "alt", "credit", "license", "source"},
    "layers": {"relief":true, "bathymetry":false, "coastline":true, "landSea":true, "water":true,
               "graticule":false, "labels":true, "borders":true, "ecoregions":false,
               "petroleum":false, "mountains":false, "minerals":false,
               "climate":{"on":true, "mode":"monthly"}, "events":true},
    "effects": [{"kind":"plume", …params, "assets":[…]}],
    "audio": {"cues":[…]},
    "meanwhile": [{"qid", "label", "t", "at"}],
    "core": [indexes into story.core] }] }
```

The border snapshot is not in the beat; the runtime computes it from the date (3.0). Events are named
by qid only. The story index (titles, plaque text, beat 1's date, camera and layers) and the article
pages are built from the same JSON.

### 3.8 `app/src/generated/release.json` (committed and bundled; copy at `rel/<id>.json`)

`npm run publish-data` is its only writer; it merges the stage records (7.2).

```
{ "id":"<sha16 of this JSON's canonical form without the id field>", "built":"…",
  "dataHost":"https://wander-data.traviscole.xyz",
  "surface": {"ver", "maxLevel":7, "qLand":[…per level], "c200":[…], "avail":"<base64, 1 bit per node>",
              "bounds":"surf/<ver8>/bounds.bin"},
  "thematic": {"ecoregions":{"ver","maxLevel":5}, "petroleum":{…}, "mountains":{…}},
  "borders": {"stems":["bc123000", …, "2010"], "years":[-122999, …, 2010], "ver":{"1815":"…", …},
              "previews":"ov/borders-previews/<ver8>/previews.bin"},
  "events": {"ver", "overview", "files":[{"key","t0","t1","rows","bytes"}]},
  "modera": {"ver", "years":[1421,2008], "lat":[88.57, …], "lon0":-180, "dlon":1.875,
             "bytes":{"mean":{"1815":…}, "spread":{…}, "annual":…}},
  "fx": {"<name>":{"key","kind","epochDay","bbox","w","h","bytes"}},
  "minerals":"pt/<sha16>.json", "labels":"lb/<sha16>.json",
  "fonts": {"display":"fn/<sha16>.woff2", "labels":"fn/<sha16>.woff"} }
```

The availability bitmap is 131,070 bits at L7 (16 KB raw) and sparse, so it compresses well inside the
bundle. At run time a node uses its parent's height bounds until its own tile loads.
`surf/<ver8>/bounds.bin` (gzip) holds every available node's bounds for the warm planner in Node:

```
'WSB1' u8 version | u8 maxLevel | u16 pad | u32 count (available nodes)
i16 bounds[count][2]   min and max meters per available node, in node order (3.0 item 8)
```

LOD bounds are meters everywhere. A node's bounds are [floor(h(codeMin)), ceil(h(codeMax))], where
h(c) maps codes to meters (3.1): the same values the decoder returns for a loaded tile.

### 3.9 Story source

- **`stories/<story>/story.md`:** front matter (id, title, blurb, credits), then per beat one H2, one
  fenced YAML block tagged `beat`, and 60-120 words of text.
- **Beat fields:**
  - `id`
  - `date`: ISO-8601, proleptic Gregorian, astronomical years (for example `-0099-03-01`); optional
    `window: <start>..<end>` and `precision`
  - `camera`: `target` [lon, lat] in degrees; `viewKm`, the visible width at the target; `tilt` in
    degrees from nadir; `heading` in degrees clockwise from north; `drift`, none or slow
  - `focal`: `{qid, at?, date?}` (overrides Wikidata)
  - `image`: `{commons, sha1, crop: [x0, y0, x1, y1], alt}`
  - `layers`: the listed layers are on and anything omitted is off. The canonical order, which is also
    the `?l=` bit order: relief, bathymetry, coastline, landSea, water, graticule, labels, borders,
    ecoregions, petroleum, mountains, minerals, climate, events. `climate` may carry
    `{mode: monthly | annual}`.
  - `effects`: a list of `{plume | spread | route | pulse | callout: params}`; spread and route take
    `{dataset, wDays, style}`
  - `audio: {cues: [...]}`
  - `meanwhile: auto | [qids]`
- **Datasets:** `stories/<story>/data/<name>.geojson`, with kind, epoch and grid in top-level properties
  that Python reads. A spread is isochrone polygons, each with a `by` date. A route is a LineString with
  a per-vertex date array.
- **Beds:** `stories/<story>/audio/bed.json` holds `{synth: {...}, loops: [{src, gain}], oneShots: [...]}`,
  with the CC0 WAV sources committed beside it.
- **Meanwhile, auto:** the top `meanwhileCount` events by score inside the beat window that lie more
  than `meanwhileMinKm` from the target, at most one per macro-region.
- **Lock** (`stories/<story>/story.lock.json`, written by the media stage, committed):
  `{eventsVer, images: [{key, bytes, w, h, credit, license, source}], audio: [{key, bytes, loopStart,
  loopEnd}], events: {qid: {label, t, at}}, meanwhile: {beatId: [qid, …]}}`.

---

## 4. Delivery

### 4.1 R2 keys (bucket `wander-data`)

```
surf/<ver8>/<L>/<face>/<x>/<y>.wst | bounds.bin        surface tiles, per-node height bounds
ov/<layer>/<ver8>/index.bin | meta.json | <L>/<face>/<x>/<y>.wot     overlays (borders-<stem> per snapshot)
ov/borders-previews/<ver8>/previews.bin
ev/<ver8>/overview.wev | all.wev | pNN.wev | long.wev | details/<n>.json
fd/modera/<ver8>/mean/<year>.bin | spread/<year>.bin | annual.bin
fx/<sha16>.bin | fx/<sha16>.json                        story datasets
pt/<sha16>.json  lb/<sha16>.json                        minerals, curated labels
img/<sha16>-256.avif | -1024.avif | -1024.jpg
aud/<sha16>.m4a    fn/<sha16>.woff | .woff2
lic/<sha16>.txt                                         GPL-3.0 text, source commit, build-script link, attributions (owner decision 6)
rel/<id>.json                                           immutable copy of each release.json
_smoke/<sha16>.*  _e4/…                                 hosting checks (issue #1), E4 test objects; in no release
```

### 4.2 Hostnames, zone settings and headers (Free plan)

- **App, `wander.traviscole.xyz` (Pages project `wander`, default host `wander-7z4.pages.dev`):**
  - `index.html` is served `max-age=0, must-revalidate`; `/assets/*` and `/fonts/*` are
    `public, max-age=31536000, immutable`.
  - A top-level `404.html` makes a missing asset a real 404; without it, Pages serves `index.html` for
    any path [S].
  - A build hook writes `Link: <url>; rel=preload; as=fetch; crossorigin=anonymous` lines for the L0
    tiles into `_headers`, which Pages sends as Early Hints; Pages does not turn `<link crossorigin>`
    elements into hints [S Pages Early Hints doc]. The HTML keeps matching
    `<link rel=preload as=fetch crossorigin>` elements and a preconnect. The app fetches with
    `{mode: 'cors', credentials: 'omit'}`, so the preloads are used.
- **Data, `wander-data.traviscole.xyz` (R2 custom domain):** a first-level name, so Universal SSL
  covers it. Never `r2.dev`, which is rate-limited and uncached [S].
  1. **Cache Rule:** `http.host eq "wander-data.traviscole.xyz"` → eligible for cache, edge TTL from the
     origin. Custom extensions and `.json` are not cached by default [S].
  2. **Response Header Transform Rule:** `Access-Control-Allow-Origin: *`, `Timing-Allow-Origin: *`.
     Every request is a simple GET with no Range header, so none needs a preflight.
  3. Smart Tiered Cache on and HTTP/3 on. Origin Range Requests stay off, because nothing uses ranges.
- **Object headers** (set by rclone at upload): `Cache-Control: public, max-age=31536000, immutable`
  and an explicit Content-Type: `application/octet-stream` for `.wst`, `.wot`, `.wev` and `.bin`, then
  `application/json`, `image/avif`, `image/jpeg`, `audio/mp4`, `font/woff` and `font/woff2`. Custom
  extensions keep dev servers from guessing an encoding.

### 4.3 Publish order and retention

1. `uv run prebuild` on the owner's machine (GEBCO is 7.47 GB inflated [M]) builds the global
   profile (owner decision 17), running every stage except `excerpts` and `media` (7.1): `fetch`
   fills `$WANDER_DATA/sources/`, and the build stages write `build/out/` in the R2 layout and their
   records in `build/stages/global/` (7.2).
2. `uv run prebuild media --story <id>` when images, audio or event references change, or the events
   version changes. It writes `img/` and `aud/` into `build/out/` and the committed lock.
3. `npm run publish-data`, which takes the same `--profile` as the prebuild (default global), so a
   region bake and a global bake never mix in one upload:
   - uploads the keys in the profile's output root that R2 lacks (`rclone --immutable
     --ignore-existing`, with headers)
   - runs the publish check: GET 20 random new objects twice; expect `HIT` on the second (from this
     machine), a byte-exact sha, CORS and the right Content-Type
   - warms the cache (4.4)
   - writes `release.json` from the stage records and uploads `rel/<id>.json`
4. Commit and push. CI tests, compiles the stories, builds, checks with a HEAD request that
   `rel/<id>.json` is live on the data host, and deploys Pages last, so HTML never names data that is
   not live.

- **R2 writes happen on the owner's machine,** because CI needs none. CI holds only a Pages-scoped
  API token, the `CLOUDFLARE_API_TOKEN` repository secret. Long-lived R2 API tokens scope to whole buckets; if CI ever needs to write, a temporary credential can
  be limited to a prefix [S R2 temporary credentials].
- **Retention:** no key is overwritten or deleted in v1. Overwriting is unsafe because 404s and old
  bodies get cached at the edge and in browsers, and edge caches cannot be purged reliably (on Free,
  hostname, prefix and tag purges are limited to 5 a minute, and single-file purges must list every
  URL) [S]. Clean-up is deferred (section 9).
- **Rollback** is a Pages rollback: the older bundle names an older release whose data is still there.

### 4.4 Warming and cost

- **One-shot warm in `publish-data`** (~200-300 MB [D]): surface L0-L4 (2,046 tiles); every story's
  core and per-beat critical and desired sets for both tiers at 1440×900, 1536×864 and 1920×1080 CSS
  (computed by `lod.ts` in Node from `bounds.bin`); overlay L0-L2 for every layer; border previews,
  indexes and metas; events; the climate years stories use.
- **What warming covers:** the owner's nearest Cloudflare data center and the Smart Tiered upper tier
  only [S `work/cloudflare/tiered.md`]. Visitors elsewhere miss their local data center and pay the round
  trip to the upper tier. The flight hold and prefetch are sized against a fill (E4's ~500 ms break
  point), not against a local HIT; E4 measures fills from the owner's machine only (owner decision 9). The 17 ms HIT and 152 ms cold R2 figures are
  curl range requests from Boston to another host [M proxy `work/cloudflare/`].
- **Freshness is not residence.** A one-year TTL sets freshness only; unpopular objects can be evicted
  sooner [S Cloudflare retention-vs-freshness]. E4 measures decay before any cron is added.
- **Cost:** storage is ~1 GB per release, with unchanged layers shared, free up to 10 GB and then
  $0.015/GB-month [S]. A full publish is ~0.1M Class A operations (~15.5K surface + ~60-100K overlay
  tiles [E]) against 1M free a month, and misses stay within the free 10M Class B. Edge HITs carry no
  Class B charge per the docs, unverified (E4). There are no Workers. Expected running cost at showpiece
  traffic: $0 a month.

---

## 5. Runtime

### 5.1 Threads

| Thread | Owns |
|---|---|
| Main | `lod.ts` (≤ 0.5 ms), the scheduler and every `fetch`, the byte cache, GPU uploads, instance buffers, event-label placement, R3F and React |
| Decode workers × 2 | stateless: inflate and decode `.wst`, `.wot`, `.bin` and climate files; results and the compressed buffer come back as transferables |
| Event worker × 1 | parses `.wev` into typed arrays, holds the resident pages, runs the detail-budget and Meanwhile queries |
| Audio render thread | beds and synthesized UI sounds |

- **Worker boundary:** worker `onmessage` handlers only push to a ready queue, which the frame loop
  drains.
- **React:** holds discrete state only. The camera, date and ruler update through transient Zustand
  subscriptions that write straight to uniforms and the DOM.
- **Idle work:** budgeted queues run inside rAF and yield through `MessageChannel`, because Safari
  lacks `requestIdleCallback` and `scheduler.postTask` [M proxy: Playwright WebKit 26.6; E1 checks
  shipping Safari].

### 5.2 Requests: classes, cancellation, stalls

| Class | Contents, in order | In flight |
|---|---|---|
| **now** | missing roots (L0-L1); the current view's desired set with ancestors, coarsest first; a toggled layer's view tiles; the current beat's core and critical items; a Resume, Back or jump target; the predicted resting view of a zoom gesture; after the ruler rests on a new snapshot, its `index.bin` and `meta.json`, then its view tiles | up to 11 while background has queued work, else 12 |
| **next** | the hovered story's core and beat-1 critical set; the rest of the story core; N+1 critical; N+1 desired | ≤ 4, shared with background |
| **background** | L2; the event overview, then event pages (5.3); border previews; for each thematic layer, `index.bin` and `meta.json`, then its L0 tiles; label and display fonts; climate years within `climatePrefetchYears` of the cursor while climate is on (`annual.bin` once climate is first shown); neighboring snapshots' index, meta and view tiles | ≥ 1 whenever it has work |

- **Concurrency:** `inFlight`, split as in the table.
- **Fetch:** `fetch(url, {priority, mode: 'cors', credentials: 'omit'})`, with priority `high` for now
  and `low` otherwise. Bodies are read through a stream reader.
- **Byte cache and workers:** the main thread transfers the fetched buffer to a decode worker, which
  returns it with the decoded result; the main thread stores the returned buffer in the byte cache. A
  transferred buffer is detached, so the cache cannot keep the original.
- **Ancestor chains:** a child can be requested once its parent is *requested* (not resident), so a
  whole chain loads in parallel.
- **Motion LOD:** while the camera moves faster than `motionLodRate`, requests are capped at
  desired−2.
- **Cancellation:** queued requests not wanted for `queueDrop` are dropped. Superseded next and
  background requests are aborted unless more than `finishIfReceived` of the body has arrived. A
  generation counter drops decode results nobody wants before they are uploaded.
- **Watchdog:** no bytes for `stallBytes`, or no headers for `stallHeaders`, means abort and retry.
  Retries follow `retryDelays` with jitter; after that the object is degraded for `degradeFor` while
  its ancestor keeps drawing.
- **A 404 on an immutable key** is a release bug: log it, and do not retry.
- **No throughput estimator:** flights gate on readiness, so a sample that reads low during a stall
  degrades nothing.

### 5.3 Events at run time

- **Residency:** if the accepted corpus fits the worker's index cap (section 6), every page stays
  resident. Otherwise the worker keeps the overview plus the pages that overlap the ruler window ±1 bin,
  evicts other pages in LRU order, and prefetches the next bin in the scrub direction. Rows are never
  dropped to fit memory.
- **Query:** over the ruler's visible span and the view, at up to `eventQueryHz` while moving, with
  generation ids. Story focal events and Meanwhile lists are exempt from the budget.
- **Detail budget:** `eventMarkers` and `eventLabels` per tier. Focal events always show. A parent
  shows until its on-screen extent passes `parentSplitPx`, then its children replace it (and it returns
  below `parentMergePx`). At most `declutterPerCell` events per 64 px cell. A newcomer needs `hysteresisScore`
  more than an incumbent to displace it. Fades take `eventFade`.
- **References:** story JSON and the lock name events by qid; the worker builds a qid → row map on load.
- **Meanwhile panel:** while a beat is showing, its compiled list. During break-out, the worker runs the
  same rule (3.9) on the ruler window and the view center.

### 5.4 Uploads per frame

- **Admission is by bytes:** `uploadAnimated` per animated frame, and `uploadIdle` when nothing
  animates.
- **Stopping early:** admission stops after `uploadStopMs` of measured time, or after any single call
  over `uploadSlowCall`, because a timer cannot bound one synchronous driver call.
- **Staging:** a surface slot (359 KiB) may take two frames, height first. A tile becomes drawable only
  when every part is uploaded.
- **Order:** roots, the current view coarsest first, a toggled layer, N+1 critical, then the rest.
- **Tuning:** the caps rise only from E1/E2 measurements on the target machines (see the hardware
  note in 8.2).

### 5.5 Pools, residency, eviction

- **Pool recipe (`app/src/gpu/gpuPool.ts`):**
  1. `new DataArrayTexture(null, 264, 264, slots)` (132² for overlays). The constructor takes no
     format or type, so set the channel's `format` and `type` after construction.
     - Set `generateMipmaps = false` and `mipmaps` to real level descriptors,
       `{data, width: size >> l, height: size >> l}` (size 264, or 132 for overlays) with an empty
       `data` array of the channel's type, one per level (three; two for overlays). Three reads only
       their count and allocates that many levels in `texStorage3D`. The descriptors must still be
       real, because `@types/three` types `Texture.mipmaps` and `[{}, {}, {}]` fails `tsc`.
     - Set `magFilter = LinearFilter` and `minFilter = LinearMipmapLinearFilter`. The default
       Nearest magnification returns one texel at lod 0 instead of the mean at a texel corner, where
       mesh vertices sit, which breaks seams.
     - `source.dataReady = false` (no full-array upload), `needsUpdate = true` (otherwise three
       binds its placeholder texture) and `flipY = false` (3D uploads reject it) are all required.
     - Call `renderer.initTexture(pool)` at boot. Filters, wrap, format, type, internal format,
       `generateMipmaps`, `flipY`, unpack alignment, color space and premultiply are fixed from then
       on: a later change is either ignored or reallocates the array and empties every slot.
  2. Uploads go through per-size staging `DataTexture`s (264, 132, 66), each the size of its level,
     that stay unknown to the renderer: never given to a material, a uniform or `initTexture`.
     `copyTextureToTexture(staging, pool, null, (0, 0, slot), 0, mip)`, with `srcLevel` 0, then
     takes its `texSubImage3D` path and does not regenerate mips. The framebuffer path would also
     work, since three enables `EXT_color_buffer_float`, but it adds a GPU copy and framebuffer
     attach calls to every write [S three 0.186.1 `WebGLTextures.js` L296-318, L1168, L1174, L1178;
     `WebGLRenderer.js` L3336, L3460, L3521, L3562, L3605-3607].
  3. The level count relies on `getMipLevels` returning `mipmaps.length` in the pinned three version.
     The pool smoke test (7.3) writes mip 2 of one slot, samples it back with `textureLod`, checks
     the exact GL calls three makes, and asserts `gl.getError() === 0`.
- **Allocation:** every pool, the climate ring and annual arrays, the previews, and the indirection and
  draw-index textures are allocated at boot. Each is touched once behind the poster (a pool's
  `warm()` step, one draw), because ANGLE may zero-fill lazily on first use [E]. None is ever
  reallocated.
- **Sizes:** surface 160 / 256 slots (lite / full), with the edge profiles in a 257 × 4 R16F array
  (Nearest, one level). Overlay `overlaySlots` to start; E3 counts the peak with every layer on and
  resizes to the peak plus 25%. No array may exceed 256 layers, the ES3 minimum [S]; a peak above
  that is absorbed by the coarser-ancestor rule below, not by a second array (which would cost a
  sampler).
- **Fixed slots:** L0-L1 (30 tiles) sit at slots 0-29. The shader reads the L1 ancestor's shoreline for
  the broad coastal bevel, whose weight fades in over `bevelFade` once all 24 L1 tiles are resident.
- **Slot safety:** to publish a tile, upload all its parts, write its residency or indirection entry,
  then rebuild the instance buffer. To evict one, remove it from the draw set, rebuild, then quarantine
  the slot for `slotQuarantine` frames. `codeMid` travels in instance data, so it never falls out of
  step with a slot.
- **Surface eviction:** the least recently drawn unprotected tile goes first, and N+1 critical goes
  last.
  - **Protected:** the roots; anything drawn or fading; the parent of every drawn source, plus other
    ancestors within 3 levels; the current beat's critical set.
  - **LOD bias** rises by `lodBiasStep` only when the drawn set cannot fit, and steps back after
    `lodBiasRelax`.
- **Overlay eviction:** disabled layers' tiles go first, then tiles out of view. Every thematic layer's
  L0 tiles (loaded in the background after the lobby) are protected, so a first toggle draws at once, as
  are the current view's tiles of enabled layers. If the pool is still full, the view draws coarser
  overlay ancestors (the indirection's G already carries the level); a layer is never turned off for
  lack of slots.
- **Byte cache** (16 / 32 MiB): the current story's compressed surface and overlay tiles, climate years
  and effect files, in LRU order.
  - **Protected:** the roots, the story core, and the N−1, N and N+1 sets.
  - Back, Resume and context-loss restore decode from it with no network.
  - The HTTP cache is a third level that nothing relies on.
- **Attached geometry:**
  - An R16UI draw-index texture at the deepest shipped level (6 × 128² at L7, 192 KiB) maps each cell to
    the instance drawn there; coarser instances fill every cell they cover. The instance data is
    mirrored into a float texture.
  - `surfaceHeight(dir)` evaluates exactly what the globe draws (source, fade partner, morph, edges), so
    ribbons, medallions, labels and the plume emitter stay on the surface mid-fade.
  - The CPU `heightAt()` uses the 33² grids. It serves camera clearance and event-label anchors, where a
    few pixels of error do not show.
- **Debug key check** (debug builds only): a one-row RGBA8 texture holds each slot's tile key, written
  when the tile is published. The fragment shader outputs magenta where a slot's key differs from the
  key the instance expects, and a magenta sphere at 0.98 R shows any hole.

### 5.6 Geometry and seams

- **Instance data (6 × vec4):** key (face, L, x, y); source slot + sub-rect (u0, v0, scale);
  fade-partner slot + sub-rect; parent slot + sub-rect; codeMid of source, partner and parent + fade
  start; per-edge flags (neighbor node level −1/0/+1, edge on the coarser source's tile boundary, that
  edge's mip) + fade duration + source level + node level.
- **Rules:**
  1. **Balance.** `lod.ts` balances twice, across face edges too: adjacent drawn nodes differ by at most
     one node level, and their sources by at most one level. It demotes the finer source, or splits the
     coarser node.
  2. **Vertex mip:** `m = clamp(log2(vertex spacing in source texels) − 1, 0, 2)`. A vertex on a shared
     edge uses the coarser side's m.
  3. **Shared-edge heights:** an edge on the coarser source's tile boundary takes its heights from that
     source's edge profile; any other shared edge samples the coarser source's 2D texture at its m.
  4. **T-junctions:** on the finer side of a 2:1 node edge, odd vertices sit at the midpoint of their two
     even neighbors' final displaced positions and take no height sample.
  5. **Diagonal:** every quad splits along corner (k, l)–(k+1, l+1).
  6. **Morph start:** a new child's vertex is the barycentric blend of its parent triangle's three
     vertices, each computed with the parent's own source, mip and edge rules. That is why the instance
     carries the parent's slot, sub-rect, codeMid and edge flags. (Parent heights alone miss the
     parent's chords, by ~1.9 km on a coarse root grid.)
  7. **Land or sea:** the shore channel, sampled at the same source, uv and mip as the height, selects
     the factor. Land displaces by `kLand·h`; sea displaces by `kSea·min(h, 0)` when Bathymetry is on,
     and by 0 otherwise. Turning Relief off animates `kLand` to 0. Depth bands use the same sea mask.
  8. **Skirts** stay as insurance against sub-pixel float gaps.
- **Reveals:** on a still camera (no flight or gesture; a slow drift counts as still), new tiles wait
  until every visible desired tile of that level is ready, or `revealHold`, then morph together over
  `revealMorph`. While moving, each tile crossfades on its own over `tileFade`.

### 5.7 LOD, prefetch and readiness

- **`lod.ts` is a pure function** of camera, viewport (CSS px), tier, exaggeration, availability and
  per-node meter bounds (3.8), with frustum and horizon culling.
  - **Refine** while a texel covers more than `refinePx` (1.5 CSS px lite, 0.83 full); **merge** below
    0.7× that. These are the beat model's Low and Medium profiles, so changing them invalidates the
    budgets in section 6 and the pool sizes.
  - Viewports over 1440×900 CSS scale the threshold by √(area ratio), so tile counts stay inside the
    pools.
  - **Zoom floor:** an owner decision (1). It starts at `zoomFloorKm` (~100 km across, where an L6
    texel spans ~9 CSS px at 1440 px wide) and is settled by a look at 100, 50 and 30 km in E1/E2.
- **Per-beat plan:**
  - **Critical** = the beat's story-core items + surface tiles at desired−1 + the beat's overlay tiles
    (with its snapshot's index and meta) + the decoded card.
  - **Desired** = the desired level.
  - **On landing at N:** the rest of the core, then N+1 critical, then N+1 desired, then background. N−1
    stays compressed in the byte cache.
  - **Layers:** every beat transition (Next, Back, Resume) applies the beat's layer set; toggles made
    during break-out last until then.
- **Zoom prediction:** at the start of a wheel or trackpad gesture, predict the resting view and request
  its chain. If that view is not ready when the gesture ends, inertia eases over the last one or two
  levels.
- **Lobby:**
  1. The inline poster paints.
  2. The live instrument crossfades in once programs are compiled and L0 is resident.
  3. The globe refines from L0 to L1 to L2.

  Hovering a story plaque for `hoverQueue` queues that story's core and beat-1 critical set at the head
  of next; hovering another plaque cancels it.
- **Dive (~3 s):**

  | Time | On screen | Loading |
  |---|---|---|
  | 0 s (click) | rings swing open; unlock sound | the AudioContext resumes in the click handler; beat-1 core and critical move to now |
  | 0.4-2.6 s | flight into beat 1; the ruler slides to the story date | beat-1 core, critical, then desired |
  | 2.2-3.0 s | the title plate engraves in once `document.fonts.load()` resolves (fallback after `titleFontWait`); the text card slides in | beat 2 enters next |

- **Ready for landing at beat N:** N's core items (preview, effect datasets, climate years, snapshot
  index and meta) are resident and prepared, N's critical surface and overlay tiles are uploaded, and the
  1024w card is decoded with `img.decode()` (or its preview stands in).
- **Flights:** a van Wijk-Nuij path lasting `flightDuration`, with ρ = 1.42.
  - **Gate:** at `gateAt` of the flight, if N is not ready, a critically damped time-warp eases toward
    zero and holds just above the target for at most `holdMax`. The camera then lands on ancestors, and
    refinement continues in place. A missing core item shows its fallback (the preview, or a caption
    plate) and fades in when it arrives.
  - **Retargets** blend over `retargetBlend`; rapid presses coalesce to the latest target, and the text
    card follows the target at once.
  - **During a flight** the ruler sweeps the date and borders crossfade if the snapshot changes. N's
    effects fade out at takeoff, and N+1's fade in from `gateAt` or whenever `prepare` completes. The
    whir follows angular speed.
  - **Reduced motion:** a shutter dissolve of `rmDissolve`, holding up to `rmHoldMax`.
- **Break-out:** dragging, zooming or scrubbing away from the beat pauses the story and shows a Resume
  plaque. The same streamer serves the free view. Resume and Back are ordinary beat transitions.

### 5.8 Frame loop, shaders, quality

- **Frame loop:** `frameloop="always"` runs only while something animates: a flight, gesture, drift,
  time-dependent effect, or the instrument's motion. Otherwise it is `"demand"`, and every stream
  completion calls `invalidate()`. The delta is clamped after idle or a hidden tab.
- **Lobby precompile,** behind the poster:
  - **Render target:** compile with the composer's input target bound, because three 0.186.1 keys programs
    on the bound target's tone mapping and color space [S `WebGLPrograms.js`].
  - **Scene state:** include the real lights and shadows, an off-screen label, the depth pass, and every
    effect program for the tier.
  - **API:** use `compileAsync` where `KHR_parallel_shader_compile` exists. Firefox on macOS lacks it
    [M proxy; the pre-launch rerun checks Windows], so there one material compiles per frame.
- **Fragment samplers:** the surface program uses about 13 of the 16 guaranteed: height, channels,
  overlay pool, indirection, palette/scale LUT, previews, noise, climate ring, annual chunk, spread,
  shadow, environment and ramp. Adding one needs a check against that limit.
- **Anti-aliasing:** the canvas is created with `antialias: false`, and the composer runs SMAA (FXAA on
  lite if E1 shows SMAA costs too much). MSAA 4× on the composer input is used only on full, and only if
  E1 shows headroom (~+60 MiB at 1440×900).
- **Tiers:** two, lite and full. The renderer string gives a first guess (Apple or discrete NVIDIA/AMD →
  full; Intel, AMD integrated or unknown → lite). After the precompile, the lobby renders `probeFrames`
  animated frames at render scale 1.0 and switches full → lite if timer-query GPU p90 exceeds
  `probeGpuMs` (or, without timer queries, if more than `probeMissFrac` of vsyncs are missed); lite's
  programs then compile before Enter goes live. The tier is fixed once a story or explore starts.
- **Runtime knobs never compile:** render scale (starts at 1.0; `renderScale` range per tier, changed
  only when no flight or gesture runs, never past the GPU cap), plume count, shadow refresh, and LOD
  bias +0.25 at the next beat. The plume starts at `plumeParticles` and rises only if E1 shows
  headroom. The governor steps per `governor`; a fixed Energy Saver frame cap is not a miss.

### 5.9 Failures, slow networks, hidden tabs

- **Slow network:** there is no mode switch. Ancestors draw, flights hold for at most `holdMax`, and
  refinement continues in place.
- **Other failures:** a failed image shows its caption plate, a failed effect `prepare` is skipped with
  a log line, failed audio leaves silence, and a label whose troika sync has not resolved within
  `labelSyncTimeout` is logged and skipped.
- **Unusable renderer:** no WebGL2, or `failIfMajorPerformanceCaveat` failing, sends the visitor to the
  article pages. `?gl=software` overrides this for CI.
- **Context loss:** call `preventDefault`, then show the instrument backdrop with the story text still
  readable. On `webglcontextrestored`, re-run the boot GPU init (pools, programs, roots and the current
  view) from the byte cache, which keeps audio, story, camera, time and layers. With no restore within
  `restoreTimeout`, reload to the URL state.
- **Tab hidden:** ramp the ui and cue buses to 0 over `hideRamp`, duck the bed, then suspend the
  AudioContext. Pause the story clock and stop decoding and uploading; fetches continue into the bounded
  byte cache.
- **Tab visible:** an audio fade-in of `showFade`, a clamped delta, and the queue resumes.
- **URL state:** `history.replaceState` writes `?s=<story>&b=<beat>&t=<date>&c=<lon,lat,km>&l=<layer
  bits>` on every beat and whenever the camera or ruler settles. A load with `?s&b` lands on the
  Continue plate (one click unlocks audio), which also covers Chrome Memory Saver discards [S].
- **Stale chunks:** a `vite:preloadError` handler reloads to the URL state. It covers dev and lab chunks
  only, since the visitor path has none.

---

## 6. Budgets

Rows marked "reported" are not gates: the story walks in `npm run e2e:gpu` (7.3) print any beat or
story above them.

| Budget | Number | Basis |
|---|---|---|
| **Before the first live frame** | **~0.95 MB** [E]. The requirement is a live frame < 3 s at cold 25 Mbps / 50 ms (the definition of "normal broadband" is owner decision 5). | HTML + inline AVIF poster ≤ 50 KB; one JS entry ≤ 500 KB br (three, r3f, drei subset, zustand, app, `release.json`, 5 story JSONs) [E; unminified three alone is 131 + 287 KB gz, M]; worker modules ≤ 40 KB [E]; fonts 69 KB [M proxy: EB Garamond, the earlier choice; Source Serif 4 is re-measured]; L0 surface 6 × ~50 KB [E]. The instrument and environment are procedural; there is no transcoder. |
| **First paint / first live frame** | poster ~0.3-0.6 s; live frame ≤ 2.5 s | TLS + HTML ~150 ms, 0.95 MB ≈ 0.3 s, JS parse ~250 ms, then pool allocation and compiles behind the poster (E1 and E3 measure) [E] |
| **Lobby settle** (background) | ≤ 3 MB before L2 | L1 ~1.1-1.4 MB [D from the planning mean]; event overview ~90 KB [D from 18-22 B/row]; border previews ~1 MB [E]; thematic indexes, metas and L0 tiles ~0.15 MB [E]; label and display fonts ≤ 160 KB. Then L2 and the event pages. |
| **Story core** | ≤ 3 MiB, reported | previews ~15 KB × beats; climate years ~110 KB each per variable; spread fields as built (0.1-0.4 MB each); routes ≤ 100 KB; each snapshot's index (~5 KB) and meta (5-40 KB [E]); audio samples ≤ `audioEncodedMax`. Tambora ≈ 1.3 MB [D]. |
| **Critical set per beat** | reported above (median flight 1.7 s + `holdMax`) × the floor bandwidth: 2.0 MB at 5 Mbps (the floor is owner decision 5) | model, full: median 0.8 / p90 1.9 / max 2.2 MB; lite: 0.32 / 0.8 / 0.98 [model, planning tile sizes], +30% on mountains. At the floor, beats above it land on ancestors. |
| **New bytes per beat** | reported above 8 MiB | model, full: median 2.2 / p90 5.0 / max 6.3 MB; lite: 1.1 / 2.1 / 2.4 [model]. Mountain tiles run ~30% over the mean, so p90 ≈ 6.5 MB [D from `alt/gebco_tiles.json`]. Plus overlays 0.05-0.4 MB and the card 0.11-0.18 MB. |
| **Per story** | reported above 35 MiB (full) / 18 MiB (lite) | model tiles 15.8-23.3 MB full, 7.5-11.3 MB lite [model], ×1.3 for mountains; images ~1.2 MB; audio ≤ 0.32 MiB; overlays and effects 0.5-2 MB. Worst case 33.8 / 18.2 MB [D]. |
| **Reading pace** | the next beat hides behind reading | a beat takes at least 15 s to read, so the full next beat needs 1.2 Mbps at the median and 3.4 Mbps at the maximum [D] |
| **GPU** | full ≤ **320 MiB**, lite ≤ **192 MiB** | full at render scale 1.0: surface 89 + overlay 21 + previews 7 + climate 12 + effects ≤ 8 + noise/LUT/indirection/draw-index ~2 + labels ~4 + instrument/env ~30 + framebuffers ~35 (HDR input + depth, bloom, SMAA, output; no MSAA) + shadow 16 ≈ **225**. MSAA 4× would add ~60. Each +0.25 render scale adds ~10-30 MiB of framebuffers, and the governor never passes the cap. lite at 1.25: 56 + 13 + 7 + 12 + 6 + 2 + 4 + 20 + framebuffers ~40 + shadow 4 ≈ **165**. Iris Xe shares system RAM. The spike used 240-280 MiB with no streaming [M]. |
| **CPU** (all threads, incl. audio and decoded images) | full ≤ **256 MiB**, lite ≤ **192 MiB**; main JS heap ≤ 140 MB | main: React/three/app 60-80 [E] + byte cache 16/32 + grids 1.1 + staging ≤ 4; event worker: resident index ≤ 16/24 MiB (paged, 5.3) + ~8 working; decode workers 2 × ≤ 16; decoded audio ≤ `audioDecodedMax`; decoded cards ~13. Totals at the upper estimates ≈ 180 (lite) and 200 (full) [D]. E5 records the decoded MiB. The spike measured 451-459 MB [M]. |
| **Frame time** | gates: p95 ≤ **22.2 ms** presented at 1440×900 on the target machines (full and lite tiers; see the hardware note in 8.2), all layers on; no rAF gap over 2× the refresh interval during flights; no task over 50 ms while animating | Tasks over 8 ms are investigated. Allocation guesses, not gates: main thread R3F/React ≤ 2 ms, lod + scheduler + instances ≤ 1, uploads ~1, event-label placement ≤ 0.5, UI ≤ 1.5; GPU [E] globe with overlays and climate ≤ 8, instrument ≤ 3, effects ≤ 2, post ≤ 3, uploads ~1. CPU and GPU overlap, so the presented frame is the measure. |
| **Scrubbing** | uniforms + a worker query at ≤ `eventQueryHz` | at most one climate year (12 × 18 KB) uploaded per frame; border previews crossfade with no fetch |

---

## 7. Build pipeline

### 7.1 Stages, in order

`uv run prebuild [--profile global|region|fixture] [--jobs N] [stage …]` runs the named stages, or,
when none is named, every prebuild stage from `fetch` to `minerals` in the order below except
`excerpts`. `excerpts` and `media` run only when named: `excerpts` because it rewrites committed
files, and `media` because it builds one story, named with `--story <id>`. A bare run builds the
global profile (owner decision 17). Each profile has its own output root: `build/out/` for global,
`build/region/` for the milestone-1 bake (8.1) and `build/fixture/` for the fixture (7.3);
`publish-data` takes the same `--profile` (4.3). The fixture profile skips `fetch` and `excerpts`,
so it needs no raw data. `--jobs` defaults to min(8, CPUs), with spawn-context worker processes.
`media` also takes `--offline`.

| Stage | Input → output | Expected runtime | Where |
|---|---|---|---|
| `fetch` | `pipeline/sources.toml` (owner decisions 10 and 11): per source, keyed by its raw-data manifest id, the manifest's fields plus a version or commit, and per file its `path`, `bytes`, `sha256` and `source_url` (a file without one is verify-only: checked, never downloaded); an `unzipped` table pins the GEBCO `.nc` beside its zip. It holds GEBCO_2026 (zip, `.nc` and PDFs) and NE 10m land, minor islands, lakes and rivers from the NE 5.1.2 release path; later issues add the inputs their stages read → downloads what is missing into `$WANDER_DATA/sources/<id>/`, unzips GEBCO beside its zip, and verifies every sha256 | minutes (network) | local |
| `excerpts` | verified sources → ≤ 3 MB committed excerpts (7.3) | minutes | local |
| `coverage` | GEBCO + NE land and minor islands (owner decision 12) + `pipeline/config/l7.yaml` (`[{name, lon, lat, radiusKm: {L: km}}]`), plus `regions-milestone1.yaml` in the same form (region profile, owner decision 16) or `fixture.yaml` (fixture profile, 7.3) → the 1', 4' and 16' overviews (cached in `build/cache/gebco/<sha16>/`, the first 16 hex characters of the `.nc`'s sha256 pinned in `sources.toml`), L5-L7 availability, qLand and c200 per level, tile counts | minutes [E] | local |
| `surface` | GEBCO_2026.nc (`elevation` int16 43200×86400; 7,466,018,396 B, unzips in 36 s [M]) + NE → `.wst` + `bounds.bin` | ~15-20 min in one process, ~3-5 min with 8 [E], extrapolated from a 55 ms ETOPO proxy tile [M `work/critic-simplicity/tiletime.out`]; the first bake measures it | local |
| `borders` | 54 `world_*.geojson` → `.wot`, index and meta per snapshot + previews | ~5-15 s per snapshot [E; an 8192×4096 id raster took 1.0 s, M] | local |
| `thematic` | RESOLVE, USGS petroleum, the 42 ranges → `.wot` + index + meta | RESOLVE `make_valid` 36 s + `coverage_simplify` 14 s [M]; rasterize + EDT ~2-5 min per layer [E] | local |
| `labels` | curated names + polity names from borders → `lb/*.json` and the fontTools `.woff` subset. Fails if any code point in any label or polity name (spaces and punctuation included) is missing from the subset. | seconds | local |
| `events` | pinned exports in `pipeline/queries/` → `.wev` + details | build < 1 min [E] | local |
| `modera` | two ~520 MB NetCDFs → 1,176 year files + annual; reports the largest step | ~2-5 min [E] | local |
| `fx`, `minerals` | story GeoJSON, USGS points | seconds | local |
| `media --story <id>` | Commons files by name + sha1, crop, AVIF 256w and 1024w + JPEG 1024w; mono AAC with loop points; focal resolution and Meanwhile lists against the current events build → `img/` and `aud/` in the profile's output root + the committed lock. `--offline` reads committed fixture sources instead. | minutes per story | local |
| `npm run poster` | Playwright renders the lobby at 1440×900 → `app/src/generated/poster.avif` (≤ 40 KB), committed and inlined by a Vite plugin. The lobby camera frames the instrument to the viewport height, and the poster uses `object-fit: cover` with the same center. | seconds | local |
| `npm run publish-data` | stage records → `release.json`; uploads, publish check, warm (4.3) | minutes | local |
| `npm run stories` | `story.md` + lock + `release.json` → bundled JSON + article pages | seconds | CI and dev |

- **`npm run stories` fails** with "run `uv run prebuild media --story <id>`" when the Markdown
  references something the lock lacks, or when `lock.eventsVer` differs from `release.events.ver`. It
  warns when a beat is more than `borderWarnYears` from its snapshot, when a beat has
  `viewKm < l7WarnViewKm` with no L7 region covering its target, when a flight would exceed 4.5 s,
  and on an image under 1024 px or without a license.
- **Sources:** stages check only the byte size of each source they read, which catches a missing or
  truncated file; `fetch` alone computes sha256, because hashing the 7.47 GB `.nc` again in every
  stage would only repeat the check `fetch` makes. GEBCO is credited with the citation its
  documentation gives.
- **Availability** (`coverage`): L0-L4 everywhere; L5-L6 on land or shelf, and for the region
  profile only inside its regions; L7 inside `l7.yaml` regions, also on land or shelf. The fixture
  profile takes the tiles `fixture.yaml` lists. Availability is built top down, so L6 and L7 need
  their parent, and asserted closed upward. A tile is in a region when one of its 33² mesh corners
  lies within the region's radius for that level, or the region's center lies in the tile.
- **Python stack:** the surface core runs on Python 3.14.6 with numpy, netCDF4, PyYAML, shapely,
  pyogrio and scipy, pinned exactly in `uv.lock` (owner decision 14). xarray arrives with `modera`,
  and each later stage pins what it adds, such as fontTools for `labels`.
- **Incremental builds:** each stage is deterministic: sorted iteration, gzip level 9 with mtime 0,
  and libraries pinned in `uv.lock`. A layer's version is a hash of its output bytes (`<ver8>`,
  section 3), so an unchanged layer reproduces its version and uploads nothing. A story text edit
  needs only CI.

### 7.2 Stage records

Every stage writes its profile's output root in the exact R2 key layout, plus a record at
`build/stages/<profile>/<stage>.json`, outside the tree `publish-data` uploads, so records never
become R2 keys. `fetch`, `excerpts` and `media` write no record: `media` lists what it wrote in the
committed lock (3.9), which `npm run stories` reads, and `release.json` has no media section.

| Stage | Record |
|---|---|
| coverage | `{qLand[L], c200[L], counts[L], avail, inputs}` |
| surface | `{ver, maxLevel, avail, bounds}` |
| borders | `{stems[], years[], ver{stem}, previews, bytes{stem: {index, meta}}}` |
| thematic | `{layer: {ver, maxLevel}}` |
| labels | `{labels, font}` |
| events | `{ver, overview, files[{key, t0, t1, rows, bytes}]}` |
| modera | `{ver, years, lat[96], lon0, dlon, bytes{variable: {year}}}` |
| fx | `{name: {key, kind, epochDay, bbox, w, h, bytes}}` |
| minerals | `{key}` |

- **Freshness:** the coverage record's `inputs` hold the pinned source hashes and `code`, a tree hash
  of `pipeline/src`, `pipeline/config`, `pipeline/pyproject.toml`, `pipeline/uv.lock` and
  `shared/constants.json`. `surface` refuses to run when those inputs have changed since coverage
  ran. The fixture build also writes `build/stages/fixture/stamp.json`, a hash over the same paths
  plus `pipeline/tests/data`, which the Vitest fixture loader checks (7.3).

### 7.3 Fixture, dev and CI

- **Excerpts** (committed, ≤ 3 MB, `pipeline/tests/data/`): GEBCO source pyramids at Sumbawa (an
  L2-L7 chain: 4' over L2-L3, 1' over L4-L5, 15" over L6-L7) and at the Kirkuk corner, where three
  faces meet (4' over L3-L4, 1' over L5-L6, 15" over L7; owner decision 15); the 0.5° global grid;
  NE land polygons (tiered), minor islands, lakes and rivers; borders 1815 and 1878; an ecoregion
  sample; ModE-RA mean for 1815-07 to 1816-06 (crossing a year boundary) and 2 months of spread, as
  float32; 200 events covering deep time (−15 Myr), BCE, prehistoric, year-precision, parent/child
  and inherited-location cases; and a 3-beat mini story in `stories/_fixture/` (laid out as in 3.9)
  with one small public-domain JPEG, one CC0 WAV, a route and a spread field. The surface excerpts
  take about 1.8 MB [E]. Rasters are int16 gzip and vectors gzipped WKB, each with a JSON sidecar;
  FlatGeobuf output is not deterministic.
- **Fixture sources and tiles:** `pipeline/config/fixture.yaml` gives the fixture its own source
  per level and window: L0-L1 and the Kirkuk L2 tiles from the 0.5° grid, and the pyramids above
  elsewhere. Only the sources differ from 3.1's rule; the real encoder runs. It lists 55 tiles: all
  of L0-L1, the Sumbawa chain `2/1/3/1` to `7/1/103/50` plus its L7 neighbor `7/1/102/50`, and the
  18 Kirkuk corner tiles (faces 0, 1 and 4 at L2-L7).
- **Fixture build:** `uv run prebuild --profile fixture` writes `build/fixture/` in the R2 layout,
  its stage records in `build/stages/fixture/`, and test sidecars (expected values and the cube
  samples, 3.0 item 9) in `build/stages/fixture/expect/`.
  `uv run prebuild --profile fixture media --story _fixture --offline` writes
  `stories/_fixture/story.lock.json` and touches neither Commons nor R2.
  `npm run publish-data -- --profile fixture` writes `app/src/generated/release.fixture.json`
  (dataHost `http://127.0.0.1:8791`) and uploads nothing.
- **Release selection:** the app imports the release through a Vite alias chosen by
  `WANDER_RELEASE=fixture|prod`, and `npm run stories` compiles against the same release.
- **Dev:** `npm ci && npm run dev` runs against production data (CORS `*`), so a fresh clone needs no
  download. `npm run dev:fixture` builds the fixture and serves `build/fixture` on :8791 with production
  headers.
- **CI** (GitHub Actions, Linux, per PR; `.github/workflows/ci.yml`):
  1. Lint: `ruff check` and `ruff format --check` in `pipeline/`; ESLint and Prettier in `app/`.
  2. `uv run pytest` on the excerpts, plus a synthetic global `.nc` through the production GEBCO
     reader.
  3. The fixture build above, using the real encoders. The app job installs uv after `npm ci`, runs
     `uv sync --locked` in `pipeline/`, then `npm run fixture` before Vitest, so no test compares
     against a hash computed on another machine; the pipeline and app jobs stay parallel. A Vitest
     suite that needs `build/fixture` fails, naming `npm run fixture`, when the fixture is missing
     or its stamp (7.2) is stale; none is skipped.
  4. **Vitest:**
     - fixture decode: the Tambora summit is within qLand; the shore sign is right at known points; cube
       keys round-trip; `cube.ts` matches the Python samples (3.0 item 9)
     - within a face, mip 0-2 border texels equal the neighbor's interior bit for bit; across face
       edges (all of L0-L1 and the cube-corner fixture), edge profiles are bit-identical, the border
       texel k columns past a face edge maps into the neighbor's texel column k (the perpendicular
       coordinate is continuous), and each border code lies within the neighbor face's 3×3 code
       range around the mapped point, widened by 2 codes plus half its width, and to 0 where the
       coastal clamp reaches the border texel. The grids meet at an angle, so their texels cover
       different ground, and a high or low inside one texel can fall outside the 3×3 range. In the
       fixture, whose Kirkuk sources are coarser than the texels at L3 and L5-L6, 39 of 110,592
       border texels miss the range ±2 codes, by up to 14 codes where it spans 153 [M, fixture
       bake].
     - pure logic: `lod.ts` (balancing, edge flags), the scheduler (fake clock, network shim), the flight
       time-warp, the event query and page residency, date conversion including the −15 Myr row, and the
       snapshot rule (on 50-07-01 CE the tie goes to `bc1`)
  5. Compile the stories, then build the app.
  6. **Playwright** (`npm run e2e`): Chromium with `--use-angle=swiftshader --enable-unsafe-swiftshader`,
     ~960×600, lite tier; the production build under `vite preview` on :4173 and `build/fixture` on
     :8791 with production headers. It checks: the one-frame render smoke test (8.1 step 0); zero
     key-check magenta at each beat once ready; no new program after the lobby; landing at desired−1 or
     finer, no hold over `holdMax`, and fetched object counts per beat within 10% of the plan (bytes
     reported); an injected 3 s stall still lands; a seam depth scan; in-place context-loss restore
     decoding from the byte cache with the network blocked, and a reload with `?s&b` landing on the
     Continue plate; no request to the Pages origin after boot; each L0 URL fetched once (the preload is
     used); every label renders; reduced motion, the article page and the no-WebGL2 redirect; and the
     pool smoke test (5.5). The pool test runs a test-only page on the Vite dev server (with
     `optimizeDeps.include: ['three']`), not the production build, so nothing of it reaches the
     bundle.
  7. On `main`, HEAD `rel/<id>.json` on the data host, then deploy the tested build to Pages.
- **Bake check (local):** `npm run verify:bake` decodes every tile in `build/region/` and checks
  within-face border identity, edge-profile identity within faces and across face edges, each
  header's codeMin and codeMax, `bounds.bin` and availability against the files present. It covers
  what the fixture never exercises: the overviews, global reads with the longitude wrap and pole
  clamp, full NE data, and owner-frame rasters on real face edges.
- **GPU matrix (local):** `npm run e2e:gpu` on the target machines, against production data. It
  starts as one local Playwright project, `gpu-chromium` (Chromium on Metal), and grows into the
  matrix as WebKit and Firefox projects join. It runs when renderer, streaming or format code
  changes, and at milestone releases; results go in the PR description. It covers frame p95 across
  every story walk; seams at Sumbawa, the Strait of Magellan, Florence, the Sierra Nevada, the Kirkuk
  corner and a pole; and throttled walks at 10 Mbps / 60 ms and 5 Mbps / 150 ms through the app's
  fetch shim (`?net=…`, dev and test builds only). The 30-minute soak runs in E1, and again only if
  the governor changes.

---

## 8. Milestone 1 and experiments

### 8.1 Milestone 1: a Tambora slice deployed end to end

0. **Infrastructure (E4 setup):** the bucket, custom domain, Cache Rule, Transform Rule, Smart Tiered
   Cache and HTTP/3, plus a placeholder Pages project with `404.html`. This starts E4's 7-day clock. Set
   up the repo, the uv and npm projects, `shared/constants.json`, `app/src/config/tunables.ts`, and an
   Actions CI that runs lint, Vitest and a one-frame SwiftShader smoke test, then deploys the
   placeholder.
1. **Surface core:** `sources.toml` and `fetch`; `cube.py` and `cube.ts` with the cross-check; the
   `.wst` encoder; the `excerpts` and `coverage` stages and the fixture;
   `uv run prebuild --profile region`, which builds L0-L4 globally from GEBCO plus L5-L6 inside
   `pipeline/config/regions-milestone1.yaml` (the tiles the Tambora beats refine to at the full tier,
   with separate L5 and L6 radii, and the Kirkuk corner; owner decision 16) and L7 inside `l7.yaml`
   (Sumbawa, 118.0°E 8.25°S, 150 km); the decode worker; `gpuPool.ts` with its pool smoke test.
2. **E1 and E2** on that set, with synthetic overlay, climate and spread textures in the production
   formats (random ids, noise fields), so neither waits for those pipelines. They decide material (a) or
   (b), the lite tap count, the seam rules, the AA method and the planning tile size, and give the owner
   a zoom-floor look.
3. **Globe runtime:** `lod.ts`, the scheduler, the byte cache, the instanced globe, and the lobby with
   its poster and precompile.
4. **Data stages:** borders (all 54 snapshots and previews), labels, modera, events (run E5 here), and
   fx for Tambora.
5. **Story:** the story compiler, media, the Tambora story (owner decision 7), the director and flights,
   and audio (UI synthesis and the Tambora bed).
6. **Publish:** `publish-data`, `release.json` and the Pages deploy. E3 on the real hostname is
   milestone 1's acceptance test.

After milestone 1: E6 with the other thematic layers, the global L5-L6 bake, then the other four stories.

### 8.2 Experiments

**Hardware note (owner decision 8, 2026-09-24).** Until lower-end hardware is available, the target
machines are the development MacBook Pro (Apple M5): run each check at 1440×900 with the full tier,
then again with the lite tier forced as a rough low-end proxy. Rerun E1-E3 on an M1-class Mac and an
Intel Iris Xe laptop before launch. "The target machines" below means these two runs until then.

**E1. Surface shader cost, on the target machines, with a real GEBCO Sumbawa patch.**
- **Setup:** port `surface.js` to the `onBeforeCompile` material. Render the same cameras, lights and
  geometry with three materials:
  - (a) normals from height (5 taps + bicubic; 3 taps on lite)
  - (b) height plus an RG8 slope texture rendered at upload
  - (c) baked normals, as a reference

  Views: the whole instrument, 1,500 km, Sumbawa at 300 km, and close looks at 100, 50 and 30 km for the
  zoom floor, each with all layers off and then all on (borders, three thematic layers, climate, spread,
  labels).
- **Measure:** presented-frame p95; GPU time (timer query in Chrome); compile time, and whether ANGLE
  flattens uniform branches; first-touch and resize hitches; a 30-minute soak; SMAA, FXAA and MSAA cost
  and memory; troika atlas time. Also: gzip-9 and zstd-19 sizes of real cube tiles including the water
  channel (this sets the planning tile size); `.wst` decode time on the target machines; and
  `requestIdleCallback` and `scheduler.postTask` in shipping Safari. The Windows checks (compile time on
  ANGLE D3D11 and in Firefox, and `KHR_parallel_shader_compile` in Firefox) wait for the Iris Xe laptop
  in the pre-launch rerun.
- **Pass:** the intended look, judged against the spike's shots, and p95 ≤ 22.2 ms at 1440×900 with
  all layers on, on the target machines. Compiles stay hidden behind the poster.
- **If it fails:** ship material (b). If ANGLE flattens uniform branches, precompile variants and choose
  one in the lobby. If a compile takes more than ~1 s, draw a small lobby program until the full one is
  ready. Lite then drops bicubic, then plume particles, then shadow refresh.

**E2. LOD seams and the pool path across a cube edge.**
- **Setup:** the three tiles meeting at the Kirkuk corner (3.0 item 2) with three source levels, the
  pool recipe (5.5) and the seam rules (5.6), plus an L7 cell at Sumbawa for the attachment check.
- **Script:** delayed children, mixed neighbor densities, reverse zoom, exaggeration ×8 and ×16, and
  layer toggles while moving, at 300 km and 30 km views (30 km may need a debug override of the zoom
  floor).
- **Measure:** key-check magenta; exposed skirt walls; the screen offset of child vertices at morph
  start against the coarse mesh; depth and normal discontinuity along edges; attached geometry on the L7
  cell; per-slot upload time and `gl.getError()` in Chrome, Safari and Firefox on the target machines.
- **Pass:** zero magenta and no skirt walls; morph-start offset < 0.1 px; depth discontinuity < 0.5 px;
  normals within ~2°; attached geometry on the drawn surface; uploads fit the admission caps.
- **If it fails:** fix edge ownership and morphing before any bake. If per-mip `copyTextureToTexture`
  fails or is slow on WebKit, use per-tile `DataTexture`s with precomputed mipmaps (three allocates
  `texStorage2D` levels from `mipmaps.length`), one draw per tile, and the CPU `heightAt()` for attached
  geometry.

**E3. Story readiness under hostile interaction, across a deploy, on the real hostname (milestone 1
acceptance).**
- **Setup:** a three-beat story, Sumbawa → Europe → California, with previews, a card, ModE-RA
  1815-1816, a spread field, a route and the Tambora bed. Assets are served from
  `wander-data.traviscole.xyz`.
- **Script:** press Next and Back every 200 ms; interrupt and retarget flights; disconnect after entry;
  force `WEBGL_lose_context`; deploy a new release with an old tab open, then visit an unvisited beat in
  that tab; reload with URL state. Run cold at 25 Mbps / 50 ms, then at 5 Mbps / 150 ms.
- **Measure:** also the overlay pool peak with every layer on, at every beat view and during a snapshot
  crossfade (sets the overlay slot count); pool pressure with tilt and exaggeration; the entry bundle
  size; per-beat object counts and bytes; AAC loop seams in each browser.
- **Pass:**
  - essential text, previews and effects are always there, and no optional refinement holds navigation
    beyond `holdMax`
  - camera, time, layers and story position survive context loss
  - the old tab loads its old dependencies, with no Pages request after boot
  - GPU stays within 192/320 MiB and CPU within 192/256 MiB, with tilt
  - the first live frame comes in under 3 s cold at 25/50
  - at 5/150, every landing is on ancestors with no holes
- **If it fails:** grow the story core (for example, with beats 1-2 critical tiles). If the pools
  overflow under tilt, drop N+1 critical to desired−2. Move any fetch that breaks across a deploy to R2.

**E4. Cold-edge retention and fill latency on a low-traffic domain.**
- **Setup:** the infrastructure from 8.1 step 0. Upload 200 × 40 KB gzip-in-file objects under `_e4/`
  and warm them once from the owner's machine. The objects fall into four cohorts of 50, and each is
  read only at its own checkpoint, so an early probe never re-warms a later one
  (`docs/design/measurements/e4/e4.py`).
- **Measure,** from the owner's machine only (owner decision 9): TTFB and `cf-cache-status` at 1 h,
  24 h, 72 h and 7 d, recording local HITs separately from upper-tier fills (by timing or zone
  analytics, since the client sees MISS for both); that HTTP/3 negotiates, bodies are byte-exact, and
  CORS and Content-Type are right; HTTP-cache revisits in Chrome, Firefox and Safari; Class B charges on
  HITs in the R2 metrics.
- **Break point:** a beat's largest critical set is ~2.2 MB, about 48 tiles of ~45 KB [model]. At 12 in
  flight that is 4 waves, each costing one miss plus ~0.2 s of transfer at 25 Mbps. Four waves fit the
  median flight plus the maximum hold (1.7 + 1.5 = 3.2 s) only while a miss costs under ~0.6 s, so
  ~500 ms per miss is the break point.
- **Pass:** at 72 h and 7 d, the p90 TTFB of warmed objects stays under the break point. Fills for
  visitors in other regions are not measured (owner decision 9).
- **If it fails:**
  - on decay, re-warm the story hot set (~50 MB) every 6-12 h from an Actions cron. The cron needs a
    keep-alive, because GitHub disables schedules in public repos after 60 days without activity [S].
  - if misses from this machine exceed the break point, publish L5-L6 surface tiles as 2×2 quad packs
    (4× fewer requests)

**E5. Event corpus and query cost.**
- **Setup:** build the accepted corpus (all eras) from the pinned exports, and record its rows and
  decoded MiB. This sets the event worker's index cap and whether pages are evicted.
- **Measure:** the full worker query (window, cone, extents, hierarchy, declutter, hysteresis) on both
  target machines, over that corpus and over the 465K-row broad set.
- **Pass:** results reach the main thread within 2 frames (~33 ms) of a camera or ruler change, at no
  more than 0.5 ms of main-thread work per result. Overview decode time is reported.
- **If it fails:** add spatial sub-pages (cube L2 cells) inside the busiest era bins.

**E6. Overlay fidelity at island zoom.**
- **Setup:** bake ecoregions, petroleum, mountains and borders 1815 + 1878 as L0-L5 `.wot`.
- **Measure:** view Sumbawa close and the Sierra Nevada at 300 km; report the bytes per layer.
- **Pass:** the owner accepts the edges and fills by eye.
- **If it fails:** use `maxLevel` 6 (1.22 km) for the failing layer (the indirection is sized by
  `maxLevel`, 3.2), or a finer distance step.

---

## 9. Deferred to v1.1, and the hook v1 leaves

| Deferred | Hook in v1 |
|---|---|
| Explore mode UI | The entry is built but hidden. The streamer, the full event index, the worker query, all toggles, and the monthly and annual climate paths already run in v1. |
| Hover and click on layer features | `.wot` ids are exact, `meta.json` names them, and picking is one `texelFetch` or 1-pixel read at the cursor. |
| Flight-corridor prefetch, N+2, promote-on-hover-Next | The same enqueue API with class and generation; `lod.ts` can plan any camera. |
| Event detail panel (descriptions, sources, alternate dates) | `details/<n>.json` is built and published in v1, just not loaded. |
| Spatial paging of events | Era pages and their file list carry bounds, so cells can be added without changing columns (E5 may pull this into v1). |
| Offline "keep this story" | Immutable URLs, and the byte cache's key list per story. |
| L7 beyond the listed story regions | The availability bitmap, `lod.ts` and the draw-index texture already handle L7. |
| Locator maps in article pages | The compiled JSON has cameras and keys. |
| More stories than fit in the bundle (more than ~10) | Move story JSON to R2 via `publish-data`; the app already fetches everything else from there. |
| R2 clean-up | Keys are never deleted. Revisit at 10 GB with a dry-run script that keeps every key named by a retained `rel/*.json`. |
| Scheduled re-warm | Only if E4 shows decay. |
| WebGPU | The data formats do not depend on the renderer. |

---

## 10. Tunables

Starting values, in `app/src/config/tunables.ts`. "Eye" or "ear" means tuned by looking or listening;
an E-number means that experiment sets it. Paired values are lite / full.

| Name | Start | Controls | Tuned by |
|---|---|---|---|
| `refinePx` | 1.5 / 0.83 CSS px; merge at 0.7× | LOD refinement | fixed: the beat-model profiles; changing them invalidates section 6 |
| `zoomFloorKm` | ~100 km across | closest view | owner decision 1, after E1/E2 |
| `revealHold`, `revealMorph` | 300 ms, 700 ms | still-camera batched reveal | eye, E2 |
| `tileFade` | 250 ms | per-tile crossfade while moving | eye |
| `bevelFade` | 400 ms | L1 coastal bevel fade-in | eye |
| `borderFade`, `borderRest` | 400 ms, 250 ms | snapshot crossfade; ruler rest before detail tiles | eye |
| `borderWarnYears` | 20 | build warning: beat far from its snapshot | author note |
| `l7WarnViewKm` | 400 | build warning: close beat outside L7 regions | author note |
| `eventQueryHz` | 30 | event query rate while moving | E5 |
| `eventMarkers`, `eventLabels` | 80 / 140, 24 / 40 | event detail budget | eye, when explore opens |
| `parentSplitPx`, `parentMergePx` | 150, 120 px | parent → children switch | eye |
| `declutterPerCell` | 2 per 64 px cell | event declutter | eye |
| `hysteresisScore` | 20 on the 0-1000 score scale | margin to displace an incumbent | eye |
| `eventFade` | 300 ms | event fades | eye |
| `meanwhileCount`, `meanwhileMinKm` | 6, 2,000 km, one per macro-region | Meanwhile rule | eye |
| `placeLabelsMax` | 30 | place labels shown | eye |
| `flightDuration` | `clamp(S/1.2, 1.6, 4.5)` s, ρ = 1.42 | flight length | eye |
| `gateAt`, `holdMax` | 0.7 of the flight, 1.5 s | readiness gate and hold | E3, E4 |
| `retargetBlend` | 300 ms | mid-flight retarget | eye |
| `rmDissolve`, `rmHoldMax` | 400 ms, 2.5 s | reduced-motion shutter | eye |
| `hoverQueue` | 150 ms | plaque hover before queueing | eye |
| `titleFontWait` | 1 s | title plate font fallback | eye |
| `inFlight` | 12 total; next + background ≤ 4; background ≥ 1 | fetch concurrency | E3, E4 |
| `queueDrop`, `finishIfReceived` | 300 ms, 70% | cancellation | E3 |
| `stallBytes`, `stallHeaders` | 2.5 s, 4 s | watchdog | E3 stall test |
| `retryDelays`, `degradeFor` | 0.5, 2, 8 s with jitter; 60 s | retries | E3 |
| `motionLodRate` | 1 screen or 1 level per second | request cap at desired−2 | E2, E3 |
| `uploadAnimated`, `uploadIdle` | 256 / 512 KiB, 1 / 2 MiB | upload admission | E1, E2 (idle caps are a guess) |
| `uploadStopMs`, `uploadSlowCall` | ~1 ms, 0.5 ms | early stop | E1, E2 (guess) |
| `slotQuarantine` | 2 frames | slot reuse delay | E2 |
| `lodBiasStep`, `lodBiasRelax` | 0.25; after 5 s below 80% occupancy | pool-pressure LOD bias | E3 |
| `overlaySlots` | 160 / 256 | overlay pool | E3 count, peak + 25% |
| `probeFrames`, `probeGpuMs`, `probeMissFrac` | 120, 12 ms, 10% | lobby tier probe | E1 |
| `governor` | down at > 10% missed vsyncs over 120 animated frames; up after 10 s with GPU p90 < 55% of the interval, or a 30 s probe with no misses; revert if > 5% missed within 5 s, then back off 2 min | render-scale governor | E1 |
| `renderScale` | full 1.0-2.0, lite 0.75-1.25, steps of 0.25, start 1.0 | render scale range | E1 |
| `plumeParticles` | 1,500 / 4,000 | plume count | E1 |
| `restoreTimeout` | 3 s | context-loss restore before reload | E3 |
| `labelSyncTimeout` | 3 s | troika label sync before logging | E1 |
| `climateMonthlySpan`, `climatePrefetchYears` | 20 years, ±2 years | monthly vs annual; prefetch | eye |
| `climateSwitchFade`, `climateRangeK` | 300 ms, ±6 K | switch crossfade; palette saturation | eye |
| `detents` | ≤ 25/s, scheduled 50 ms ahead | scrub detent sounds | ear |
| `loopCrossfade`, `bedCrossfade` | 50 ms, 750 ms | loop joins; bed changes | ear |
| `hideRamp`, `showFade` | 100 ms, 300 ms | tab hide and show audio | ear |
| `audioEncodedMax`, `audioDecodedMax` | 320 KiB per story, 8 MiB at once | sample allowance | ear, after the Tambora bed |

---

## Review notes

Review items not taken as written, one line each:

- **Event date floor at −5 Myr (buildability):** not taken. Float64 t0/t1 costs 8 B per row and leaves
  the content question (deep-time geology) to the owner instead of the storage type; owner decision 2
  settled it.
- **Per-mip `DataArrayTexture` + `addLayerUpdate` fallback (prior merge, from Fable):** removed. It needs
  a full CPU copy of each array (~89 MiB for the surface pool) and takes the samplers to 17 of 16.
- **Media step as `npm run media --offline` (buildability):** applied as `uv run prebuild media
  --story <id> --offline`, because the stated stack puts asset prep in the Python prebuild and media
  needs the events build; full schema validation stays in `npm run stories`.
- **Cut the doc 30-40% (audit):** partly taken. Lineage, the Populations bullet, the KTX2 note,
  restated rules and the Known-unknowns table are gone, but the critical and high buildability fixes
  (cube conventions, seam rules, build contract, fixture, story source, milestone order) and the
  tunables table add more, so the doc grew about 30%.
- **Event density, Meanwhile during break-out, place-label toggles, beat layers on Next/Back, AA method,
  per-story caps, data hostname, milestone 1 surface scope, all 54 snapshots in milestone 1 (raised as
  owner questions):**
  decided in the doc, as technical choices or direct consequences of the owner's rules.
- **Border pins as an open owner question (audit):** not reopened. The owner already chose the nearest
  snapshot with its year shown, so pins are removed; the 20-year build warning stays as an author note.

## Owner decisions

Decided 2026-09-24 (starting values, tunable). The rest of the doc cites these by number.

2. **Deep-time geology:** include only well-known deep-time events (such as the Ries impact at
   −15 Myr), shown in a compressed deep-time segment of the time ruler.
3. **Era and region balance:** equal quotas across era bins and macro-regions for the overview, with
   per-era percentile scores and class weights.
4. **Bathymetry source:** GEBCO contours at Natural Earth's depth intervals; the legend credits both.
5. **"Normal broadband":** 25 Mbps / 50 ms with a cold cache for the 3 s bar; beats still land within
   the hold at 5 Mbps.
6. **Border license:** derived border tiles are published as GPL-3.0 with the license, source commit
   and build script linked.
7. **Tambora beat list:** start from the 8 drafted beats in
   `docs/design/measurements/work/story-first/beats.py` (issue #10).
8. **Target hardware:** the development MacBook Pro for now (hardware note in 8.2).
9. **E4 scope:** measure cache retention from the owner's machine only; no checks from other regions.

Decided for the surface core (issue #3), 2026-09-24 and 2026-09-25:

10. **Raw-data root:** the prebuild reads `$WANDER_DATA`, falling back to `~/projects/wander-data`,
    and `fetch` downloads missing inputs into `$WANDER_DATA/sources/<id>/`.
11. **Source registry:** `pipeline/sources.toml` pins each input, keyed by the raw-data manifest's
    ids and using its field names. It holds the surface core's inputs; each later issue pins the
    inputs its stages read. The folder's `manifest.json` and README list its files, including the
    unzipped GEBCO files and, once fetched, the minor-islands zip; the build reads neither.
12. **Minor islands:** Natural Earth 10m minor islands count as land, for L5-L6 coverage and in the
    shore field.
13. **Water set:** natural lakes, plus an allowlist of natural lakes whose level dams or control
    structures later raised, lowered or regulated. Canals and the other reservoirs are dropped; a
    dropped reservoir's river centerline still draws.
14. **Python stack:** Python 3.14 with numpy, netCDF4, PyYAML, shapely, pyogrio and scipy, pinned in
    `uv.lock`. xarray arrives with the `modera` stage.
15. **Fixture at the Kirkuk corner:** a mid pyramid (4' for L3-L4, 1' for L5-L6, 15" for L7), so
    cross-face seams are tested on real terrain at L3-L7.
16. **Milestone-1 region:** L5-L6 only where the Tambora beats refine at the full tier and at the
    Kirkuk corner, with separate L5 and L6 radii, rather than across the beats' whole views.
17. **Default profile:** a bare `uv run prebuild` builds the global profile into `build/out/`.

Still open:

1. **Zoom floor** for stories and explore (start ~100 km; compare 100/50/30 km in E1/E2).
