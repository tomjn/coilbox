#!/usr/bin/env bash
# Compile the NSIS installer's header and sidebar bitmaps.
#
# The Windows installer (issue #2375) otherwise ships as a stock NSIS dialog:
# no header strip, no welcome/finish artwork, nothing coilbox until the app
# itself opens. Tauri's NSIS bundler takes two branding bitmaps -
# `headerImage` (150x57, shown on every page after welcome) and
# `sidebarImage` (164x314, shown full-height on the welcome and finish pages)
# - referenced from `tauri.conf.json`'s `bundle.windows.nsis` block.
#
# NSIS wants real BMP files: BITMAPINFOHEADER (BMP3), 24-bit, uncompressed,
# no alpha channel, at the exact pixel dimensions above. A PNG renamed to
# .bmp, or a compressed/32-bit BMP, is a failure NSIS surfaces only at
# install time on a real Windows machine, which this repo cannot check.
#
# Source: `icons/icon.png`, the same dark rounded-square mark used for the
# macOS/Linux app icon. It is flattened onto its own interior background
# colour (sampled from the icon, not guessed) so the rounded-square edge
# disappears and only the white glyph remains, then that glyph is placed on
# a canvas of the same colour at each bitmap's exact size: right-aligned for
# the header strip, centred for the tall sidebar rather than stretched to
# fill it.
#
# The compiled bitmaps are committed, so builds and CI need no ImageMagick.
# Re-run this (locally, with ImageMagick installed) only when icon.png's
# artwork changes.
set -euo pipefail

if ! command -v magick >/dev/null 2>&1; then
  echo "error: ImageMagick's 'magick' command is required (brew install imagemagick)" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_PNG="$ROOT/src-tauri/icons/icon.png"
ICONS_DIR="$ROOT/src-tauri/icons"

if [[ ! -f "$SRC_PNG" ]]; then
  echo "error: $SRC_PNG not found" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Sample the icon's own interior fill (a point well inside the rounded
# square, away from the transparent corners) instead of hard-coding a colour.
BG="$(magick "$SRC_PNG" -format "%[pixel:p{256,256}]" info:)"

magick "$SRC_PNG" -background "$BG" -flatten "$TMP_DIR/flat.png"
magick "$TMP_DIR/flat.png" -bordercolor "$BG" -border 1 -fuzz 2% -trim +repage "$TMP_DIR/glyph.png"

# Header: 150x57, glyph right-aligned and vertically centred, 12px margin.
magick -size 150x57 "xc:$BG" "$TMP_DIR/header-bg.png"
magick "$TMP_DIR/glyph.png" -resize x41 "$TMP_DIR/glyph-header.png"
magick "$TMP_DIR/header-bg.png" "$TMP_DIR/glyph-header.png" \
  -gravity East -geometry +12+0 -composite "$TMP_DIR/header.png"
magick "$TMP_DIR/header.png" -alpha off -type TrueColor -depth 8 \
  "BMP3:$ICONS_DIR/nsis-header.bmp"

# Sidebar: 164x314, glyph centred at 60% of the canvas width rather than
# stretched to fill the tall, narrow strip.
magick -size 164x314 "xc:$BG" "$TMP_DIR/sidebar-bg.png"
magick "$TMP_DIR/glyph.png" -resize 98x "$TMP_DIR/glyph-sidebar.png"
magick "$TMP_DIR/sidebar-bg.png" "$TMP_DIR/glyph-sidebar.png" \
  -gravity Center -composite "$TMP_DIR/sidebar.png"
magick "$TMP_DIR/sidebar.png" -alpha off -type TrueColor -depth 8 \
  "BMP3:$ICONS_DIR/nsis-sidebar.bmp"

echo "wrote $ICONS_DIR/nsis-header.bmp"
echo "wrote $ICONS_DIR/nsis-sidebar.bmp"
