#!/usr/bin/env bash
# Generate a `.coilbox` portable fixture full of local media, for exercising the
# `coilbox://` asset protocol end-to-end (profile welcome, campaign media, mission
# AV) under `bun tauri dev`. Media only — the JSON documents (profile.json, the
# campaign) are written separately. Requires ffmpeg + ImageMagick (magick).
#
# Usage: scripts/make-test-coilbox.sh [dest-.coilbox-dir]
# Default dest: target/debug/.coilbox (the workspace-root target dir, next to the
# dev binary `tauri dev` builds and runs, where coilbox-portable looks for `.coilbox`).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${1:-$ROOT/target/debug/.coilbox}"

mkdir -p "$DEST"/{images,fonts,briefings,data/campaign/campaigns}

echo "fixture -> $DEST"

# A labelled still image (profile welcome + campaign inline image + icon).
LABEL_FONT="/System/Library/Fonts/Supplemental/Arial.ttf"
[ -f "$LABEL_FONT" ] || LABEL_FONT="/System/Library/Fonts/Supplemental/Comic Sans MS.ttf"
magick -size 640x360 gradient:navy-teal -gravity center -font "$LABEL_FONT" \
  -pointsize 44 -fill white -annotate 0 "test.jpeg via coilbox://" \
  "$DEST/images/test.jpeg"

# An animated GIF (profile CSS background + inline briefing image).
magick -delay 25 -loop 0 \
  -size 200x120 xc:crimson xc:darkorange xc:seagreen \
  "$DEST/images/anim.gif"

# A silent, wide, looping video for the panorama / video background.
ffmpeg -y -loglevel error \
  -f lavfi -i "testsrc2=size=1920x480:rate=30:duration=6" \
  -c:v libx264 -pix_fmt yuv420p -an "$DEST/images/pano.mp4"

# A longer video WITH audio (cutscene + inline briefing video) — long enough that
# scrubbing the timeline is a meaningful test of Range/206 serving.
ffmpeg -y -loglevel error \
  -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=12" \
  -f lavfi -i "sine=frequency=330:duration=12" \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$DEST/briefings/intro.mp4"

# A short audio clip (voiceover + inline briefing audio). mp3/aac play in WKWebView
# (macOS); Ogg/Vorbis does not, so avoid it. Prefer mp3, fall back to aac/m4a.
if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libmp3lame; then
  VO="$DEST/briefings/vo.mp3"
  ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=440:duration=5" \
    -c:a libmp3lame "$VO"
else
  VO="$DEST/briefings/vo.m4a"
  ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=440:duration=5" \
    -c:a aac "$VO"
fi
echo "voiceover: $(basename "$VO")"

# A distinctive font so a successful @font-face swap is unmistakable.
cp "/System/Library/Fonts/Supplemental/Chalkduster.ttf" "$DEST/fonts/brand.ttf"

echo "media generated:"
ls -la "$DEST/images" "$DEST/briefings" "$DEST/fonts"
