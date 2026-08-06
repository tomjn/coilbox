#!/usr/bin/env bash
# Prove that a game's own condition and action types run (issue #776).
#
# scripts/mission-sf-proof.sh proves the adoption contract on SplinterFaction:
# the runtime loads out of the game, and the game's start and ending give way to
# the mission. This asks the other question that only a real game can answer.
# Does a trigger naming a type coilbox has never heard of reach the game's own
# code, with the parameters the mission wrote?
#
# It plays a mission whose action pays research points into SplinterFaction's own
# ledger and whose condition waits on the balance. Neither type is coilbox's, and
# the number the probe quotes is the game's `researchPoints` team rules param,
# which nothing in coilbox can write.
#
# Three files are written into the game and removed again on the way out, unless
# --keep is passed:
#
#   missions/extensions.lua                  the declaration, both halves read
#   luarules/mission_extensions/research.lua the handler, the game's own code
#   missions/extension/mission.lua           the compiled mission
#
# The first two would be Splinter Faction's own files if it had adopted them.
# They live in scripts/sf-extension/ because they are the proof's rather than the
# game's, and because a game that has never seen a coilbox scenario should not
# have to carry them to be proved against.
#
# Usage: scripts/mission-sf-extension.sh [--keep]
#
#   COILBOX_SPRING_HEADLESS  the binary. Default is spring-headless in
#                            COILBOX_SPRING_DATA, then one on PATH.
#   COILBOX_SPRING_DATA      where games/ and maps/ are. Default ~/.spring.
#   COILBOX_SF_GAME          the game folder under games/. It must be a loose
#                            .sdd, and the runtime is installed into it. Default
#                            SplinterFaction.sdd.
#   COILBOX_HARNESS_MAP      the map archive's filename under maps/. Default the
#                            first one there.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/scripts/sf-extension"
MISSION_ID=extension

KEEP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) KEEP=1 ;;
    *)
      echo "unknown argument: $1" >&2
      echo "usage: scripts/mission-sf-extension.sh [--keep]" >&2
      exit 2
      ;;
  esac
  shift
done

DATA_DIR="${COILBOX_SPRING_DATA:-$HOME/.spring}"
SF_GAME="${COILBOX_SF_GAME:-SplinterFaction.sdd}"
SF_DIR="$DATA_DIR/games/$SF_GAME"

ENGINE="${COILBOX_SPRING_HEADLESS:-}"
if [ -z "$ENGINE" ]; then
  if [ -x "$DATA_DIR/spring-headless" ]; then
    ENGINE="$DATA_DIR/spring-headless"
  else
    ENGINE="$(command -v spring-headless || true)"
  fi
fi
if [ -z "$ENGINE" ] || [ ! -x "$ENGINE" ]; then
  echo "no headless engine. Set COILBOX_SPRING_HEADLESS to a spring-headless binary" >&2
  exit 2
fi

[ -d "$SF_DIR" ] || { echo "no loose game at $SF_DIR" >&2; exit 2; }
# The game's own file, if it ever has one. Overwriting it would be writing over
# something a maintainer wrote, so this stops instead. Checked before the install
# below, which never writes this file but does create the folder it sits in.
[ -e "$SF_DIR/missions/extensions.lua" ] && {
  echo "$SF_GAME already has missions/extensions.lua, which is the game's own." >&2
  echo "Move it aside to run this proof against the one in scripts/sf-extension/." >&2
  exit 2
}

# What a game declares is only worth proving against the runtime that reads it,
# so the runtime goes in the way coilbox puts it in (issue #934).
RUNTIME="$(bash "$ROOT/scripts/mission-runtime-install.sh" "$SF_DIR")"
read -r RUNTIME_VERSION RUNTIME_FILES <<<"$RUNTIME"

MAP_ARCHIVE="${COILBOX_HARNESS_MAP:-}"
if [ -z "$MAP_ARCHIVE" ]; then
  MAP_ARCHIVE="$(ls "$DATA_DIR/maps" | grep -v '\.md5\.gz$' | grep -E '\.sd[7z]$' | sort | head -n 1 || true)"
  [ -n "$MAP_ARCHIVE" ] || { echo "no map in $DATA_DIR/maps" >&2; exit 2; }
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/coilbox-sf-extension.XXXXXX")"
PROBE_GAME="$WORK/data/games/coilbox-sf-extension.sdd"

mkdir -p "$WORK/data/games" "$WORK/data/maps" "$WORK/write"
ln -s "$DATA_DIR/base" "$WORK/data/base"
ln -s "$SF_DIR" "$WORK/data/games/$SF_GAME"
ln -s "$DATA_DIR/maps/$MAP_ARCHIVE" "$WORK/data/maps/$MAP_ARCHIVE"

# What the game would ship if it had adopted extensions, plus the mission, all
# where coilbox's own launch path puts a mission.
MISSION_DIR="$SF_DIR/missions/$MISSION_ID"
HANDLER_DIR="$SF_DIR/luarules/mission_extensions"
mkdir -p "$MISSION_DIR" "$HANDLER_DIR"
cp "$SRC/mission.lua" "$MISSION_DIR/mission.lua"
cp "$SRC/extensions.lua" "$SF_DIR/missions/extensions.lua"
cp "$SRC/research.lua" "$HANDLER_DIR/research.lua"
# Only what was copied in, and the handler's folder only when nothing else is in
# it. The game's own files are not this script's to remove.
cleanup() {
  if [ "$KEEP" = 1 ]; then
    return
  fi
  rm -rf "$MISSION_DIR"
  rm -f "$SF_DIR/missions/extensions.lua" "$HANDLER_DIR/research.lua"
  rmdir "$HANDLER_DIR" 2>/dev/null || true
}
trap cleanup EXIT

engine() {
  "$ENGINE" --isolation --isolation-dir "$WORK/data" --write-dir "$WORK/write" --only-local "$@"
}

CACHE="$WORK/write/cache/ArchiveCache22.lua"

archive_name() { # archive filename, modtype
  [ -f "$CACHE" ] || return 0
  CACHE="$CACHE" ARCHIVE="$1" MODTYPE="$2" luajit -e '
    local cache = dofile(os.getenv("CACHE"))
    for _, archive in ipairs(cache.archives or {}) do
      local data = archive.archivedata or {}
      if archive.name == os.getenv("ARCHIVE")
        and tostring(data.modtype) == os.getenv("MODTYPE") then
        print(data.name)
        return
      end
    end
  '
}

# A start script names a game and a map by the name its archive declares, and
# only the engine knows what that is. Every run scans the archives and writes the
# cache before it looks at anything else, so a deliberate failure fills it in.
discover() {
  engine --calc-checksum coilbox-sf-extension-discovery >"$WORK/discover.log" 2>&1 || true
}

discover
BASE_NAME="$(archive_name "$SF_GAME" 1)"
MAP_NAME="$(archive_name "$MAP_ARCHIVE" 3)"
if [ -z "$BASE_NAME" ] || [ -z "$MAP_NAME" ]; then
  echo "the engine did not recognise $SF_GAME as a game or $MAP_ARCHIVE as a map" >&2
  exit 2
fi

# Named to sort last so the probe reads a frame every other gadget, the game's
# and the runtime's alike, has finished with.
mkdir -p "$PROBE_GAME/LuaRules/Gadgets"
cp "$SRC/probe.lua" "$PROBE_GAME/LuaRules/Gadgets/zzz_coilbox_sf_extension.lua"
sed "s|@BASE@|$BASE_NAME|g" "$SRC/modinfo.lua" >"$PROBE_GAME/modinfo.lua"

discover
PROBE_NAME="$(archive_name coilbox-sf-extension.sdd 1)"
if [ -z "$PROBE_NAME" ]; then
  echo "the engine did not recognise the probe mutator, see $WORK/discover.log" >&2
  exit 2
fi

echo "engine:     $ENGINE"
echo "game:       $BASE_NAME ($SF_GAME)"
echo "mutator:    $PROBE_NAME"
echo "map:        $MAP_NAME"
echo "mission:    $MISSION_DIR/mission.lua"
echo "runtime:    version $RUNTIME_VERSION, $RUNTIME_FILES files from lua/mission-runtime"
echo "extensions: $SF_DIR/missions/extensions.lua"
echo "handler:    $HANDLER_DIR/research.lua"
echo

LOG="$WORK/$MISSION_ID.log"
SCRIPT="$WORK/$MISSION_ID.script.txt"

MODOPTIONS="$(printf '\t\tcoilbox_mission=%s\x3b' "$MISSION_ID")" \
  GAME_NAME="$PROBE_NAME" MAP_NAME="$MAP_NAME" \
  TEMPLATE="$ROOT/scripts/sf-proof/start-script.tdf" SCRIPT="$SCRIPT" \
  luajit -e '
    local template = io.open(os.getenv("TEMPLATE")):read("*a")
    template = template:gsub("@GAME@", os.getenv("GAME_NAME"))
    template = template:gsub("@MAP@", os.getenv("MAP_NAME"))
    template = template:gsub("@MODOPTIONS@", (os.getenv("MODOPTIONS"):gsub("%%", "%%%%")))
    local out = io.open(os.getenv("SCRIPT"), "w")
    out:write(template)
    out:close()
  '

if ! engine "$SCRIPT" >"$LOG" 2>&1; then
  echo "the engine exited nonzero, see $LOG"
  exit 1
fi

grep 'HARNESS note ' "$LOG" | sed 's/^.*HARNESS note /  note /' || true
grep 'HARNESS fail ' "$LOG" | sed 's/^.*HARNESS fail /  fail /' || true

passed=$(grep -c 'HARNESS ok ' "$LOG" || true)
failed=$(grep -c 'HARNESS fail ' "$LOG" || true)

if [ "$(grep -ci 'Loaded synced gadget: *Coilbox mission runtime' "$LOG" || true)" -eq 0 ]; then
  echo "  fail the vendored runtime gadget did not load"
  failed=$((failed + 1))
fi

# The refusal in the runtime's own words. The declaration names time_elapsed on
# purpose, so this line is the boundary holding rather than something going
# wrong, and it is the one runtime error this proof expects.
REFUSAL="time_elapsed is the runtime's own type"
if grep -qF "$REFUSAL" "$LOG"; then
  echo "  ok the runtime said why it refused the type: $REFUSAL"
  passed=$((passed + 1))
else
  echo "  fail the runtime never refused the declared time_elapsed"
  failed=$((failed + 1))
fi

errors=$(grep '\[coilbox-mission\] Error' "$LOG" | grep -vcF "$REFUSAL" || true)
if [ "$errors" -gt 0 ]; then
  grep '\[coilbox-mission\] Error' "$LOG" | grep -vF "$REFUSAL" \
    | sed 's/^.*\[coilbox-mission\] /  fail runtime /'
  failed=$((failed + errors))
fi
if grep -q 'Removed gadget: *Coilbox' "$LOG"; then
  echo "  fail the gadget handler removed a coilbox gadget"
  failed=$((failed + 1))
fi
if [ "$(grep -c 'HARNESS done' "$LOG" || true)" -eq 0 ]; then
  echo "  fail the probe never reached the end of its plan"
  failed=$((failed + 1))
fi

echo
echo "  $passed passed, $failed failed"
if [ "$failed" -eq 0 ]; then
  rm -r "$WORK"
  echo "all passed"
else
  echo "the engine log is in $LOG"
  exit 1
fi
