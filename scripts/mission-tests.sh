#!/usr/bin/env bash
# Run every Lua test suite: the mission runtime's and the blueprint widget's.
#
# The suites are whatever lua/*/tests/ holds, so adding one is adding a file.
# Each runs on its own in luajit and prints "all passed", the way a single suite
# does when run by hand.
#
# This does not run the engine. scripts/mission-headless.sh does that, and needs
# a spring-headless binary and a game installed.
#
# Usage: scripts/mission-tests.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v luajit >/dev/null; then
  echo "luajit is not on PATH" >&2
  exit 2
fi

failures=0
for suite in "$ROOT"/lua/*/tests/*_test.lua; do
  name="$(basename "$(dirname "$(dirname "$suite")")")/$(basename "$suite" .lua)"
  if output="$(luajit "$suite" 2>&1)"; then
    echo "ok   $name"
  else
    echo "FAIL $name"
    echo "$output" | sed 's/^/     /'
    failures=$((failures + 1))
  fi
done

echo
if [ "$failures" -eq 0 ]; then
  echo "all suites passed"
else
  echo "$failures suite(s) failed"
  exit 1
fi
