#!/usr/bin/env bash
# Compile a Windows-specific taskbar icon.
#
# `icons/icon.ico` was generated from the same padded artwork as the macOS
# icon: a wide margin is baked in around the mark, because macOS supplies its
# own rounded-square container and expects the artwork to sit inside a safe
# area. Windows draws an .ico exactly as given, with no container, so that
# margin becomes empty space and the mark looks undersized on the taskbar
# (issue #2378). Microsoft's own guidance is that the "target size" icon
# variants Windows uses for the taskbar are shown without tile padding:
# https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-construction
#
# This script takes the same source artwork (`icons/icon.png`), crops it to
# its opaque bounding box, and re-pads it to a much smaller, fixed margin
# before regenerating a Windows-only `.ico` via the `tauri icon` CLI. The
# macOS/Linux icons (icon.icns, 32x32.png, 128x128.png, 128x128@2x.png) are
# untouched. Only `icons/icon-windows.ico` is written.
#
# The compiled icon-windows.ico is committed, so builds and CI need no
# ImageMagick. Re-run this (locally, with ImageMagick installed) only when
# icon.png's artwork changes.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_PNG="$ROOT/src-tauri/icons/icon.png"
DEST="$ROOT/src-tauri/icons/icon-windows.ico"

if ! command -v magick >/dev/null 2>&1; then
  echo "error: ImageMagick's 'magick' command is required (brew install imagemagick)" >&2
  exit 1
fi

if [[ ! -f "$SRC_PNG" ]]; then
  echo "error: $SRC_PNG not found" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Target fill: the artwork should occupy 96% of the master canvas. There is
# no single documented Microsoft number for this, it is a judgement call
# informed by the "no tile padding" taskbar guidance above, chosen to sit
# well clear of the macOS-style 81% while leaving a small margin so the
# rounded-square plate doesn't get clipped at the canvas edge.
MASTER_SIZE=1024
FILL_PCT=96
CONTENT_SIZE=$(( MASTER_SIZE * FILL_PCT / 100 ))

# Crop to the opaque bounding box of the existing artwork, then re-pad it
# onto a square canvas at the target fill percentage.
magick "$SRC_PNG" -trim +repage "$TMP_DIR/cropped.png"
magick "$TMP_DIR/cropped.png" \
  -resize "${CONTENT_SIZE}x${CONTENT_SIZE}" \
  -background none -gravity center -extent "${MASTER_SIZE}x${MASTER_SIZE}" \
  "$TMP_DIR/windows-source.png"

# Generate a full icon set from the padded-down source, then keep only the
# .ico. `tauri icon` also writes macOS/Linux/Android/iOS assets into the
# output directory. Those are discarded, not the committed ones.
( cd "$ROOT" && bunx tauri icon "$TMP_DIR/windows-source.png" -o "$TMP_DIR/out" >/dev/null )

cp "$TMP_DIR/out/icon.ico" "$DEST"
echo "wrote $DEST"
