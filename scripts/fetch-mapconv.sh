#!/usr/bin/env bash
# Fetch the pinned SpringMapConvNG sidecars into src-tauri/binaries/ for local
# development. These binaries are gitignored; CI fetches them the same way at
# release time (see .github/workflows/release.yml). The pinned version is the
# single source of truth in scripts/springmapconvng-version.txt.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VER="$(tr -d '[:space:]' < "$ROOT/scripts/springmapconvng-version.txt")"

os="$(uname -s)"
arch="$(uname -m)"
case "$os-$arch" in
  Darwin-arm64)
    PLAT=macos-arm64; TRIPLE=aarch64-apple-darwin; EXE="" ;;
  Linux-x86_64)
    PLAT=linux-x86_64; TRIPLE=x86_64-unknown-linux-gnu; EXE="" ;;
  MINGW*-x86_64 | MSYS*-x86_64 | CYGWIN*-x86_64)
    PLAT=windows-x86_64; TRIPLE=x86_64-pc-windows-msvc; EXE=".exe" ;;
  *)
    echo "No SpringMapConvNG release asset for $os-$arch (released: macos-arm64, linux-x86_64, windows-x86_64)" >&2
    exit 1 ;;
esac

ASSET="SpringMapConvNG-${VER}-${PLAT}.tar.gz"
# Bundled as a Tauri resource folder (binaries + their libs/), resolved at
# runtime via resource_dir() — NOT externalBin, which can't carry libs/.
DEST="$ROOT/src-tauri/mapconv"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
rm -rf "$DEST"
mkdir -p "$DEST"

echo "Fetching $ASSET ..."
if command -v gh >/dev/null 2>&1; then
  gh release download "$VER" --repo tomjn/SpringMapConvNG --pattern "$ASSET" --dir "$TMP"
else
  curl -fSL -o "$TMP/$ASSET" "https://github.com/tomjn/SpringMapConvNG/releases/download/${VER}/${ASSET}"
fi
tar -xzf "$TMP/$ASSET" -C "$TMP"
cp "$TMP/mapcompile${EXE}" "$DEST/mapcompile${EXE}"
cp "$TMP/mapdecompile${EXE}" "$DEST/mapdecompile${EXE}"
chmod +x "$DEST/mapcompile${EXE}" "$DEST/mapdecompile${EXE}" 2>/dev/null || true
# Keep the libs/ folder beside the binaries (@executable_path/libs).
if [ -d "$TMP/libs" ]; then
  cp -R "$TMP/libs" "$DEST/libs"
fi

echo "Installed into $DEST:"
echo "  mapcompile${EXE}, mapdecompile${EXE}"
[ -d "$DEST/libs" ] && echo "  libs/ (bundled image libraries)"
echo
echo "For 'bun tauri dev', export:"
echo "  export MAPCONV_MAPCOMPILE_SIDECAR=$DEST/mapcompile${EXE}"
echo "  export MAPCONV_MAPDECOMPILE_SIDECAR=$DEST/mapdecompile${EXE}"
