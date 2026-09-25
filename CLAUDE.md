# Wander

A desktop web experience for exploring history on a 3D brass-orrery globe. Read these first:

- `docs/PRD.md`: what we're building and why
- `docs/design/streaming.md`: how assets are built, stored, delivered, and streamed
- `docs/reference/`: the visual target and the three.js prototype that proved the look

## Status

Milestone 1 (the Tambora slice) is under way. The app is a placeholder; the prebuild has its
profiles, the cube conventions, the `.wst` codec, the `fetch` and `excerpts` stages and the
committed excerpts, but no surface bake yet; hosting and CI are live.

## Layout

Paths in the docs are relative to the repo root, except the measurement citations in
`docs/design/streaming.md`, which are relative to `docs/design/measurements/`.

- `app/`: the npm project. TypeScript, Vite, React, react-three-fiber, three.js pinned to an exact
  version (the renderer relies on version-specific three.js APIs). drei and Zustand join with the
  globe runtime. Tunables live in `app/src/config/tunables.ts`.
- `pipeline/`: the uv project for the Python prebuild (`uv run prebuild`, under Commands), which
  turns raw sources into web assets. Its config, queries and test excerpts live under it.
- `shared/constants.json`: magics, sentinels, the layer order and the cube face table, read by
  both projects.
- `stories/<story>/`: one folder per story: `story.md`, its datasets, audio and `story.lock.json`.
- `build/`: prebuild output (git-ignored): one root per profile in the R2 key layout (`build/out/`
  for global, `build/region/`, `build/fixture/`), stage records in `build/stages/<profile>/` and
  caches in `build/cache/`.
- `docs/`: PRD, design docs, reference images.

## Commands

Run npm commands in `app/` and uv commands in `pipeline/`.

- `npm ci`, then `npm run dev`: the app on Vite's dev server, reading production data from
  `wander-data.traviscole.xyz`.
- `npm run lint`: ESLint and Prettier. `npm run format` rewrites formatting.
- `npm run fixture`: the Python fixture build (`uv run prebuild --profile fixture`, so it needs
  uv) into `build/fixture/` and `build/stages/fixture/`. Vitest checks against it and fails,
  naming this command, when it is missing or was built from other pipeline code, shared constants
  or excerpts than the working tree holds.
- `npm test`: Vitest. `npm run build`: type-check and build `app/dist/`.
- `npm run build`, then `npm run e2e`: Playwright on SwiftShader, as in CI. The smoke test runs
  against that build in `app/dist/` (it does not rebuild); the GPU pool test runs a test-only page
  on the Vite dev server, so none of it reaches the build. Run `npx playwright install chromium`
  once first.
- `npm run build`, then `npm run e2e:gpu`: the same tests on this Mac's GPU (Chromium with
  `--use-angle=metal`), local only. It is the start of the GPU matrix
  (`docs/design/streaming.md` 7.3): run it when renderer, streaming or format code changes, and
  put the result in the PR description.
- `uv sync`, then `uv run pytest`, `uv run ruff check .` and `uv run ruff format --check .`.
- `uv run prebuild [--profile global|region|fixture] [--jobs N] [stage …]`: the prebuild
  (`docs/design/streaming.md` 7.1). A bare run builds the global profile into `build/out/`, taking
  every stage in order except `excerpts` and `media`; the fixture profile also skips `fetch`.
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

## Data

Raw sources live outside the repo in the raw-data folder `~/projects/wander-data` (see its
`README.md` and `manifest.json`); not to be confused with the R2 bucket of the same name. The
prebuild reads that folder from `$WANDER_DATA`, defaulting to `~/projects/wander-data`, and
`pipeline/sources.toml` is the registry that pins each input; the build does not read
`manifest.json`. Raw data (about 13 GB, with GEBCO unzipped) is never committed. Tests (and, once
the fixture build lands, `npm run dev:fixture`) run on small excerpts committed to the repo, and
`npm run dev` reads production data, so a fresh clone works without the raw-data folder.

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
  does or does not show.
