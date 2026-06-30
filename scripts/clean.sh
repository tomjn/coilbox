#!/usr/bin/env bash
# Remove the locally-built artifacts so the next build starts from scratch.
#
# Scope is deliberately narrow: only the gitignored products this repo generates
# itself — the coilbox-unitsync-worker sidecar (the one that silently goes stale
# on a plain `git pull`, since nothing rebuilds it unless you run sidecar:all),
# its cargo artifacts, and the vite build output.
#
# Left untouched on purpose:
#   - committed prebuilts (pr-downloader-*, uberstress-*) — they are checked in
#   - the fetched mapconv resource (src-tauri/mapconv/) — tauri-build needs the
#     directory to exist, so wiping it breaks the next `cargo`/`tauri` build
#   - the shared cargo target for every other crate (use `cargo clean` yourself
#     if you really want a full rebuild)
set -euo pipefail
cd "$(dirname "$0")/.."

rm -f src-tauri/binaries/coilbox-unitsync-worker-*
rm -rf dist
cargo clean -p coilbox-unitsync-worker

echo "Cleaned: unitsync worker sidecar + its cargo artifacts, and dist/."
echo "Rebuild the sidecar with: bun run sidecar:all   (bun tauri dev does this for you)"
