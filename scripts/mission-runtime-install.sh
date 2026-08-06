#!/usr/bin/env bash
# Install this repo's mission runtime into a loose game, the way Content > Games
# does (issue #934).
#
# The Splinter Faction harness scripts play the runtime a game vendors rather
# than the one in lua/mission-runtime/, and nothing re-installed it, so the two
# drifted and the proofs stayed green against a runtime coilbox no longer ships.
# Every one of them calls this first, so what they measure is what this repo
# would put into a real player's game.
#
# It is not a shell copy of the install. It runs the scenario plugin's own
# install through a cargo example, which is the code behind the button, so the
# harness cannot drift from the app either. That does mean a cargo build: a few
# seconds warm, and longer on a cold target directory or while `bun tauri dev`
# holds the lock.
#
# Prints the installed version and the number of files, space separated.
#
# Usage: scripts/mission-runtime-install.sh <game folder>
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DEST="${1:-}"
if [ -z "$DEST" ] || [ $# -gt 1 ]; then
  echo "usage: scripts/mission-runtime-install.sh <game folder>" >&2
  exit 2
fi
[ -d "$DEST" ] || { echo "no loose game folder at $DEST" >&2; exit 2; }
command -v cargo >/dev/null || {
  echo "installing the mission runtime needs cargo on PATH" >&2
  exit 2
}

# The installed version and the number of files go to stdout, space separated,
# for a caller to put in its own header and to tell a probe which version to
# expect. This notice goes to stderr instead, because a cold target directory, or
# one `bun tauri dev` is holding, makes the line below take a while and silence
# looks like a hang.
echo "installing the mission runtime into $(basename "$DEST")..." >&2

# --quiet keeps cargo's own progress out of a harness's output. A compile error
# still reaches stderr, and set -e stops the caller.
cargo run --quiet --manifest-path "$ROOT/Cargo.toml" \
  -p tauri-plugin-coilbox-scenario --example install-mission-runtime -- \
  "$ROOT/lua/mission-runtime" "$DEST"
