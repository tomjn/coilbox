#!/usr/bin/env bash
# Play "Silence the Jericho" on SplinterFaction, headless (issue #773).
#
# scripts/mission-sf-proof.sh proves the adoption contract with the smallest
# mission that can prove it. This is the other half of the same question: a real
# mission, built in the Scenario Builder on a game the runtime was not developed
# against, played through to its ending.
#
# It is deliberately a copy of that script's shape rather than a parameter on it.
# The two ask different questions of different missions, and the proof's
# assertions are about the start where these are about a mission being won.
#
# The mission itself comes out of the repo, from the fixture corpus, and it is
# exactly what the editor's "Test in game" wrote. It is copied to
# missions/<id>/mission.lua inside the game, which is where coilbox's own launch
# path puts one, and removed again unless --keep-mission. The id is the scenario
# document's own, which the editor generates, so it is a UUID rather than a name.
#
# Usage: scripts/mission-sf-jericho.sh [--keep-mission] [--keep-log]
#
#   --keep-log  leave the engine's infolog behind on a passing run too, which is
#               where the runtime's own account of the ending is.
#
#   COILBOX_SPRING_HEADLESS  the binary. Default is the first spring-headless
#                            with base content beside it or in the data
#                            directory: loose in COILBOX_SPRING_DATA, then the
#                            installed engines under its engine/, then PATH.
#   COILBOX_SPRING_DATA      where games/ and maps/ are. Default ~/.spring.
#   COILBOX_SF_GAME          the game folder under games/. It must be a loose
#                            .sdd, and the runtime is installed into it. Default
#                            SplinterFaction.sdd.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROOF="$ROOT/scripts/sf-proof"
# The scenario's own id, which is what the compiled mission and the probe both
# name. A mission is found at missions/<id>/, so this is a path component.
MISSION_ID=98794cb1-b697-4b7e-a739-f565a5008b85
MISSION_SRC="$ROOT/src/scenario/fixtures/missions/$MISSION_ID/mission.lua"
# The mission plays on the map it was authored against and no other, because its
# zones are map coordinates.
MAP_ARCHIVE_DEFAULT=acidicquarry_5.17.sd7

KEEP_MISSION=0
KEEP_LOG=0
while [ $# -gt 0 ]; do
  case "$1" in
    --keep-mission) KEEP_MISSION=1 ;;
    --keep-log) KEEP_LOG=1 ;;
    *)
      echo "unknown argument: $1" >&2
      echo "usage: scripts/mission-sf-jericho.sh [--keep-mission] [--keep-log]" >&2
      exit 2
      ;;
  esac
  shift
done

DATA_DIR="${COILBOX_SPRING_DATA:-$HOME/.spring}"
SF_GAME="${COILBOX_SF_GAME:-SplinterFaction.sdd}"
SF_DIR="$DATA_DIR/games/$SF_GAME"

# The engine and the base content to run it on, shared with every harness.
. "$ROOT/scripts/mission-engine.sh"

[ -d "$SF_DIR" ] || { echo "no loose game at $SF_DIR" >&2; exit 2; }
[ -f "$MISSION_SRC" ] || { echo "no compiled mission at $MISSION_SRC" >&2; exit 2; }

# The runtime this repo ships, installed the way coilbox installs it, so the
# mission is played by the runtime under review rather than by whatever the game
# was left holding (issue #934).
RUNTIME="$(bash "$ROOT/scripts/mission-runtime-install.sh" "$SF_DIR")"
read -r RUNTIME_VERSION RUNTIME_FILES <<<"$RUNTIME"

# The same three guards the adoption proof asks for. This script never writes
# them: scripts/mission-sf-proof.sh --apply-guards is where that lives.
GAME_END="$SF_DIR/LuaRules/Gadgets/game_end.lua"
missing=()
grep -q 'GG\.CoilboxMission' "$GAME_END" 2>/dev/null ||
  missing+=("LuaRules/Gadgets/game_end.lua: the Spring.GameOver guard")
if [ "${#missing[@]}" -ne 0 ]; then
  echo "$SF_GAME is missing the mission runtime guards it needs:" >&2
  printf '  %s\n' "${missing[@]}" >&2
  echo "Apply them with scripts/mission-sf-proof.sh --apply-guards" >&2
  exit 2
fi

MAP_ARCHIVE="${COILBOX_HARNESS_MAP:-$MAP_ARCHIVE_DEFAULT}"
[ -f "$DATA_DIR/maps/$MAP_ARCHIVE" ] || {
  echo "the mission is authored on $MAP_ARCHIVE and it is not in $DATA_DIR/maps" >&2
  exit 2
}

WORK="$(mktemp -d "${TMPDIR:-/tmp}/coilbox-sf-jericho.XXXXXX")"
PROBE_GAME="$WORK/data/games/coilbox-sf-probe.sdd"

mkdir -p "$WORK/data/games" "$WORK/data/maps" "$WORK/write"
ln -s "$BASE_CONTENT" "$WORK/data/base"
ln -s "$SF_DIR" "$WORK/data/games/$SF_GAME"
ln -s "$DATA_DIR/maps/$MAP_ARCHIVE" "$WORK/data/maps/$MAP_ARCHIVE"

MISSION_DIR="$SF_DIR/missions/$MISSION_ID"
mkdir -p "$MISSION_DIR"
cp "$MISSION_SRC" "$MISSION_DIR/mission.lua"
cleanup() {
  [ "$KEEP_MISSION" = 1 ] || rm -rf "$MISSION_DIR"
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
# only the engine knows what that is. The probe mutator is deliberately absent on
# the first pass: an archive read before it had a modinfo.lua would be remembered
# as no game at all.
discover() {
  engine --calc-checksum coilbox-sf-jericho-discovery >"$WORK/discover.log" 2>&1 || true
}

discover
BASE_NAME="$(archive_name "$SF_GAME" 1)"
MAP_NAME="$(archive_name "$MAP_ARCHIVE" 3)"
if [ -z "$BASE_NAME" ] || [ -z "$MAP_NAME" ]; then
  echo "the engine did not recognise $SF_GAME as a game or $MAP_ARCHIVE as a map" >&2
  exit 2
fi

mkdir -p "$PROBE_GAME/LuaRules/Gadgets"
cp "$PROOF/jericho-probe.lua" "$PROBE_GAME/LuaRules/Gadgets/zzz_coilbox_jericho_probe.lua"
sed "s|@BASE@|$BASE_NAME|g" "$PROOF/modinfo.lua" >"$PROBE_GAME/modinfo.lua"

discover
PROBE_NAME="$(archive_name coilbox-sf-probe.sdd 1)"
if [ -z "$PROBE_NAME" ]; then
  echo "the engine did not recognise the probe mutator, see $WORK/discover.log" >&2
  exit 2
fi

echo "engine:  $ENGINE"
echo "game:    $BASE_NAME ($SF_GAME)"
echo "mutator: $PROBE_NAME"
echo "map:     $MAP_NAME"
echo "mission: $MISSION_DIR/mission.lua"
echo "runtime: version $RUNTIME_VERSION, $RUNTIME_FILES files from lua/mission-runtime"
echo

LOG="$WORK/jericho.log"
SCRIPT="$WORK/jericho.script.txt"

MODOPTIONS="$(printf '\t\tcoilbox_mission=%s\x3b' "$MISSION_ID")" \
  GAME_NAME="$PROBE_NAME" MAP_NAME="$MAP_NAME" \
  TEMPLATE="$PROOF/start-script.tdf" SCRIPT="$SCRIPT" \
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
grep -E 'HARNESS (said|marked) ' "$LOG" | sed 's/^.*HARNESS /  /' || true
grep 'HARNESS fail ' "$LOG" | sed 's/^.*HARNESS fail /  fail /' || true

passed=$(grep -c 'HARNESS ok ' "$LOG" || true)
failed=$(grep -c 'HARNESS fail ' "$LOG" || true)

# Seven of the mission's eight radio lines are on the path a winning run takes.
# The eighth is the one it says when the strike team is wiped out. A line that
# never crossed to the unsynced half is a dialogue action that did nothing.
said=$(grep -c 'HARNESS said ' "$LOG" || true)
if [ "$said" -eq 7 ]; then
  echo "  ok every dialogue line on the winning path was said"
  passed=$((passed + 1))
else
  echo "  fail the mission said $said of the 7 lines on the winning path"
  failed=$((failed + 1))
fi

# The gadget the game vendors has to be the one that loaded, or the mission was
# played by something other than the runtime under test. Matched without case,
# because the wording is the game's own gadget handler's.
if [ "$(grep -ci 'Loaded synced gadget: *Coilbox mission runtime' "$LOG" || true)" -eq 0 ]; then
  echo "  fail the vendored runtime gadget did not load"
  failed=$((failed + 1))
fi

errors=$(grep -c '\[coilbox-mission\] Error' "$LOG" || true)
if [ "$errors" -gt 0 ]; then
  grep '\[coilbox-mission\] Error' "$LOG" | sed 's/^.*\[coilbox-mission\] /  fail runtime /'
  failed=$((failed + errors))
fi
if [ "$(grep -c 'HARNESS done' "$LOG" || true)" -eq 0 ]; then
  echo "  fail the probe never reached the end of its plan"
  failed=$((failed + 1))
fi

echo
echo "  $passed passed, $failed failed"
if [ "$failed" -eq 0 ]; then
  if [ "$KEEP_LOG" = 1 ]; then
    echo "the mission was won, the engine log is in $LOG"
  else
    rm -r "$WORK"
    echo "the mission was won"
  fi
else
  echo "the engine log is in $LOG"
  exit 1
fi
