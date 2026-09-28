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

Your sandbox writes only inside the worktree and cannot open a browser. Run `npm run lint`,
`npm test`, `npm run build`, `uv run pytest` and the ruff checks there. Claude runs `npm run e2e`,
`npm run e2e:gpu` and every render on the Mac's GPU; when a task needs a browser measurement, write
the script and give the command that runs it.

## Standing rules

- **One crafted instrument.** Everything a visitor sees belongs to the brass orrery: the walk's
  tokens in `app/src/story/ui/tokens.css`, Libre Baskerville and Source Serif 4, brass, vellum and
  garnet surfaces, engraved small caps, lamp-lit grain. The target is the live walk,
  `docs/reference/ui-inspo.jpg`, the spike shots beside it and the v1 set in
  `docs/design/concepts/2026-09-25/`; `docs/design/concepts/README.md` says what the other sets
  explore.
- **The simplest visible version first.** Build what a visitor sees or what a real bug needs, and
  add proof machinery only where a render or a failure shows the need.
- **Data and hosting stay with Claude.** Work from the local builds and the fixture; `npm run
  publish-data`, R2, Cloudflare, `~/.config/wander/` and `git push` are Claude's.
