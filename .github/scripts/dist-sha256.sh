#!/usr/bin/env bash
# Prints one sha256 over a build directory's files, their paths and bytes, so CI's jobs can check
# that the build the deploy ships is the one every e2e shard tested.
set -euo pipefail
cd "${1:?usage: dist-sha256.sh <build dir>}"
find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1
