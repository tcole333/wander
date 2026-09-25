# Wander

A desktop web experience for exploring history on a 3D brass-orrery globe. Read these first:

- `docs/PRD.md`: what we're building and why
- `docs/design/streaming.md`: how assets are built, stored, delivered, and streamed
- `docs/reference/`: the visual target and the three.js prototype that proved the look

## Status

Pre-scaffolding: the docs are written; the app and pipeline do not exist yet. Update this file
with real commands as they land.

## Layout (planned)

- `app/`: TypeScript, Vite, React, react-three-fiber + drei, Zustand, three.js (pinned to an exact
  version, because the renderer relies on version-specific three.js APIs)
- `pipeline/`: Python (uv) prebuild that turns raw sources into web assets
- `stories/`: one Markdown file per story
- `docs/`: PRD, design docs, reference images

## Data

Raw sources live outside the repo in `~/projects/wander-data` (see its `README.md` and
`manifest.json`). The pipeline takes that folder's location as configuration (suggested: a
`WANDER_DATA` environment variable). Raw data (about 6 GB) is never committed;
tests and local development run on small excerpts committed to the repo, so a fresh clone works
without the data folder.

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
