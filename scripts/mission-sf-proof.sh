#!/usr/bin/env bash
# Prove the mission runtime on SplinterFaction (issue #772).
#
# scripts/mission-headless.sh proves the runtime by building a scratch game out
# of lua/mission-runtime/ and stacking it on Balanced Annihilation. That settles
# the runtime's own behaviour but says nothing about adoption, because the
# runtime it runs is the harness's copy rather than a game's.
#
# This runs the other way round. The runtime and the compiled mission come out of
# a real loose game, the one coilbox's "Install the mission runtime" wrote into,
# and the scratch mutator carries only scripts/sf-proof/probe.lua. So what passes
# here is the vendored install, on a game with its own start gadget, its own
# game_end and 158 unit defs of its own.
#
# It writes src/scenario/fixtures/missions/splinter/mission.lua into the game, at
# missions/splinter/mission.lua, which is what coilbox's own launch path does.
# Nothing else in the game is touched, and --keep-mission leaves it there.
#
# The game also has to carry the three guards the adoption contract asks for, and
# those are Splinter Faction's own change rather than coilbox's. They are not
# upstream, so scripts/sf-proof/splinterfaction-guards.patch holds them. This
# script checks for them and stops with the command that applies them.
# --apply-guards runs that command for you and says what it changed.
#
# Usage: scripts/mission-sf-proof.sh [--keep-mission] [--apply-guards]
#
#   COILBOX_SPRING_HEADLESS  the binary. Default is spring-headless in
#                            COILBOX_SPRING_DATA, then one on PATH.
#   COILBOX_SPRING_DATA      where games/ and maps/ are. Default ~/.spring.
#   COILBOX_SF_GAME          the game folder under games/. It must be a loose
#                            .sdd with the runtime installed. Default
#                            SplinterFaction.sdd.
#   COILBOX_HARNESS_MAP      the map archive's filename under maps/. Default the
#                            first one there.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROOF="$ROOT/scripts/sf-proof"
MISSION_ID=splinter
MISSION_SRC="$ROOT/src/scenario/fixtures/missions/$MISSION_ID/mission.lua"

KEEP_MISSION=0
APPLY_GUARDS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --keep-mission) KEEP_MISSION=1 ;;
    --apply-guards) APPLY_GUARDS=1 ;;
    *)
      echo "unknown argument: $1" >&2
      echo "usage: scripts/mission-sf-proof.sh [--keep-mission] [--apply-guards]" >&2
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
# The marker is what coilbox reads back after an install, so its absence means
# the game has not adopted the runtime and there is nothing here to prove.
[ -f "$SF_DIR/missions/runtime.lua" ] || {
  echo "$SF_GAME has no missions/runtime.lua. Install the mission runtime from Content > Games first" >&2
  exit 2
}
[ -f "$MISSION_SRC" ] || { echo "no compiled mission at $MISSION_SRC" >&2; exit 2; }

# The guards are the game's own change, so the proof reads them rather than
# assuming them, and never writes them without being asked. Each is checked by
# the name the runtime is called through, which is the part a rewrite of the
# surrounding gadget cannot drop and still work.
GUARDS_PATCH="$PROOF/splinterfaction-guards.patch"
GAME_END="$SF_DIR/LuaRules/Gadgets/game_end.lua"
GAME_SPAWN="$SF_DIR/LuaRules/Gadgets/game_spawn.lua"
# Splinter Faction's .gitattributes checks .lua out with CRLF endings, and the
# patch is stored with the LF ones this repo uses, so the context lines only
# match when the trailing whitespace is ignored.
GUARDS_APPLY=(git -C "$SF_DIR" apply -p1 --ignore-whitespace "$GUARDS_PATCH")

missing=()
grep -q 'GG\.CoilboxMission' "$GAME_END" 2>/dev/null ||
  missing+=("LuaRules/Gadgets/game_end.lua: the Spring.GameOver guard, contract item 2")
grep -q 'suppressesStart' "$GAME_SPAWN" 2>/dev/null ||
  missing+=("LuaRules/Gadgets/game_spawn.lua: the suppressesStart guard in SpawnStartUnit, contract item 3")
grep -q 'suppressesEveryStart' "$GAME_SPAWN" 2>/dev/null ||
  missing+=("LuaRules/Gadgets/game_spawn.lua: the suppressesEveryStart guard in gadget:GameStart, contract item 3")

if [ "$APPLY_GUARDS" = 1 ]; then
  if [ "${#missing[@]}" -eq 0 ]; then
    echo "the guards are already in $SF_GAME, nothing to apply"
    echo
  elif [ "${#missing[@]}" -eq 3 ]; then
    command -v git >/dev/null || { echo "applying the guards needs git on PATH" >&2; exit 2; }
    echo "patching $SF_GAME with $GUARDS_PATCH, which adds:"
    printf '  %s\n' "${missing[@]}"
    "${GUARDS_APPLY[@]}" || {
      echo "the patch did not apply. Add the guards by hand, see docs/mission-runtime.md" >&2
      exit 2
    }
    echo "  undo it with: ${GUARDS_APPLY[*]} -R"
    echo
    missing=()
  else
    echo "$SF_GAME has some of the guards already, so the patch cannot be applied whole:" >&2
    printf '  missing %s\n' "${missing[@]}" >&2
    echo "Add the rest by hand, or revert the game's gadgets first. See docs/mission-runtime.md" >&2
    exit 2
  fi
fi

if [ "${#missing[@]}" -ne 0 ]; then
  echo "$SF_GAME is missing the mission runtime guards it needs:" >&2
  printf '  %s\n' "${missing[@]}" >&2
  echo >&2
  echo "They are the game's change to make, not coilbox's, so this proof will not" >&2
  echo "write them into your game unasked. Apply them with:" >&2
  echo "  ${GUARDS_APPLY[*]}" >&2
  echo "or re-run this script with --apply-guards. See docs/mission-runtime.md" >&2
  exit 2
fi

MAP_ARCHIVE="${COILBOX_HARNESS_MAP:-}"
if [ -z "$MAP_ARCHIVE" ]; then
  MAP_ARCHIVE="$(ls "$DATA_DIR/maps" | grep -v '\.md5\.gz$' | grep -E '\.sd[7z]$' | sort | head -n 1 || true)"
  [ -n "$MAP_ARCHIVE" ] || { echo "no map in $DATA_DIR/maps" >&2; exit 2; }
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/coilbox-sf-proof.XXXXXX")"
PROBE_GAME="$WORK/data/games/coilbox-sf-probe.sdd"

mkdir -p "$WORK/data/games" "$WORK/data/maps" "$WORK/write"
ln -s "$DATA_DIR/base" "$WORK/data/base"
ln -s "$SF_DIR" "$WORK/data/games/$SF_GAME"
ln -s "$DATA_DIR/maps/$MAP_ARCHIVE" "$WORK/data/maps/$MAP_ARCHIVE"

# The compiled mission goes where coilbox's scenarioWriteMission puts it: inside
# the game, beside the runtime the game vendors.
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
# only the engine knows what that is. Every run scans the archives and writes the
# cache before it looks at anything else, so a deliberate failure fills it in.
# The probe mutator is deliberately absent on this pass: an archive read before
# it had a modinfo.lua would be remembered as no game at all.
discover() {
  engine --calc-checksum coilbox-sf-proof-discovery >"$WORK/discover.log" 2>&1 || true
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
cp "$PROOF/probe.lua" "$PROBE_GAME/LuaRules/Gadgets/zzz_coilbox_sf_probe.lua"
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
echo "guards:  all three, in the game"
echo

LOG="$WORK/$MISSION_ID.log"
SCRIPT="$WORK/$MISSION_ID.script.txt"

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
grep 'HARNESS fail ' "$LOG" | sed 's/^.*HARNESS fail /  fail /' || true

passed=$(grep -c 'HARNESS ok ' "$LOG" || true)
failed=$(grep -c 'HARNESS fail ' "$LOG" || true)

# The gadget the game vendors has to be the one that loaded. Without this the
# probe could pass against a runtime that never ran and a mission that never was.
# Matched without case, because the wording is the game's own gadget handler's:
# SplinterFaction's says "Loaded SYNCED gadget" where Balanced Annihilation's
# says "Loaded synced gadget".
if [ "$(grep -ci 'Loaded synced gadget: *Coilbox mission runtime' "$LOG" || true)" -eq 0 ]; then
  echo "  fail the vendored runtime gadget did not load"
  failed=$((failed + 1))
fi

errors=$(grep -c '\[coilbox-mission\] Error' "$LOG" || true)
if [ "$errors" -gt 0 ]; then
  grep '\[coilbox-mission\] Error' "$LOG" | sed 's/^.*\[coilbox-mission\] /  fail runtime /'
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
