#!/usr/bin/env bash
# Rebuild the committed macOS pr-downloader, src-tauri/binaries/pr-downloader-aarch64-apple-darwin.
#
# Run it on an Apple Silicon Mac with cmake and pkg-config installed. No official
# macOS build exists, so this is how the file is made. To move to a newer
# pr-downloader, change PRD_COMMIT to a commit on beyond-all-reason/pr-downloader
# and run this again.
#
# Homebrew's minizip would otherwise be picked up through pkg-config and linked as
# /opt/homebrew/opt/minizip/lib/libminizip.1.dylib, which a Mac without Homebrew
# does not have (issue #17). With pkg-config pointed at an empty folder, CMake falls
# back to the copies of minizip and jsoncpp in src/lib, linked statically. libcurl
# and zlib then come from the macOS SDK. The deployment target matches the one
# release.yml sets for the other macOS sidecars. The script stops if the result
# links anything outside /usr/lib or /System.
set -euo pipefail

PRD_COMMIT=65ae7f12aee101a705ff7fbd0f3be36bbaf9792c
DEPLOYMENT_TARGET=11.0

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/src-tauri/binaries/pr-downloader-aarch64-apple-darwin"

if [ "$(uname -s)-$(uname -m)" != "Darwin-arm64" ]; then
  echo "This builds the aarch64-apple-darwin binary and needs an Apple Silicon Mac." >&2
  exit 1
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/prd-macos.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

git clone --quiet https://github.com/beyond-all-reason/pr-downloader.git "$WORK/src"
git -C "$WORK/src" checkout --quiet "$PRD_COMMIT"
git -C "$WORK/src" submodule update --quiet --init --recursive

mkdir "$WORK/empty-pkgconfig"
PKG_CONFIG_LIBDIR="$WORK/empty-pkgconfig" PKG_CONFIG_PATH= cmake \
  -S "$WORK/src" -B "$WORK/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DCMAKE_OSX_DEPLOYMENT_TARGET="$DEPLOYMENT_TARGET" \
  -DCMAKE_IGNORE_PREFIX_PATH=/opt/homebrew
cmake --build "$WORK/build" -j "${JOBS:-$(sysctl -n hw.ncpu)}"

BUILT="$WORK/build/src/pr-downloader"
if otool -L "$BUILT" | tail -n +2 | awk '{print $1}' | grep -v -E '^/(usr/lib|System)/'; then
  echo "The build links libraries outside /usr/lib and /System (listed above)." >&2
  exit 1
fi

cp "$BUILT" "$OUT"
chmod +x "$OUT"
echo "Wrote $OUT"
otool -L "$OUT"
