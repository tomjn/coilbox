#!/usr/bin/env bash
# Assemble the pr-downloader sidecar into src-tauri/prdownloader/ for the current
# platform, so Tauri can bundle it as a *resource folder* (not externalBin).
#
# Why a folder and not externalBin: the Windows pr-downloader is a MinGW build
# that loads libcurl.dll / zlib1.dll / libwinpthread-1.dll from its own directory
# at runtime. externalBin copies only the lone binary, so those DLLs would be
# missing on a clean machine (STATUS_DLL_NOT_FOUND, 0xC0000135). A resource folder
# keeps the binary beside its DLLs, exactly like the mapconv sidecar keeps its
# libs/. Resolved at runtime via resource_dir() (see the downloads plugin's
# sidecar::resolve_sidecar), or PRD_SIDECAR for `bun tauri dev`.
#
# Sources are the committed per-triple prebuilts under src-tauri/binaries/ and, on
# Windows, the committed DLLs under pr-downloader-win-dll/ (a matched set from one
# RecoilEngine release — see that folder's SOURCE-recoil-release.txt). The output
# folder is gitignored; both CI (release.yml) and `bun tauri dev` run this script.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/src-tauri/binaries"
DEST="$ROOT/src-tauri/prdownloader"

os="$(uname -s)"
arch="$(uname -m)"
case "$os-$arch" in
  Darwin-arm64)
    TRIPLE=aarch64-apple-darwin; EXE="" ;;
  Linux-x86_64)
    TRIPLE=x86_64-unknown-linux-gnu; EXE="" ;;
  MINGW*-x86_64 | MSYS*-x86_64 | CYGWIN*-x86_64)
    TRIPLE=x86_64-pc-windows-msvc; EXE=".exe" ;;
  *)
    echo "No committed pr-downloader for $os-$arch (have: aarch64-apple-darwin, x86_64-unknown-linux-gnu, x86_64-pc-windows-msvc)" >&2
    exit 1 ;;
esac

BIN="$SRC/pr-downloader-${TRIPLE}${EXE}"
if [ ! -f "$BIN" ]; then
  echo "Missing committed sidecar: $BIN" >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST"
cp "$BIN" "$DEST/pr-downloader${EXE}"
chmod +x "$DEST/pr-downloader${EXE}" 2>/dev/null || true

# Windows: the binary needs its MinGW/curl DLLs in the same directory.
if [ "$EXE" = ".exe" ]; then
  cp "$SRC/pr-downloader-win-dll"/*.dll "$DEST/"
fi

echo "Assembled pr-downloader into $DEST:"
ls -1 "$DEST"
echo
echo "For 'bun tauri dev', if the sidecar isn't found via resource_dir(), export:"
echo "  export PRD_SIDECAR=$DEST/pr-downloader${EXE}"
