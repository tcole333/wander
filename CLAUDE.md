# Wander

A desktop web experience for exploring history on a 3D brass-orrery globe. Read these first:

- `docs/PRD.md`: what we're building and why
- `docs/design/streaming.md`: how assets are built, stored, delivered, and streamed
- `docs/reference/`: the visual target and the three.js prototype that proved the look

## Status

Milestone 1 (the Tambora slice) is under way. The surface core (issue #3) is complete: the
prebuild's profiles, cube conventions, `.wst` codec, committed excerpts and `fetch`, `excerpts`,
`coverage` and `surface` stages; the region bake and its check; the decoder and the GPU pools.
The production entry (`app/index.html`, `app/src/main.ts`) plays the Tambora walk from the bundled
release, `app/src/generated/release.json`, with its credits page at `app/credits.html`; it goes live
once that release's data is on R2 (`npm run check-release`). The dev page
`app/prototype.html?story=tambora` boots the same walk (`app/src/walk/boot.ts`) under a tuning
panel. Hosting and CI are live.

## Layout

Paths in the docs are relative to the repo root, except the measurement citations in
`docs/design/streaming.md`, which are relative to `docs/design/measurements/`.

- `app/`: the npm project. TypeScript, Vite and three.js pinned to an exact version (the renderer
  relies on version-specific three.js APIs), with a plain-DOM UI and no React: the approved walk is
  plain three.js, and its bundle is smaller (`docs/design/streaming.md`, owner decision 20).
  Tunables live in `app/src/config/tunables.ts`. The walk's modules live in `app/src/` (`walk/`,
  `view/`, `stream/`, `look/`, `scene/`, `story/`, the walk's material tokens in
  `story/ui/tokens.css`); `app/src/page/` holds the production page's room, failure plates, data
  override and credits styles; `app/src/prototype/` holds only the dev pages' shells and harnesses.
- `pipeline/`: the uv project for the Python prebuild (`uv run prebuild`, under Commands), which
  turns raw sources into web assets. Its config, queries and test excerpts live under it.
- `shared/constants.json`: magics, sentinels, the layer order and the cube face table, read by
  both projects.
- `stories/<story>/`: one folder per story: `story.md`, its datasets, audio and `story.lock.json`.
- `build/`: generated output (git-ignored): the prebuild's roots, one per profile in the R2 key
  layout (`build/out/` for global, `build/region/`, `build/fixture/`), stage records in
  `build/stages/<profile>/` and caches in `build/cache/`; and lab reports in `build/lab/`.
- `docs/`: PRD, design docs, reference images.

## Commands

Run npm commands in `app/` and uv commands in `pipeline/`.

- `npm ci`, then `npm run dev`: the app on Vite's dev server, reading production data from
  `wander-data.traviscole.xyz`. On a page served from loopback, `?data=fixture|region|global` or
  `?data=<origin>` reads a local data server's release instead (`app/src/page/dataOrigin.ts`).
- `npm run lint`: ESLint and Prettier. `npm run format` rewrites formatting.
- `npm run fixture`: the Python fixture build (`uv run prebuild --profile fixture`, so it needs
  uv) into `build/fixture/` and `build/stages/fixture/`. Vitest checks against it and fails,
  naming this command, when it is missing or was built from other pipeline code, shared constants
  or excerpts than the working tree holds.
- `npm run data -- --profile fixture|region`: serves `build/fixture/` on :8791 or `build/region/` on
  :8792 with R2's headers, plus the build's release at `/release.json` (`docs/design/streaming.md`
  7.3).
- `npm run check-release`: HEADs the bundled release's `rel/<id>.json` on the data host, then GETs
  its `bounds.bin` and L0 tiles and checks R2's headers. CI runs it as its own job, which the Pages
  deploy waits for; it fails, naming `npm run publish-data`, until the release's data is uploaded.
- `npm test`: Vitest. `npm run build`: type-check and build `app/dist/`.
- `npm run fixture` and `npm run build`, then `npm run e2e`: Playwright on SwiftShader, as in CI.
  The smoke tests run against that build in `app/dist/` (it does not rebuild), on the fixture's
  data server through `?data=` and with Commons stubbed; the other tests run test-only pages on
  the Vite dev server, reading the fixture from its data server, so none of it reaches the build.
  Run `npx playwright install chromium` once first.
- The same, then `npm run e2e:gpu`: the same tests on this Mac's GPU (Chromium with
  `--use-angle=metal`), local only. It is the start of the GPU matrix
  (`docs/design/streaming.md` 7.3): run it when renderer, streaming or format code changes, and
  put the result in the PR description.
- `npm run lab`: the experiments' lab runs on this Mac: Chromium on Metal through Playwright, and
  the installed Safari and Firefox through lab pages that post their reports to the dev server
  (`build/lab/`). It needs no build; the lab specs that read the region bake start its data server
  and fail, naming the command, when the bake is missing. Local only; it opens a tab in both
  browsers.
- `uv sync`, then `uv run pytest`, `uv run ruff check .` and `uv run ruff format --check .`.
- `uv run prebuild [--profile global|region|fixture] [--jobs N] [stage …]`: the prebuild
  (`docs/design/streaming.md` 7.1). A bare run builds the global profile into `build/out/`, taking
  every stage in order except `excerpts` and `media`; the fixture profile also skips `fetch`, and
  `modera` until the climate layer has an excerpt. `uv run prebuild --profile region` bakes the
  milestone-1 region into `build/region/` (about 2.5 min on the M5, plus 50 s for `modera`, which
  writes all of ModE-RA whatever the profile).
- `npm run verify:bake`, after the region bake: decodes every tile of `build/region/` and checks
  its seams, headers, `bounds.bin`, availability and known places (`docs/design/streaming.md`
  7.3). Local only, since the bake needs the raw data; it fails, naming the command, when the bake
  is missing or was built from other pipeline code, configs or pinned sources.
- `npm run publish-data -- [--profile global|region] [--dry-run]`: uploads the keys the build's
  release names that R2 lacks, canary first and never overwriting a key, then writes
  `app/src/generated/release.json` (commit it) and `rel/<id>.json` (`docs/design/streaming.md`
  4.3). `--dry-run` lists R2 and reports what it would upload. Local only; the fixture is never
  published.
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
`manifest.json`. Raw data (about 13 GB, with GEBCO unzipped) is never committed. Tests (and
`npm run dev:fixture`, planned in `docs/design/streaming.md` 7.3) run on small excerpts committed
to the repo, and `npm run dev` reads production data, so a fresh clone works without the raw-data
folder.

## Working here

- Work is tracked in GitHub issues on `tcole333/wander`.
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
