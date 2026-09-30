#!/bin/sh
# A git worktree ready to work and test in, and its removal:
#
#   scripts/worktree.sh add <path> <branch> [<start>]
#     git worktree add -b <branch> <path> <start> (origin/main by default), then npm ci and
#     uv sync --locked, links build/out/* and build/stages/global/* to the main checkout's global
#     bake (read-only by convention), and npm run fixture, which the fixture store usually answers
#     in a second.
#   scripts/worktree.sh remove <path> [--force]
#     deletes those links first, so nothing under the main checkout's bake can go with the
#     worktree, then git worktree remove.
set -eu

usage() {
  echo "usage: scripts/worktree.sh add <path> <branch> [<start>] | remove <path> [--force]" >&2
  exit 64
}

main=$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd)

link_bake() {
  for part in out stages/global; do
    if [ ! -d "$main/build/$part" ]; then
      echo "worktree.sh: $main/build/$part is missing; no links to it" >&2
      continue
    fi
    mkdir -p "$1/build/$part"
    for entry in "$main/build/$part"/*; do
      [ -e "$entry" ] && ln -s "$entry" "$1/build/$part/"
    done
  done
}

[ $# -ge 2 ] || usage
case $1 in
  add)
    [ $# -ge 3 ] || usage
    path=$2
    branch=$3
    start=${4:-origin/main}
    git fetch --quiet origin
    git worktree add -b "$branch" "$path" "$start"
    path=$(cd "$path" && pwd)
    (cd "$path/app" && npm ci --no-audit --no-fund)
    (cd "$path/pipeline" && uv sync --locked)
    link_bake "$path"
    (cd "$path/app" && npm run fixture)
    ;;
  remove)
    path=$2
    shift 2
    if [ -d "$path/build" ]; then find "$path/build" -maxdepth 3 -type l -delete; fi
    git worktree remove "$@" "$path"
    ;;
  *) usage ;;
esac
