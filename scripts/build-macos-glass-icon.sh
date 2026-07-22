#!/usr/bin/env bash
# Compile the macOS Tahoe Liquid Glass app icon.
#
# macOS 26 (Tahoe) only renders its glass icon material for apps that ship an
# Icon Composer `.icon` compiled into an `Assets.car` asset catalogue, with
# `CFBundleIconName` set in Info.plist. Tauri's `bundle.icon` pipeline only emits
# a legacy `.icns`, which Tahoe shows flat ("icon jail"). This script compiles
# `src-tauri/coilbox.icon` into `src-tauri/icons/macos/Assets.car`, which is then
# placed at `Contents/Resources/Assets.car` via `bundle.macOS.files` in
# tauri.conf.json. The legacy `.icns` stays as the pre-Tahoe fallback.
#
# The compiled Assets.car is committed, so builds and CI need no Xcode/actool.
# Re-run this (on a Mac with Xcode) only when coilbox.icon changes.
set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "skip: macOS glass icon is only built on macOS (uname=$(uname))"
  exit 0
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ICON="$ROOT/src-tauri/coilbox.icon"
DEST_DIR="$ROOT/src-tauri/icons/macos"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

if [[ ! -d "$ICON" ]]; then
  echo "error: $ICON not found" >&2
  exit 1
fi

# `coilbox` here is the asset name; it must match CFBundleIconName in Info.plist.
xcrun actool \
  --compile "$TMP_DIR" \
  --app-icon coilbox \
  --output-partial-info-plist "$TMP_DIR/partial.plist" \
  --platform macosx \
  --minimum-deployment-target 26 \
  --errors --warnings \
  "$ICON" >/dev/null

mkdir -p "$DEST_DIR"
cp "$TMP_DIR/Assets.car" "$DEST_DIR/Assets.car"
echo "wrote $DEST_DIR/Assets.car"
