Issue #55: CPU memory handoff, 28 September 2026

The branch adds an account and four independent trims. The renderer's 256 MiB gate remains
unmeasured on this branch: the sandbox cannot launch Chromium or bind a local server. The figures
below are retained payload sizes computed by the account and exercised in Node tests, not a new
renderer footprint result. Section 6 and E3's design entry are unchanged for Claude to update after
measurement.

The checkpoints, in order:

| Commit | Change | Account saving after upload |
| --- | --- | --- |
| `49df829` | Account only; E3 handles local URL queries and the local release | Baseline, no trims |
| `696a0a6` | Release the 1815 field after its sixth face uploads | 25,165,840 ArrayBuffer bytes |
| `ddd26ce` | Release static canvas backing stores after texture upload | 39,518,208 estimated RGBA pixel bytes |
| `816a991` | Release immutable instrument attributes after buffer upload | 6,720,512 ArrayBuffer bytes |
| `3955126` | Release the sea-name and puff atlases after texture upload | 65,536 ArrayBuffer bytes plus the actual `labels.seaAtlas` byte count |

**Reading the account.** On an exact loopback hostname (`localhost`, `127.0.0.1`, `[::1]`),
`?memory=1` dynamically loads the account and installs `window.__wanderMemory()`. Without that
query, or on any public hostname, there is no hook or account module loaded. Inspection methods do
no work unless called; there are no frame-loop probes, observers, patched constructors or retained
resource registries. The hook's disposer removes it when the walk ends.

Each call returns numeric `owners`, category `totals`, and `details`. Typed views count their
entire backing buffer once by identity, including unused prefixes. Shared attributes, material
maps, texture sources and audio buffers are deduplicated. `details.renderer` copies
`renderer.info.memory`, its most recent render counters, its program count and pixel ratio. The
render counters are three's last render, not a sum of all composer passes. `details.pool.*` gives
dimensions, levels, slots and GPU bytes; GPU-process footprint is still outside this CPU task.

`arrayBuffers` is an exact count of the enumerated retained allocations. `audioSamples` counts
channels × samples × 4 without calling `getChannelData`, which could itself materialize another
copy. The browser may store acquired audio samples in different allocator categories or copies.
`canvasPixels` and `imagePixels` are width × height × 4 estimates, not malloc measurements. Fonts
report loaded faces and available encoded Resource Timing sizes; decoded font and glyph-cache
bytes are explicitly unknown. Attached cards use their locked file's pixel dimensions, since
`srcset` can density-correct `naturalWidth`. Detached image-cache residency is also unknown.

The account identifies the 24 MiB border array, 6.41 MiB of instrument arrays, the atlas and cached
audio samples as large ArrayBuffer candidates. The 37.69 MiB of canvas pixels is the largest native
allocation candidate against the roughly 67 MiB malloc dump. Audio acquisition, decoded cards,
fonts and Skia caches can contribute there too. This is an attribution to test against E3, not a
claim that browser caches or allocator partitions map one-to-one to the account. Allocator slack,
JS object overhead, GL command/transfer buffers and browser internals remain outside it.

**Before and after by owner.** These are settled sizes for the same resources; transient queues,
sample-rate-dependent audio and browser-dependent atlas/font/image sizes come from the paired E3
accounts. Zero means no CPU source retained by the owner, not zero GPU storage.

| Owner | Before, bytes | After, bytes | Reason |
| --- | ---: | ---: | --- |
| `borders.1815` | 25,165,840 | 0 | Six 2048² R8 faces and the 16-byte WBF1 header backing their subarray; release in the final upload callback |
| `instrument.geometry` | 6,720,512 | 0 | Immutable attributes; culling bounds cached before release; attribute counts/types and GPU buffers stay intact |
| `instrument.textures` (canvas estimate) | 36,700,160 | 0 | Two 2048² engravings and three 512² roughness maps; reset canvases after upload |
| `room.backdrop` (canvas estimate) | 2,621,440 | 0 | Static 1024 × 640 canvas |
| `effects.textures` (canvas estimate) | 131,072 | 0 | Two 128² ember maps |
| `lobby.textures` (canvas estimate) | 65,536 | 0 | One 128² glow map, while the lobby owns it |
| Puff atlas, in `effects.textures.arrayBuffers` | 65,536 | 0 | Immutable 128² RGBA atlas; the veil in that same row is retained |
| `labels.seaAtlas` | 2048 × lettered height | 0 | Exact baseline row supplies the height-dependent backing size; GPU mip chain unchanged |
| `surface.gridAndInstances` | 86,662 | 86,662 | 65,536 instance bytes plus the shared tile grid; instances are updated on repack |
| `surface.availability` (global release) | 16,384 | 16,384 | Used by selection and camera clearance |
| `climate.year.1815`, `.1816`, `.1817`, each | 221,392 | 221,392 | Each 221,296-byte inflated year plus two 48-byte scale/offset copies; re-read when time blends months |
| `climate.blendScratch` | 73,728 | 73,728 | CPU monthly blend |
| `climate.uploadField` | 73,728 | 73,728 | RG16F upload array, rewritten with each blend |
| `effects.plumeArrays` | 171,600 | 171,600 | Live puff positions, attributes and sorting scratch |
| Veil field, in `effects.textures.arrayBuffers` | 16,384 | 16,384 | Story time rebakes its red channel while retaining its streak channel |
| Each pool's `.cpuMirror` and `.staging` | 0 when idle | 0 when idle | Pools allocate GPU storage without full CPU mirrors; staging already drops each tile view after the copy |
| `surface.uploadQueue`, `.waitingTiles`, `.decodeReady` | Variable, normally 0 settled | Same | Not-yet-uploaded data; sample worker/fetch counts alongside these rows |
| `audio.noise.*`, `audio.activeCueBuffers` | Sample-rate/cue dependent | Same | Cached reusable noise and active grain loops; one logical buffer counted once |
| `cards.attached` | Selected file size | Same | The displayed card; browser cache retention is not exposed |
| Fonts, in `details.fonts` | Encoded sizes; decoded unknown | Same | Required faces and native glyph caches |

Fixed typed-array reduction: **31,951,888 bytes (30.47 MiB), plus the sea-name atlas**. Fixed canvas
pixel reduction: **39,518,208 estimated bytes (37.69 MiB)**. The sum is a payload estimate, not an
expected exact footprint delta. The instrument snapshot test constructs the real hardware with a
stub rasterizer and measures its actual arrays and canvas dimensions. The fixed grid/climate
figures were also computed from the actual constructors; all three global climate files were read
from the linked bake without changing it.

**Copies kept and other trims considered.** Surface pool slot counts remain 256, with height and
shore/water at 46,835,712 GPU bytes each and edges at 3,158,016, totaling 96,829,440. Pool sizes,
pixel ratio, MSAA, selection and tiles drawn are unchanged. The shared surface grid is only 21,126
bytes, and the 2048-instance capacity is kept for repacks. Pending decoded tiles, compressed bytes
in transit, and partially uploaded jobs are necessary until consumption; milestone 1 has no
persistent byte cache or resident 33² CPU height grids. Workers transfer their buffers and keep no
tile cache. The inspection marks worker/fetch counts because their in-progress working sets are
not observable from the main thread.

Climate years, their scratch field, the climate upload array, the mutable veil and the plume's
dynamic attributes/sort arrays remain. Repeated walks and scrubbing read them again. Audio is
unchanged to preserve its loops and cues; reducing cached noise would change regeneration work
and possibly the sound. DOM image and font caches belong to the browser; reducing resolution or
faces would change the page. The much smaller effect meshes and shared tile grid retain their
attributes to keep the geometry trim scoped to the large, wholly immutable instrument.

The only new policy choice is the explicit loopback `?memory=1` switch and on-demand sampling.
Release timing follows owner decision 21: a lost context reloads the page, so static sources are
not retained for in-place restore. The instrumentation distinguishes measured byte lengths,
native pixel estimates and unobservable allocations instead of assigning a guessed malloc total.

**Run the measurements on the Mac.** Build each checkpoint being compared, using a distinct
`measure_name` (start with `cpu-55-before` at `49df829`, then `cpu-55-after` at the branch tip).
This sequence runs in a subshell, chooses a free preview port, serves the production build, starts
the global data server on :8793 if one is not already serving there, and cleans up its servers.
The data server reads the linked global bake; it does not rebuild or publish it.

```sh
(
  set -eu
  cd /Users/travcole/projects/wander-cx-memory/app
  measure_name=cpu-55-after
  measure_dir="../build/m1/cpu-55/$measure_name"
  mkdir -p "$measure_dir"
  npm run build
  measure_port="$(node --input-type=module <<'JS'
import { createServer } from 'node:net';
const server = createServer();
server.listen(0, '127.0.0.1', () => {
  console.log(server.address().port);
  server.close();
});
JS
  )"
  npm run preview -- --host 127.0.0.1 --port "$measure_port" --strictPort \
    >"$measure_dir/preview.log" 2>&1 &
  measure_preview_pid=$!
  measure_data_pid=
  cleanup_measurement() {
    kill "$measure_preview_pid" 2>/dev/null || true
    if [ -n "$measure_data_pid" ]; then kill "$measure_data_pid" 2>/dev/null || true; fi
  }
  trap cleanup_measurement EXIT
  if ! curl -fsS http://127.0.0.1:8793/release.json >/dev/null 2>&1; then
    npm run data -- --profile global >"$measure_dir/data.log" 2>&1 &
    measure_data_pid=$!
  fi
  measure_url="http://127.0.0.1:$measure_port/"
  for attempt in {1..100}; do
    if curl -fsS "$measure_url" >/dev/null 2>&1 && \
       curl -fsS http://127.0.0.1:8793/release.json >/dev/null 2>&1; then break; fi
    sleep 0.2
  done
  curl -fsS "$measure_url" >/dev/null
  curl -fsS http://127.0.0.1:8793/release.json >/dev/null
  node scripts/e3.ts --url "${measure_url}?data=global" --only leak --walks 3 \
    --name "$measure_name" --out "$measure_dir" --results "$measure_dir"
)
```

E3 adds `memory=1` only to loopback leak URLs. Each `leak.samples[]` contains `memoryAccount`
beside the allocator dump; the blank-page sample is null. Accounts run after the dump so their
temporary report allocation cannot inflate that dump. `leak.cpuBudget` checks the 256 MiB line
over the completed walks. Keep the screenshot, console problems, release id and each walk's
footprint with the account. A sample with pending workers/fetches is not a settled account.

To print the final walk's before/after owner rows after both runs, from `app/`:

```sh
node --input-type=module - \
  ../build/m1/cpu-55/cpu-55-before/cpu-55-before.json \
  ../build/m1/cpu-55/cpu-55-after/cpu-55-after.json <<'JS'
import { readFileSync } from 'node:fs';
const samples = process.argv.slice(2).map((path) =>
  JSON.parse(readFileSync(path, 'utf8')).leak.samples.at(-1));
if (samples.some((s) => !s.memoryAccount)) throw new Error('both runs need the loopback account');
const [before, after] = samples.map((s) => s.memoryAccount);
for (const kind of ['arrayBuffers', 'audioSamples', 'canvasPixels', 'imagePixels']) {
  console.log(kind, '(bytes)');
  console.table([...new Set([...Object.keys(before.owners), ...Object.keys(after.owners)])]
    .map((owner) => ({ owner, before: before.owners[owner]?.[kind] ?? 0,
      after: after.owners[owner]?.[kind] ?? 0 }))
    .filter((row) => row.before || row.after)
    .map((row) => ({ ...row, saved: row.before - row.after })));
}
console.table(samples.map((s, i) => ({ version: i ? 'after' : 'before', walks: s.walks,
  rendererMiB: s.rendererMB, ...s.renderer })));
JS
```

For rendering verification, `npm run e2e:gpu -- cpu-memory.spec.ts` checks the real GL upload
callbacks: six border faces read back correctly after the last CPU release; static 2D texture
mips still read correctly; immutable geometry draws correctly twice. It checks zero GL errors and
the account's released bytes. Then run `npm run e2e:gpu` and the usual walk shots to check the
instrument, all beats, return/scrub behavior and unchanged pool slot reuse. These browser checks
have been written and type-checked here but not run in the sandbox.

**Validation here.** Each trim passed lint, build and the non-socket Vitest suite before its
commit. The final such run passed 690 tests in 66 files. `npm test` was attempted in full: its
local-server tests in `scripts/dataServer.test.ts` and `scripts/checkRelease.test.ts` fail to bind
127.0.0.1 with sandbox `EPERM`; no other failures were observed. The passing command was
`npx vitest run --exclude scripts/dataServer.test.ts --exclude scripts/checkRelease.test.ts`.
The final full `npm test` attempt passed 692 tests, with two socket-bind failures and 16 tests
skipped by their failed server setup (710 total).
`uv run pytest` passed 1,218 tests; six `tests/test_fetch.py` setups hit the same socket restriction.
`uv run ruff check .` and `uv run ruff format --check .` passed (59 files). No pipeline or bake
files changed. Run full `npm test` and `uv run pytest` outside the sandbox before landing.

Still needed from Claude: paired local E3 accounts/footprints and the GPU checks. There is no
claim yet that the final renderer is below 256 MiB. One ancillary tooling observation: Vite's
middleware-only SSR loader still tried to bind its WebSocket port despite `hmr: false` during a
Node accounting calculation; the calculation completed, but the sandbox logged `EPERM`. E3 uses
that existing loader too. No unrelated fix was folded into the trims.
