#!/usr/bin/env bash
#
# Rebuilds the docs homepage gallery thumbnails from the full-size screenshots.
#
# The gallery in docs/index.md shows each screenshot twice: once as a grid
# thumbnail and once at full size inside its lightbox. Serving the 3000px
# captures for both put 11 MB on the landing page, so the grid points at these
# downscaled copies instead and the full-size ones are marked loading="lazy",
# which holds them back until an overlay is actually opened.
#
# 640px wide covers the grid's widest real column (roughly 270 CSS px) at 2x.
# WebP rather than PNG because it is a tenth of the size at this scale, and
# rather than AVIF because the two come out the same size here while WebP has
# shipped in every browser since 2020, where AVIF reached Safari in 2023 and
# Edge in 2024.
#
# Needs cwebp, which sips cannot stand in for: it reads WebP but only writes
# AVIF. Install with: brew install webp
#
# Run after adding or replacing anything in docs/public/screenshots:
#   bun run docs:thumbs

set -euo pipefail

cd "$(dirname "$0")/.."

src="docs/public/screenshots"
out="$src/thumbs"

if ! command -v cwebp >/dev/null; then
  echo "cwebp not found. Install it with: brew install webp" >&2
  exit 1
fi

mkdir -p "$out"

for f in "$src"/*.png; do
  name=$(basename "$f" .png)
  sips --resampleWidth 640 "$f" --out "$out/$name.png" >/dev/null
  cwebp -quiet -q 82 "$out/$name.png" -o "$out/$name.webp"
  rm "$out/$name.png"
  echo "$name.webp"
done
