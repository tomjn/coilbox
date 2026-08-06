#!/usr/bin/env bash
# Run the same checks CI runs (.github/workflows/lint.yml), sequentially, and
# write each command's full output to check-output/ (gitignored) instead of a
# path invented at the filesystem root.
#
# Every check runs even if an earlier one fails, so one invocation surfaces
# every failure CI would catch, not just the first. The script exits non-zero
# if any check failed.
#
# Sequential on purpose: two cargo invocations at once fight over the same
# target lock, and `bun tauri dev` may already be holding it.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

OUT_DIR="check-output"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# Clippy needs these bundle-resource paths to exist (see lint.yml). It only
# checks that the path is there, not its contents, so this is a no-op once a
# real `bun tauri dev` has populated them.
mkdir -p src-tauri/mapconv src-tauri/prdownloader

FAILED=0

run_check() {
  local name="$1"
  shift
  local log="$OUT_DIR/$name.log"
  echo "==> $name: $*"
  if "$@" >"$log" 2>&1; then
    echo "    pass"
  else
    FAILED=1
    echo "    FAIL - full output in $log"
    echo "    --- last 20 lines ---"
    tail -n 20 "$log" | sed 's/^/    /'
  fi
}

run_check cargo-fmt cargo fmt --all --check
run_check cargo-clippy cargo clippy --all-targets --all-features -- -D warnings
# Clippy compiles the #[cfg(test)] modules but never runs them, so without this
# a Rust test can be wrong for as long as it still compiles.
run_check cargo-test cargo test --workspace
run_check biome bunx biome ci .
run_check typecheck bun run typecheck
run_check test bun run test

echo
echo "Full logs: $OUT_DIR/"
if [ "$FAILED" -eq 0 ]; then
  echo "All checks passed."
else
  echo "Some checks failed."
fi

exit "$FAILED"
