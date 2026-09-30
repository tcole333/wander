// Inputs Vitest tests read from disk rather than import, as repo-relative globs: the fixture's
// inputs, the stories, Explore's openings, the design doc, the HTML entries, and the files the
// script tests run or read (slot.sh, the pre-push hook). No import reaches them, so a change to
// one calls for the whole suite. vite.config.ts makes them watch mode's forceRerunTriggers, and
// npm run check matches a change against them itself: Vitest matches its triggers against
// absolute paths, where `**` never enters a dot-folder, so in a checkout under .claude/worktrees/
// none of them would fire.
export const DISK_INPUTS = [
  'pipeline/src/**',
  'pipeline/config/**',
  'pipeline/tests/data/**',
  'pipeline/{pyproject.toml,uv.lock,sources.toml,.python-version}',
  'shared/**',
  'stories/**',
  'explore/**',
  'docs/design/streaming.md',
  'app/*.html',
  'app/scripts/slot.sh',
  '.githooks/**',
];
