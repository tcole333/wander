# Wander

A desktop web experience for exploring history on a 3D brass-orrery globe. Read these first:

- `docs/PRD.md`: what we're building and why
- `docs/design/streaming.md`: how assets are built, stored, delivered, and streamed
- `docs/reference/`: the visual target and the three.js prototype that proved the look

## Status

Milestone 1 (the Tambora slice) is under way. The app is a placeholder, the prebuild has no
stages yet, and hosting and CI are live.

## Layout

Paths in the docs are relative to the repo root.

- `app/`: the npm project. TypeScript, Vite, React, react-three-fiber, three.js pinned to an exact
  version (the renderer relies on version-specific three.js APIs). drei and Zustand join with the
  globe runtime. Tunables live in `app/src/config/tunables.ts`.
- `pipeline/`: the uv project for the Python prebuild (`uv run prebuild <stage>`), which turns raw
  sources into web assets. Its config, queries and test excerpts live under it.
- `shared/constants.json`: magics, sentinels and the layer order, read by both projects.
- `stories/<story>/`: one folder per story: `story.md`, its datasets, audio and `story.lock.json`.
- `build/`: prebuild output (git-ignored): `build/out/` in the R2 key layout, `build/fixture/`.
- `docs/`: PRD, design docs, reference images.

## Commands

Run npm commands in `app/` and uv commands in `pipeline/`.

- `npm ci`, then `npm run dev`: the app on Vite's dev server, reading production data from
  `wander-data.traviscole.xyz`.
- `npm run lint`: ESLint and Prettier. `npm run format` rewrites formatting.
- `npm test`: Vitest. `npm run build`: type-check and build `app/dist/`.
- `npm run e2e`: Playwright against the production build, on SwiftShader (as in CI). Run
  `npx playwright install chromium` once first.
- `uv sync`, then `uv run pytest`, `uv run ruff check .` and `uv run ruff format --check .`.

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
prebuild takes that folder's location as configuration (suggested: a `WANDER_DATA` environment
variable). Raw data (about 6 GB) is never committed. Tests (and, once the fixture build lands,
`npm run dev:fixture`) run on small excerpts committed to the repo, and `npm run dev` reads
production data, so a fresh clone works without the raw-data folder.

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
