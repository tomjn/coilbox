#!/usr/bin/env bash
# Fetch the pinned Tachyon schema bundle, re-apply the local privateBattle.ip
# patch, and compare the result with the vendored copy. Dry run by default, so
# it doubles as a check that the vendored bundle really is the pinned version
# plus that one patch. Pass --write to install it.
#
# The pinned version is the single source of truth in
# crates/coilbox-tachyon-protocol/schema/upstream-version.txt. Editing it is how
# a refresh starts, and the rest of the procedure is in that folder's README.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCHEMA="$ROOT/crates/coilbox-tachyon-protocol/schema"
VERSION="$(tr -d '[:space:]' < "$SCHEMA/upstream-version.txt")"

WRITE=0
case "${1:-}" in
  --write) WRITE=1 ;;
  "") ;;
  *) echo "usage: bash scripts/tachyon-refresh.sh [--write]" >&2; exit 2 ;;
esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

URL="https://raw.githubusercontent.com/beyond-all-reason/tachyon/${VERSION}/schema/compiled.json"
echo "Fetching tachyon ${VERSION} ..."
if ! curl -fsSL -o "$TMP/upstream.json" "$URL"; then
  echo "Could not fetch $URL" >&2
  echo "Check that the tag in $SCHEMA/upstream-version.txt exists upstream." >&2
  exit 1
fi

# The patch only makes sense while upstream still types the game server's IP
# address as a uuid. Stop rather than patch over something that has moved.
IP="$(jq -c '.definitions.privateBattle.properties.ip' "$TMP/upstream.json")"
if [ "$IP" != '{"$ref":"#/definitions/battleId"}' ]; then
  echo "Upstream privateBattle.ip is now $IP, not the battleId uuid ref." >&2
  echo "The local patch may no longer be needed. Read $SCHEMA/README.md and decide before going on." >&2
  exit 1
fi

# jq owns the formatting of the vendored copy, so a refresh diff shows what
# upstream changed rather than a reformat.
jq '.definitions.privateBattle.properties.ip = {"type": "string", "x-coilbox-patched": "see schema/README.md"}' \
  "$TMP/upstream.json" > "$TMP/patched.json"

if cmp -s "$TMP/patched.json" "$SCHEMA/compiled.json"; then
  echo "The vendored bundle is tachyon ${VERSION} plus the local patch. Nothing to do."
  exit 0
fi

# One line per command and direction, which is the pair the envelope carries. A
# response is an anyOf of a success and a failure schema that share both, so the
# first member answers for the pair.
commands() {
  jq -r '.anyOf[] | (if .anyOf then .anyOf[0] else . end).properties
    | "\(.commandId.const) \(.type.const)"' "$1" | sort
}
commands "$SCHEMA/compiled.json" > "$TMP/old.txt"
commands "$TMP/patched.json" > "$TMP/new.txt"

echo
echo "Commands ${VERSION} adds:"
comm -13 "$TMP/old.txt" "$TMP/new.txt" | sed 's/^/  + /'
echo "Commands ${VERSION} drops:"
comm -23 "$TMP/old.txt" "$TMP/new.txt" | sed 's/^/  - /'
echo
echo "Lines of JSON changed: $(diff "$SCHEMA/compiled.json" "$TMP/patched.json" | grep -c '^[<>]' || true)"

if [ "$WRITE" -eq 0 ]; then
  echo
  echo "Dry run. Re-run with --write to install it."
  exit 0
fi

cp "$TMP/patched.json" "$SCHEMA/compiled.json"
echo
echo "Installed. Next:"
echo "  cargo test -p coilbox-tachyon-protocol"
echo "  git diff -- $SCHEMA/compiled.json"
