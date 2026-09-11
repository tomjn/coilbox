#!/usr/bin/env bash
# Build one or more of our own sidecar crates (coilbox-unitsync-worker,
# coilbox-relay-agent) for the host platform and place each in
# src-tauri/binaries/ with the target-triple suffix Tauri's externalBin
# bundling expects. These are workspace crates (not committed prebuilts like
# pr-downloader/uberstress), so they're build artifacts - gitignored, rebuilt
# by CI per platform, and produced locally by this script before
# `tauri dev`/`build`.
#
# Pass every crate you want in one call: a single `cargo build --release`
# plans all of them together, so shared dependencies build once and the final
# crates compile in parallel, instead of one `cargo build` per crate in turn.
#
# Usage: build-sidecars.sh <crate-name>...
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "$#" -eq 0 ]; then
  echo "Usage: $0 <crate-name>..." >&2
  exit 1
fi

TRIPLE="$(rustc -Vv | sed -n 's/^host: //p')"
EXE=""
case "$TRIPLE" in
*windows*) EXE=".exe" ;;
esac

CARGO_ARGS=()
for CRATE in "$@"; do
  CARGO_ARGS+=(-p "$CRATE")
done

cargo build "${CARGO_ARGS[@]}" --release
mkdir -p src-tauri/binaries
for CRATE in "$@"; do
  cp "target/release/${CRATE}${EXE}" \
    "src-tauri/binaries/${CRATE}-${TRIPLE}${EXE}"
  echo "Built src-tauri/binaries/${CRATE}-${TRIPLE}${EXE}"
done
