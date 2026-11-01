#!/usr/bin/env bash
# Runs the dev server on Node. On Bun 1.3.14 about one vite start in four left the
# first page request unanswered, which showed as a blank window with no error.
#
# bunfig's run.bun puts a `node` that is really Bun at the front of PATH inside a
# package script, so that entry has to come off PATH to reach the real one.
set -euo pipefail

clean_path=""
IFS=':' read -ra entries <<<"$PATH"
for entry in "${entries[@]}"; do
  case "$entry" in
  */bun-node-*) ;;
  *) clean_path="${clean_path:+$clean_path:}$entry" ;;
  esac
done
export PATH="$clean_path"

if ! node --version >/dev/null 2>&1; then
  echo "dev-vite: the dev server needs Node, and the first node on PATH did not run. Install or repair Node, then run this again." >&2
  exit 1
fi

exec node node_modules/vite/bin/vite.js "$@"
