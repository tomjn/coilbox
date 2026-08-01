#!/usr/bin/env bash
# Prove that the teams block the scenario editor writes reaches Splinter
# Faction (issue #899).
#
# scripts/mission-sf-proof.sh already proves the block itself: it plays
# src/scenario/fixtures/missions/splinter/mission.lua on a real Splinter Faction
# with the adoption guards in, and the probe reads the game's own phase param to
# show the faction and start spot pickers were skipped and no commander arrived.
#
# What it could not show is where that block came from. It was typed into the
# fixture by hand, because until #899 the editor had no way to write one. So this
# rebuilds the block through the editor's own write path, `teams.ts`, compiles
# it, and checks the result is the mission the proof plays, byte for byte. Then
# it runs the proof.
#
# Every argument is passed on to scripts/mission-sf-proof.sh, and so is every
# environment variable it reads.
#
# Usage: scripts/mission-sf-authored.sh [--keep-mission] [--apply-guards]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GOLDEN="$ROOT/src/scenario/fixtures/missions/splinter/mission.lua"

command -v bun >/dev/null || { echo "this needs bun on PATH" >&2; exit 2; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/coilbox-sf-authored.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
AUTHORED="$WORK/mission.lua"

bun run "$ROOT/scripts/sf-proof/authored-teams.ts" "$AUTHORED"
echo

if ! diff -u "$GOLDEN" "$AUTHORED"; then
  echo >&2
  echo "the mission the editor writes is not the one the proof plays, so the" >&2
  echo "run below would prove nothing about the editor." >&2
  exit 1
fi

echo "the editor's write path produced $GOLDEN byte for byte, so the run below"
echo "is a run of what the editor writes."
echo

exec "$ROOT/scripts/mission-sf-proof.sh" "$@"
