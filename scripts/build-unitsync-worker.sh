#!/usr/bin/env bash
# Build the coilbox-unitsync-worker sidecar for the host platform and place it in
# src-tauri/binaries/ with the target-triple suffix Tauri's externalBin bundling
# expects. The worker is our own workspace crate (not a committed prebuilt like
# pr-downloader/uberstress), so it's a build artifact — gitignored, rebuilt by CI
# per platform, and produced locally by this script before `tauri dev`/`build`.
set -euo pipefail
cd "$(dirname "$0")/.."

TRIPLE="$(rustc -Vv | sed -n 's/^host: //p')"
EXE=""
case "$TRIPLE" in
*windows*) EXE=".exe" ;;
esac

cargo build -p coilbox-unitsync-worker --release
mkdir -p src-tauri/binaries
cp "target/release/coilbox-unitsync-worker${EXE}" \
  "src-tauri/binaries/coilbox-unitsync-worker-${TRIPLE}${EXE}"
echo "Built src-tauri/binaries/coilbox-unitsync-worker-${TRIPLE}${EXE}"
