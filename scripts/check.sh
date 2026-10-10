#!/usr/bin/env bash
# Run the same checks CI runs (.github/workflows/lint.yml) and write each
# command's full output to check-output/ (gitignored) instead of a path
# invented at the filesystem root.
#
# Every check runs even if an earlier one fails, so one invocation surfaces
# every failure CI would catch, not just the first. The script exits non-zero
# if any check failed.
#
# Two lanes run side by side (#3745). The cargo commands stay in order in one
# lane, because two cargo invocations at once fight over the same target lock,
# and `bun tauri dev` may already be holding it. Nothing in the other lane
# touches the target folder. Two lanes and not one per check: nine at once has
# pushed this machine's load past 300 and timed tests out.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

OUT_DIR="check-output"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# Clippy needs these bundle-resource paths to exist (see lint.yml). It only
# checks that the path is there, not its contents, so this is a no-op once a
# real `bun tauri dev` has populated them.
mkdir -p src-tauri/mapconv src-tauri/prdownloader

# A check reports as it finishes, so lines from the two lanes interleave. A
# failure is printed in one write so its log tail stays in one piece. The
# lanes are subshells, so a failure is recorded as a file, not a variable.
run_check() {
  local name="$1"
  shift
  local log="$OUT_DIR/$name.log"
  if "$@" >"$log" 2>&1; then
    echo "pass  $name"
  else
    touch "$OUT_DIR/$name.failed"
    printf 'FAIL  %s: %s\n      full output in %s\n      --- last 20 lines ---\n%s\n' \
      "$name" "$*" "$log" "$(tail -n 20 "$log" | sed 's/^/      /')"
  fi
}

cargo_lane() {
  run_check cargo-fmt cargo fmt --all --check
  run_check cargo-clippy cargo clippy --all-targets -- -D warnings
  # Clippy compiles the #[cfg(test)] modules but never runs them, so without
  # this a Rust test can be wrong for as long as it still compiles. nextest is
  # what CI runs. It skips doctests, so those get a run of their own.
  run_check cargo-nextest cargo nextest run --workspace
  run_check cargo-doctest cargo test --workspace --doc
}

js_lane() {
  run_check biome bunx biome ci .
  run_check typecheck bun run typecheck
  run_check test bun run test
  # The mission runtime and the blueprint widget are Lua the engine runs, so
  # nothing above compiles them.
  run_check mission-tests scripts/mission-tests.sh
}

cargo_lane &
js_lane &
wait

echo
echo "Full logs: $OUT_DIR/"
if compgen -G "$OUT_DIR/*.failed" >/dev/null; then
  echo "Some checks failed."
  exit 1
fi
echo "All checks passed."
