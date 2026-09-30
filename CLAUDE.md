# Wander

A desktop web experience for exploring history on a 3D brass-orrery globe. Read these first:

- `docs/PRD.md`: what we're building and why
- `docs/design/streaming.md`: how assets are built, stored, delivered, and streamed
- `docs/design/globe-language.md`: what the globe shows through time and how: pace layers, their
  channels and materials, and the principles every visible layer, mark and story follows
- `docs/reference/`: the visual target and the three.js prototype that proved the look

## Status

Milestones 1 and 2, the Tambora and Magellan stories, are live at `wander.traviscole.xyz`; E3,
milestone 1's acceptance, passed there on 2026-09-28 except CPU memory, now at its line
(`docs/design/streaming.md` 8.1 lists where it departs from the design, and 8.2 what the
experiments settled). The site opens on the lobby, whose plaques dive into the eight-beat Tambora
walk and the ten-beat Magellan voyage: the global surface bake, ModE-RA's 1816 cold on two of
Tambora's beats, the 1815 borders under their year plate, Magellan's route and ship, engraved sea
names, Meanwhile and the lobby's glows from the all-eras Wikidata index, synthesized sound, and the
Credits panel. The production entry (`app/index.html`, `app/src/main.ts`) plays them from the
bundled release, `app/src/generated/release.json`, whose data is on R2; the dev page
`app/prototype.html?story=tambora|magellan` boots the same walk (`app/src/walk/boot.ts`) under a
tuning panel. Milestone 3, open-world exploration, is live as it grows (`docs/PRD.md`): the
lobby's last plaque, All of History, dives into Explore wherever the release names the event index,
with the free clock over all of history, the now window's events as marks whose plates come on
hover and pin on a click, the opening's line pinned at the landing, a live Meanwhile, the climate
at the clock's date and its own sound; `app/prototype.html` without `?story=` starts in it. The bundled
release names no event index until the event files are published, so until then the live lobby
shows the stories' plaques alone.

## Layout

Paths in the docs are relative to the repo root, except the measurement citations in
`docs/design/streaming.md`, which are relative to `docs/design/measurements/`.

- `app/`: the npm project. TypeScript, Vite and three.js pinned to an exact version (the renderer
  relies on version-specific three.js APIs), with a plain-DOM UI and no React: the approved walk is
  plain three.js, and its bundle is smaller (`docs/design/streaming.md`, owner decision 20).
  Tunables live in `app/src/config/tunables.ts`. The walk's modules live in `app/src/` (`walk/`,
  `lobby/`, `view/`, `stream/`, `look/`, `scene/`, `story/`, the walk's material tokens in
  `story/ui/tokens.css`); `app/src/page/` holds the production page's room, failure plates, data
  override, Credits panel and credits styles; `app/src/prototype/` holds only the dev pages' shells
  and harnesses. The event worker and query modules live in `app/src/events/`.
- `pipeline/`: the uv project for the Python prebuild (`uv run prebuild`, under Commands), which
  turns raw sources into web assets. Its config, queries and test excerpts live under it.
- `shared/constants.json`: magics, sentinels, the layer order and the cube face table, read by
  both projects.
- `stories/<story>/`: one folder per story: `story.md`, `meanwhile.yaml` (Meanwhile's written
  lines) and `story.lock.json`, plus its datasets and audio once a story has them.
- `explore/`: the events Explore opens on, `openings.yaml` (each one's line and source) and its
  `openings.lock.json`.
- `build/`: generated output (git-ignored): the prebuild's roots, one per profile in the R2 key
  layout (`build/out/` for global, `build/region/`, `build/fixture/`), stage records in
  `build/stages/<profile>/` and caches in `build/cache/`; and lab reports in `build/lab/`.
- `docs/`: PRD, design docs, reference images.

## Commands

Run npm commands in `app/` and uv commands in `pipeline/`.

- `npm ci`, then `npm run dev`: the app on Vite's dev server, reading production data from
  `wander-data.traviscole.xyz`. On a page served from loopback, `?data=fixture|region|global` or
  `?data=<origin>` reads a local data server's release instead (`app/src/page/dataOrigin.ts`),
  `?memory=1` installs `window.__wanderMemory()`, the app's account of the CPU memory it keeps,
  by owner (`app/src/perf/memoryHook.ts`), which E3's leak check records beside Chromium's dump,
  and `?opening=Q…` dives into Explore on that opening (`app/src/explore/openings.ts`).
- `npm run lint`: ESLint and Prettier. `npm run format` rewrites formatting.
- `npm run fixture`: the Python fixture build (`uv run prebuild --profile fixture`, so it needs
  uv) into `build/fixture/` and `build/stages/fixture/`: the surface, ModE-RA over Europe for
  1815-1817 and the scored events of those years, from real excerpts. Meanwhile waits for a
  fixture story and lock of its own, and borders stay synthetic. Vitest checks against it and fails,
  naming this command, when it is missing or was built from other pipeline code, shared constants
  or excerpts than the working tree holds.
- `npm run data -- --profile fixture|region|global`: serves `build/fixture/` on :8791,
  `build/region/` on :8792 or `build/out/` on :8793 with R2's headers, plus the build's release at
  `/release.json` (`docs/design/streaming.md` 7.3).
- `npm run check-release`: HEADs the bundled release's `rel/<id>.json` on the data host, then GETs
  its `bounds.bin`, L0 tiles, the climate years the walk starts with, the 1815 border field, each
  story's first image and, when the release names the event files, their overview, and checks R2's
  headers. CI runs it as its own job, which the Pages deploy waits for; it fails, naming
  `npm run publish-data`, until the release's data is uploaded.
- `npm test`: Vitest. `npm run build`: type-check and build `app/dist/`.
- `npm run fixture` and `npm run build`, then `npm run e2e`: Playwright on SwiftShader, as in CI.
  The smoke tests run against that build in `app/dist/` (it does not rebuild), on the fixture's
  data server through `?data=`, its story images answered by the media stage's test image, and
  fail on any request to Wikimedia; the other tests run test-only pages on the Vite dev server,
  reading the fixture from its data server, so none of it reaches the build.
  Run `npx playwright install chromium` once first. CI runs the specs as four parallel shards that
  `app/e2e/shards.ts` names; `WANDER_E2E_SHARD=<shard>` runs one, as its CI job does.
- The same, then `npm run e2e:gpu`: the same tests on this Mac's GPU (Chromium with
  `--use-angle=metal`), local only. It is the start of the GPU matrix
  (`docs/design/streaming.md` 7.3): run it when renderer, streaming or format code changes, and
  put the result in the PR description.
- `npm run lab`: the experiments' lab runs on this Mac: Chromium on Metal through Playwright, and
  the installed Safari and Firefox through lab pages that post their reports to the dev server
  (`build/lab/`). It needs no build; the lab specs that read the region bake start its data server
  and fail, naming the command, when the bake is missing. Local only; it opens a tab in both
  browsers.
- `npm run dev`, then `/prototype-audio.html`: the Sound Cabinet, every sound in `app/src/audio/`
  on one page with its level. Every level lives in `app/src/audio/mix.ts`; Copy settings copies the
  mix as JSON to paste over it. With the dev server up, `node scripts/renderSounds.ts --out <dir>`
  renders every sound to WAV with its peak and RMS.
- `node scripts/walkShots.ts` and `node scripts/lobbyShots.ts --url <dev server> --out <dir>`, with
  the Vite dev server and a data server up: every beat, flights, scrubs and a break-out, and the
  lobby's opening, dive and Credits panel (with a video), on this Mac's GPU at 1440x900, with any
  console errors. Each file's header gives its flags.
- `node scripts/e3.ts --out ../build/m1/e3 --results ../docs/design/measurements/e3/results`: E3,
  milestone 1's acceptance, against the live site in headless Chromium on Metal: cold loads at
  25/50 and 5/150, the throttled walk and its holds, hostile input, offline, context loss, requests
  to Pages and repeated walks for leaks (`docs/design/streaming.md` 8.2). Local only, about 20
  minutes, with nothing else on the GPU.
- `uv sync`, then `uv run pytest`, `uv run ruff check .` and `uv run ruff format --check .`.
- `uv run prebuild [--profile global|region|fixture] [--jobs N] [stage …]`: the prebuild
  (`docs/design/streaming.md` 7.1). A bare run builds the global profile into `build/out/`, taking
  every stage in order except `wikidata`, `excerpts`, `openings`, `media` and `meanwhile`; the
  fixture profile also skips `fetch` and `borders` (its tests draw synthetic snapshots, since the
  GPL source is never committed). It keeps `meanwhile` and `openings` disabled so it cannot
  rewrite their locks.
  `uv run prebuild --profile region` bakes the milestone-1 region into `build/region/` (about
  2.5 min on the M5, plus 50 s for `modera`, which writes all of ModE-RA for the region profile, and
  30 s for `borders`, the whole 1815 field).
- `uv run prebuild media --story <id>`: bakes the story's Commons images, as `story.md` pins and
  crops them, into `img/` in the profile's output root, and writes `stories/<id>/story.lock.json`
  (commit it) with their keys, sizes, credits and licenses (`docs/design/streaming.md` 3.9, 7.1).
  The release names every key the locks name, so `npm run publish-data` uploads them. Each
  profile's root needs its own run: until `uv run prebuild --profile region media --story <id>`,
  the region bake's cards show plates (in the dev shell and `walkShots`) and
  `npm run publish-data -- --profile region` stops, naming the command.
- `uv run prebuild meanwhile --story <id>`, after `events`: picks Meanwhile's three entries for
  each beat and each month of the story's years from `ev/events.tsv.gz`, joins the lines written
  in `stories/<id>/meanwhile.yaml`, and writes them with the lobby's glows into
  `stories/<id>/story.lock.json` (commit it), keeping the media stage's images
  (`docs/design/streaming.md` 3.9). A beat's `meanwhile: {pin: [...], hide: [...]}` in `story.md`
  overrides the rule; the stage names any beat entry still lacking a written line, and stops when
  the table was built from another export or other event configs.
- `uv run prebuild openings`, after `events`: checks `explore/openings.yaml` against
  `ev/events.tsv.gz` and writes `explore/openings.lock.json` (commit it), whose events `event-files`
  forces into the overview (`docs/design/streaming.md` 3.4). It stops on an opening the index
  lacks, a written date outside the index's span or a written place, one part of another, one
  starting after 2000, a stale table, or a line naming a day its date does not hold. `event-files`
  stops, naming it, until the lock matches the global table, and the release stops, naming
  `event-files`, until that record holds the committed lock: after any change to the table, run
  `openings`, then `event-files`, and commit the lock.
- `npm run verify:bake -- [region|global]`: decodes every tile of `build/region/` (the default)
  or `build/out/`, reading `build/stages/<profile>/`, and checks its seams, headers, `bounds.bin`,
  availability and known places (`docs/design/streaming.md` 7.3). Local only, since building the
  bake needs the raw data; verification reads it without rebuilding. It fails, naming the command,
  when the bake is missing or was built from other pipeline code, configs or pinned sources.
- `npm run publish-data -- [--profile global|region] [--dry-run]`: uploads the keys the build's
  release names that R2 lacks, canary first and never overwriting a key, then writes
  `app/src/generated/release.json` (commit it) and `rel/<id>.json` (`docs/design/streaming.md`
  4.3). `--dry-run` lists R2 and reports what it would upload. Local only; the fixture is never
  published. When the borders' `ver` is new, tag the commit that built them `borders-<ver>` and
  push the tag first: their GPL notice links the build scripts there, and the run stops, naming
  the commands, until origin holds it.
- `uv run prebuild wikidata` exports the event index's classes
  (`pipeline/config/event-classes.yaml`) from QLever's public Wikidata endpoint into
  `sources/wikidata-events-<date>/` in the raw-data folder, one class at a time, and appends its
  pin to `pipeline/sources.toml` (commit it); delete the last export's pin by hand first. The
  `events` stage turns the pinned export into the scored table `ev/events.tsv.gz` in the profile's
  output root (`docs/design/streaming.md` 3.4).
- `uv run prebuild fetch` downloads what is missing from `pipeline/sources.toml` into the raw-data
  folder and checks every sha256. `uv run prebuild excerpts` rewrites the committed excerpts in
  `pipeline/tests/data/` from it, reproducing them byte for byte; commit what it changes.

## Hosting

- App: Cloudflare Pages project `wander` on `wander.traviscole.xyz`. CI deploys `main` after the
  tests pass, using the `CLOUDFLARE_API_TOKEN` repository secret.
- Data: the R2 bucket `wander-data` on `wander-data.traviscole.xyz`. Keys are never overwritten or
  deleted in v1. Objects under `_smoke/` are the hosting checks from issue #1.
- `wrangler` covers the R2 bucket, objects and Pages. Zone rules and DNS are edited in the
  dashboard.
- `npm run publish-data` writes R2 over its S3 API with the credentials in
  `~/.config/wander/r2.env`, outside the repo (never print them, never use the `~/.aws` profiles).
  CI holds no R2 credentials.

## Data

Raw sources live outside the repo in the raw-data folder `~/projects/wander-data` (see its
`README.md` and `manifest.json`); not to be confused with the R2 bucket of the same name. The
prebuild reads that folder from `$WANDER_DATA`, defaulting to `~/projects/wander-data`, and
`pipeline/sources.toml` is the registry that pins each input; the build does not read
`manifest.json`. Raw data (about 13 GB, with GEBCO unzipped) is never committed. Tests run on small
excerpts committed to the repo (`npm run fixture`, then `npm run data -- --profile fixture` and
`?data=fixture` walks the app on them), and `npm run dev` reads production data, so a fresh clone
works without the raw-data folder.

## Working here

- Work is tracked in GitHub issues on `tcole333/wander`.
- Codex agents take tasks here through `AGENTS.md`: Claude writes each brief, prepares the
  worktree, runs the browser and GPU checks Codex's sandbox cannot, and reviews the branch before
  its pull request.
- Small commits in conventional-commit form (`feat(app): ...`, `fix(pipeline): ...`).
- Every test passes before a push. CI runs on every pull request.
- Check visual work in a real browser with a real GPU. Headless Chromium on this Mac can use the
  GPU with `--use-angle=metal`; SwiftShader screenshots misrepresent rendering and timing.
- Performance is measured on this MacBook Pro (Apple M5) for now, at 1440x900, with the lite
  quality tier forced for lite-tier checks as a rough low-end proxy. Lower-end machines get checked
  before launch.

## Writing

- Docs state goals, decisions, and the reason for each, plainly. No approval steps, receipts, or
  hedging boilerplate.
- User-facing copy is plain, vivid history in the present tense. It never describes what the app
  does or does not show, except on failure plates, which say plainly what went wrong and how to
  fix it.
