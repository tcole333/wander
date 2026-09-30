#!/bin/sh
# Machine-wide limits on heavy local work, so parallel sessions on this Mac queue instead of
# slowing each other 5-20 times:
#
#   sh scripts/slot.sh heavy <command> [args]  runs the command in one of the heavy-work slots
#   sh scripts/slot.sh e2e <command> [args]    takes the e2e lock, then a slot, then runs it
#
# The slots are flock(2) locks on $WANDER_CACHE/heavy.<n>.lock (~/.cache/wander by default,
# WANDER_HEAVY_SLOTS of them, 2 by default); the e2e lock is e2e.lock beside them. The kernel
# drops a lock the moment its holder dies, even on kill -9. prebuild and pytest take the same
# slots (pipeline/src/prebuild/slots.py). A held slot passes to child processes in
# WANDER_HEAVY_SLOT, so heavy work nested in it takes no second one. On CI, off macOS, and
# where the pool cannot be written (Codex's sandbox), the command runs at once.
#
# Only a run under the e2e lock starts servers on e2e's ports (app/e2e/servers.ts), so one still
# listening there once the lock is taken was left by a run that was killed: Playwright starts its
# servers in process groups of their own, which outlive it. The e2e mode stops them first.
set -eu

mode=${1:-}
[ $# -gt 0 ] && shift
pool=${WANDER_CACHE:-$HOME/.cache/wander}
slots=${WANDER_HEAVY_SLOTS:-2}
poll=${WANDER_SLOT_POLL:-2}
ports=${WANDER_E2E_PORTS:-6273-6275}

unlimited() {
  [ -n "${CI:-}" ] || [ "$(uname)" != Darwin ] || ! mkdir -p "$pool" 2>/dev/null ||
    ! [ -w "$pool" ]
}

# This shell holds the locks on fds 8 and 9 and waits for the command, which runs with both
# closed, so no server it leaves behind can keep a lock.
run() {
  set +e
  "$@" 8>&- 9>&-
  exit $?
}

heavy() {
  if [ -n "${WANDER_HEAVY_SLOT:-}" ] || unlimited; then run "$@"; fi
  said=
  while :; do
    n=0
    while [ "$n" -lt "$slots" ]; do
      exec 9>>"$pool/heavy.$n.lock"
      if /usr/bin/lockf -s -t 0 9; then
        WANDER_HEAVY_SLOT=$n
        export WANDER_HEAVY_SLOT
        run "$@"
      fi
      exec 9>&-
      n=$((n + 1))
    done
    if [ -z "$said" ]; then
      echo "slot.sh: waiting for one of $slots heavy-work slots ($pool/heavy.*.lock)" >&2
      said=1
    fi
    sleep "$poll"
  done
}

# This user's processes listening on e2e's ports.
listening() {
  /usr/sbin/lsof -nP -a -u "$(id -u)" -iTCP:"$ports" -sTCP:LISTEN -t 2>/dev/null | sort -u
}

stop_leftovers() {
  left=$(listening)
  [ -n "$left" ] || return 0
  echo "slot.sh: stopping the servers a killed e2e run left on ports $ports:" >&2
  for pid in $left; do echo "  $pid $(ps -o command= -p "$pid" 2>/dev/null || true)" >&2; done
  kill $left 2>/dev/null || true
  tries=0
  while [ -n "$(listening)" ] && [ "$tries" -lt 50 ]; do
    sleep 0.1
    tries=$((tries + 1))
  done
  left=$(listening)
  [ -z "$left" ] && return 0
  echo "slot.sh: still listening on ports $ports; stop them with: kill -9" $left >&2
  exit 1
}

e2e() {
  if unlimited; then run "$@"; fi
  exec 8>>"$pool/e2e.lock"
  if ! /usr/bin/lockf -s -t 0 8; then
    echo "slot.sh: waiting for the e2e lock ($pool/e2e.lock)" >&2
    /usr/bin/lockf -s 8
  fi
  stop_leftovers
  heavy "$@"
}

case $mode in
  heavy) heavy "$@" ;;
  e2e) e2e "$@" ;;
  *)
    echo "usage: sh scripts/slot.sh heavy|e2e <command> [args]" >&2
    exit 64
    ;;
esac
