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
# macOS/Linux app icon. Its interior background colour (sampled from the
# icon, not guessed) is used as the sidebar's canvas colour, with the white
# glyph trimmed to its own bounding box and centred on it rather than
# stretched to fill the tall strip.
#
# The header strip is a different shape: a short, wide bar that sits beside
# a white dialog page, not a full-height splash. Filling that bar with the
# icon's dark interior colour reads as a large black block next to the page
# (issue #3145), so the header instead gets the glyph rendered in the dark
# colour on a white canvas matching the surrounding dialog, right-aligned
# next to the page title NSIS draws to its right.
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
magick "$TMP_DIR/flat.png" -bordercolor "$BG" -border 1 -fuzz 2% -trim "$TMP_DIR/glyph.png"

# The glyph's own bounding box, in the source PNG's coordinates (used below
# to crop a transparent-background version of the same glyph for the
# header, without carrying the square's dark fill along with it). The trim
# above ran on an image bordered by 1px, so its reported offset is 1px past
# the position in the original, untouched source.
read -r GLYPH_W GLYPH_H GLYPH_X GLYPH_Y <<<"$(magick "$TMP_DIR/glyph.png" \
  -format "%w %h %X %Y" info:)"
magick "$SRC_PNG" -fuzz 12% -transparent "$BG" \
  -crop "${GLYPH_W}x${GLYPH_H}+$((GLYPH_X - 1))+$((GLYPH_Y - 1))" +repage \
  "$TMP_DIR/glyph-transparent.png"

# Header: 150x57, white canvas (matching the dialog page beside it) with the
# glyph recoloured to the icon's dark colour, right-aligned, 12px margin.
magick -size 150x57 xc:white "$TMP_DIR/header-bg.png"
magick "$TMP_DIR/glyph-transparent.png" -resize x41 \
  -fill "$BG" -colorize 100% "$TMP_DIR/glyph-header.png"
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
