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
BIN="$ROOT/src-tauri/binaries"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$BIN"

echo "Fetching $ASSET ..."
if command -v gh >/dev/null 2>&1; then
  gh release download "$VER" --repo tomjn/SpringMapConvNG --pattern "$ASSET" --dir "$TMP"
else
  curl -fSL -o "$TMP/$ASSET" "https://github.com/tomjn/SpringMapConvNG/releases/download/${VER}/${ASSET}"
fi
tar -xzf "$TMP/$ASSET" -C "$TMP"
cp "$TMP/mapcompile${EXE}" "$BIN/mapcompile-${TRIPLE}${EXE}"
cp "$TMP/mapdecompile${EXE}" "$BIN/mapdecompile-${TRIPLE}${EXE}"
chmod +x "$BIN/mapcompile-${TRIPLE}${EXE}" "$BIN/mapdecompile-${TRIPLE}${EXE}" 2>/dev/null || true

# The mac/Windows binaries load bundled image libs via @executable_path/libs
# (DevIL etc.), so the libs/ folder must sit next to them. Keep it.
if [ -d "$TMP/libs" ]; then
  rm -rf "$BIN/libs"
  cp -R "$TMP/libs" "$BIN/libs"
fi

echo "Installed:"
echo "  $BIN/mapcompile-${TRIPLE}${EXE}"
echo "  $BIN/mapdecompile-${TRIPLE}${EXE}"
[ -d "$BIN/libs" ] && echo "  $BIN/libs/ (bundled image libraries)"
echo
echo "For 'bun tauri dev' (binaries are not copied next to the dev exe), export:"
echo "  export MAPCONV_MAPCOMPILE_SIDECAR=$BIN/mapcompile-${TRIPLE}${EXE}"
echo "  export MAPCONV_MAPDECOMPILE_SIDECAR=$BIN/mapdecompile-${TRIPLE}${EXE}"
