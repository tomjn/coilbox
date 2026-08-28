#!/usr/bin/env bash
# Build the coilbox-relay-agent sidecar for the host platform and place it in
# src-tauri/binaries/ with the target-triple suffix Tauri's externalBin bundling
# expects. Same deal as the unitsync worker: our own workspace crate, so it's a
# build artifact (gitignored, rebuilt by CI per platform) rather than a committed
# prebuilt like pr-downloader/uberstress.
set -euo pipefail
cd "$(dirname "$0")/.."

TRIPLE="$(rustc -Vv | sed -n 's/^host: //p')"
EXE=""
case "$TRIPLE" in
*windows*) EXE=".exe" ;;
esac

cargo build -p coilbox-relay-agent --release
mkdir -p src-tauri/binaries
cp "target/release/coilbox-relay-agent${EXE}" \
  "src-tauri/binaries/coilbox-relay-agent-${TRIPLE}${EXE}"
echo "Built src-tauri/binaries/coilbox-relay-agent-${TRIPLE}${EXE}"
