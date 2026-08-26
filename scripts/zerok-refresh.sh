#!/usr/bin/env bash
# Fetch Zero-K's protocol sources at the pinned commit and compare them with the
# vendored copies. Dry run by default, so it doubles as a check that what is
# vendored really is that commit. Pass --write to install it.
#
# The pinned commit is the single source of truth in
# crates/coilbox-zerok-protocol/upstream/upstream-version.txt, and the file list
# is in sources.txt beside it. Editing the commit is how a refresh starts. The
# rest of the procedure is in that folder's README.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM="$ROOT/crates/coilbox-zerok-protocol/upstream"
COMMIT="$(tr -d '[:space:]' < "$UPSTREAM/upstream-version.txt")"
REPO="ZeroK-RTS/Zero-K-Infrastructure"

WRITE=0
case "${1:-}" in
  --write) WRITE=1 ;;
  "") ;;
  *) echo "usage: bash scripts/zerok-refresh.sh [--write]" >&2; exit 2 ;;
esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Read into an array the long way round, because macOS still ships bash 3.2 and
# it has no mapfile.
PATHS=()
while IFS= read -r line; do
  PATHS+=("$line")
done < <(grep -v '^[[:space:]]*#' "$UPSTREAM/sources.txt" | grep -v '^[[:space:]]*$')

echo "Fetching ${REPO} at ${COMMIT} ..."
for path in "${PATHS[@]}"; do
  mkdir -p "$TMP/$(dirname "$path")"
  url="https://raw.githubusercontent.com/${REPO}/${COMMIT}/${path}"
  if ! curl -fsSL -o "$TMP/$path" "$url"; then
    echo "Could not fetch $url" >&2
    echo "Check that the commit in $UPSTREAM/upstream-version.txt exists and still has that file." >&2
    exit 1
  fi
done

# One line per command, which is the class name under a [Message(...)] attribute.
# The authoritative parse is build.rs. This is only here so a refresh reports what
# moved before anyone reads the diff.
commands() {
  awk '/\[Message\(/ { want = 1; next }
       want && /public class/ { print $3; want = 0 }' "$@" | sort
}
# Only files that are there, so this still works when sources.txt names one that
# has not been vendored yet.
protocol_files() {
  local base="$1" p
  for p in "${PATHS[@]}"; do
    case "$p" in
      */Protocol/*|*/UserBattleStatus.cs) [ -f "$base/$p" ] && echo "$base/$p" ;;
    esac
  done
  return 0
}

# shellcheck disable=SC2046  # the paths are ours and hold no spaces
commands $(protocol_files "$UPSTREAM") > "$TMP/old.txt"
# shellcheck disable=SC2046
commands $(protocol_files "$TMP") > "$TMP/new.txt"

changed=0
for path in "${PATHS[@]}"; do
  if ! cmp -s "$TMP/$path" "$UPSTREAM/$path"; then
    changed=$((changed + 1))
    echo "  changed: $path ($(diff "$UPSTREAM/$path" "$TMP/$path" | grep -c '^[<>]') lines)"
  fi
done

if [ "$changed" -eq 0 ]; then
  echo "The vendored sources are ${REPO} at ${COMMIT}. Nothing to do."
  exit 0
fi

echo
echo "Commands this commit adds:"
comm -13 "$TMP/old.txt" "$TMP/new.txt" | sed 's/^/  + /'
echo "Commands this commit drops:"
comm -23 "$TMP/old.txt" "$TMP/new.txt" | sed 's/^/  - /'

if [ "$WRITE" -eq 0 ]; then
  echo
  echo "Dry run. Re-run with --write to install it."
  exit 0
fi

for path in "${PATHS[@]}"; do
  mkdir -p "$UPSTREAM/$(dirname "$path")"
  cp "$TMP/$path" "$UPSTREAM/$path"
done
echo
echo "Installed. Next:"
echo "  cargo test -p coilbox-zerok-protocol"
echo "  git diff -- $UPSTREAM"
