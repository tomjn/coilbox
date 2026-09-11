#!/usr/bin/env bash
# Build one or more of our own sidecar crates (coilbox-unitsync-worker,
# coilbox-relay-agent) for the host platform and place each in
# src-tauri/binaries/ with the target-triple suffix Tauri's externalBin
# bundling expects. These are workspace crates (not committed prebuilts like
# pr-downloader/uberstress), so they're build artifacts - gitignored, rebuilt
# by CI per platform, and produced locally by this script before
# `tauri dev`/`build`.
#
# Pass every crate you want in one call: a single `cargo build` plans all of
# them together, so shared dependencies build once and the final crates
# compile in parallel, instead of one `cargo build` per crate in turn.
#
# Usage: build-sidecars.sh [--profile release|dev] [--timings] <crate-name>...
#
# Defaults to the release profile, which is what a real bundle needs
# (`tauri dev`/`build`, release.yml). lint.yml passes --profile dev: clippy
# and `cargo test --workspace` only ever exercise the dev and test profiles,
# and `cargo test --workspace` already builds the dev worker at
# target/debug/coilbox-unitsync-worker, the same path the sidecar tests in
# crates/tauri-plugin-coilbox-unitsync/src/sidecar.rs run it from. Building
# release there compiled an optimised copy nothing in the job ever used, and
# risked a release binary landing at that debug path (issue #2807).
#
# --timings writes a build-time report to target/cargo-timings/ (issue #2801),
# so a release run can show which sidecar crate holds up the job.
set -euo pipefail
cd "$(dirname "$0")/.."

PROFILE="release"
TIMINGS=0
while [ "$#" -gt 0 ]; do
  case "$1" in
  --profile)
    PROFILE="${2:?--profile needs a value}"
    shift 2
    ;;
  --timings)
    TIMINGS=1
    shift
    ;;
  *)
    break
    ;;
  esac
done

if [ "$#" -eq 0 ]; then
  echo "Usage: $0 [--profile release|dev] [--timings] <crate-name>..." >&2
  exit 1
fi

case "$PROFILE" in
release)
  CARGO_PROFILE_ARGS=(--release)
  TARGET_SUBDIR="release"
  ;;
dev)
  CARGO_PROFILE_ARGS=()
  TARGET_SUBDIR="debug"
  ;;
*)
  echo "Unknown profile: $PROFILE (expected release or dev)" >&2
  exit 1
  ;;
esac

TRIPLE="$(rustc -Vv | sed -n 's/^host: //p')"
EXE=""
case "$TRIPLE" in
*windows*) EXE=".exe" ;;
esac

CARGO_ARGS=()
for CRATE in "$@"; do
  CARGO_ARGS+=(-p "$CRATE")
done

TIMING_ARGS=()
if [ "$TIMINGS" -eq 1 ]; then
  TIMING_ARGS+=(--timings)
fi

cargo build "${CARGO_ARGS[@]}" "${CARGO_PROFILE_ARGS[@]}" "${TIMING_ARGS[@]}"
mkdir -p src-tauri/binaries
for CRATE in "$@"; do
  cp "target/${TARGET_SUBDIR}/${CRATE}${EXE}" \
    "src-tauri/binaries/${CRATE}-${TRIPLE}${EXE}"
  echo "Built src-tauri/binaries/${CRATE}-${TRIPLE}${EXE}"
done
