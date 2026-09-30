# Wander, for agents

Read `CLAUDE.md` first: it guides every agent working here, Codex included, and holds the layout,
commands, hosting, data and writing rules. `docs/PRD.md` says what Wander is and why.
`docs/design/streaming.md` is the architecture; its owner decisions, at the end, are settled.

## Taking a task

Claude reviews and lands work for the owner. It hands you one task in a brief, on its own branch in
its own git worktree, naming the issue, the design sections to read and when the task is done.

- Keep to the brief's scope, and list anything else you notice in your handoff.
- Commit on your branch in small conventional commits (`feat(app): ...`, `fix(pipeline): ...`),
  each with its tests passing. Claude pushes, opens the pull request and merges.
- End with a handoff: what changed and why, the commands you ran and their results, what you could
  not run, and each decision you made that the design doc does not already settle.

## Checks

Your sandbox writes only inside the worktree and can open neither a browser nor a local port, so the
tests that start a local server fail there. While you work, `npm run check` runs the checks
scoped to your change; before you hand off, run `npm run lint`, `npm test`, `npm run build`,
`uv run pytest` and the ruff checks. Outside the worktree your sandbox can read but not write, so
those commands run without the Mac's heavy-work slots, and `npm run fixture` restores the fixture
store's build of your inputs when it holds one and builds otherwise, adding nothing to the store.
Claude runs `npm run gate` before each push, e2e on the Mac's GPU (`npm run e2e:gpu`) included,
the local-server tests and every render; CI runs SwiftShader e2e. Run e2e only as
`npm run e2e[:gpu] -- <args>`, which takes the machine-wide e2e lock, never as a bare
`npx playwright test`. When a task needs a browser measurement, write the script and give the
command that runs it.

## Standing rules

- **One crafted instrument.** Everything a visitor sees belongs to the brass orrery: the walk's
  tokens in `app/src/story/ui/tokens.css`, Libre Baskerville and Source Serif 4, brass, vellum and
  garnet surfaces, engraved small caps, lamp-lit grain. The target is the live walk,
  `docs/reference/ui-inspo.jpg`, the spike shots beside it and the v1 set in
  `docs/design/concepts/2026-09-25/`; `docs/design/concepts/README.md` says what the other sets
  explore.
- **The simplest visible version first.** Build what a visitor sees or what a real bug needs, and
  add proof machinery only where a render or a failure shows the need.
- **A test over thousands of cases asserts once.** It checks each case in plain code, collects the
  failures and asserts that none were found and that it checked any: an expect per case costs
  seconds on a loaded Mac.
- **Data and hosting stay with Claude.** Work from the local builds and the fixture; `npm run
  publish-data`, R2, Cloudflare, `~/.config/wander/` and `git push` are Claude's.
