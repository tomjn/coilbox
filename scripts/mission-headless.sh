#!/usr/bin/env bash
# Run the mission runtime in a real engine.
#
# Builds a scratch game out of lua/mission-runtime/ plus the compiled fixture
# missions in src/scenario/fixtures/missions/, and plays each one in
# spring-headless with no OpenGL context. The runtime goes in through coilbox's
# own install (scripts/mission-runtime-install.sh), which is the code behind the
# **Install the mission runtime** button, so a file the runtime grows reaches
# this harness without anyone editing this script (issue #936). The probe gadget
# (lua/mission-runtime/tests/headless/probe.lua) stands in for the player and
# reports one line per check. This script counts them and fails on anything the
# engine disagreed with.
#
# The suites in lua/mission-runtime/tests/ prove the runtime's own logic against
# a stub of the engine. This proves the claims only a real one can settle: that
# the modoption gate keeps the gadget out of a normal game, that a prefab's
# factory queue is what the prefab wrote, that a rules param comes back out, that
# the start suppression works against a game's own start, that a real game's
# widget handler loads the mission widget out of the vendored luaui/widgets, and
# that the whole thing loads at all.
#
# Usage: scripts/mission-headless.sh [mission ...]
# Default: gate, ambush, garrison, siege, outbreak.
#
# outbreak is the difficulty fixture. It is run at whatever
# COILBOX_HARNESS_DIFFICULTY says, which is nothing by default, so the default
# run proves what the runtime does when no launcher chose. Run the script again
# with that variable set to easy, normal and hard to cover the rest.
#
# Needs a headless engine, a game carrying the fixtures' unit defs (Balanced
# Annihilation by default) and any map.
#
# The widget half needs one thing more. A game's LuaUI entry point includes the
# LuaUI/*.lua a Spring install used to leave in the data directory, and a current
# engine ships none of them: Balanced Annihilation dies on LuaUI/utils.lua before
# a widget is reached, and so do Metal Factions and Splinter Faction. So this
# links the data directory's own LuaUI/ in beside base/ when there is one, and
# says so and proves nothing about the widget when there is not.
#
#   COILBOX_SPRING_HEADLESS  the binary. Default is the first spring-headless
#                            with base content beside it or in the data
#                            directory: loose in COILBOX_SPRING_DATA, then the
#                            installed engines under its engine/, then PATH.
#   COILBOX_SPRING_DATA      where games/ and maps/ are. Default ~/.spring.
#   COILBOX_HARNESS_GAME     the base game archive's filename under games/.
#                            Default the first balanced_annihilation-* there.
#   COILBOX_HARNESS_MAP      the map archive's filename under maps/. Default the
#                            first one there.
#   COILBOX_HARNESS_DIFFICULTY  the coilbox_difficulty modoption to launch with.
#                            Default none, which is what a launcher that has
#                            never heard of difficulty writes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME="$ROOT/lua/mission-runtime"
HEADLESS="$RUNTIME/tests/headless"
FIXTURES="$ROOT/src/scenario/fixtures/missions"

DATA_DIR="${COILBOX_SPRING_DATA:-$HOME/.spring}"

# The engine and the base content to run it on, shared with every harness.
. "$ROOT/scripts/mission-engine.sh"

# The first archive matching a pattern, by name, or a refusal naming what is missing.
pick() { # directory, pattern, what it is
  local found
  found="$(ls "$1" | grep -v '\.md5\.gz$' | grep -E "$2" | sort | head -n 1 || true)"
  if [ -z "$found" ]; then
    echo "no $3 in $1" >&2
    exit 2
  fi
  echo "$found"
}

GAME_ARCHIVE="${COILBOX_HARNESS_GAME:-}"
[ -n "$GAME_ARCHIVE" ] || GAME_ARCHIVE="$(pick "$DATA_DIR/games" '^balanced_annihilation-' 'base game')"
MAP_ARCHIVE="${COILBOX_HARNESS_MAP:-}"
[ -n "$MAP_ARCHIVE" ] || MAP_ARCHIVE="$(pick "$DATA_DIR/maps" '\.sd[7z]$' 'map')"

MISSIONS=("$@")
[ ${#MISSIONS[@]} -gt 0 ] || MISSIONS=(gate ambush garrison siege outbreak)

DIFFICULTY="${COILBOX_HARNESS_DIFFICULTY:-}"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/coilbox-mission-headless.XXXXXX")"
GAME="$WORK/data/games/coilbox-mission-harness.sdd"

mkdir -p "$WORK/data/games" "$WORK/data/maps" "$WORK/write"
ln -s "$BASE_CONTENT" "$WORK/data/base"
ln -s "$DATA_DIR/games/$GAME_ARCHIVE" "$WORK/data/games/$GAME_ARCHIVE"
ln -s "$DATA_DIR/maps/$MAP_ARCHIVE" "$WORK/data/maps/$MAP_ARCHIVE"

# Everything in the data directory's LuaUI except a player's own widgets and the
# config that switches them on and off. Those are the one thing an isolated run
# is isolated from, and the game under test brings its own.
LUAUI="$DATA_DIR/LuaUI"
if [ -d "$LUAUI" ]; then
  mkdir -p "$WORK/data/LuaUI"
  for entry in "$LUAUI"/*; do
    [ -e "$entry" ] || continue
    case "$(basename "$entry" | tr '[:upper:]' '[:lower:]')" in
      widgets | config) ;;
      *) ln -s "$entry" "$WORK/data/LuaUI/" ;;
    esac
  done
else
  LUAUI=""
fi

engine() {
  "$ENGINE" --isolation --isolation-dir "$WORK/data" --write-dir "$WORK/write" --only-local "$@"
}

# The archive cache, which is where the declared names live.
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
# cache before it looks at anything else, including a run given an archive that
# does not exist, so a deliberate failure is the cheapest way to fill it in.
#
# The scratch game is not there yet on purpose. An archive the scanner has
# already read is skipped on a second pass, and one read before it had a
# modinfo.lua would be remembered as no game at all.
discover() {
  engine --calc-checksum coilbox-harness-discovery >"$WORK/discover.log" 2>&1 || true
}

discover
BASE_NAME="$(archive_name "$GAME_ARCHIVE" 1)"
MAP_NAME="$(archive_name "$MAP_ARCHIVE" 3)"
if [ -z "$BASE_NAME" ] || [ -z "$MAP_NAME" ]; then
  echo "the engine did not recognise $GAME_ARCHIVE as a game or $MAP_ARCHIVE as a map" >&2
  exit 2
fi

# The scratch game gets what coilbox installs into a game, through coilbox's own
# install rather than a copy of it (issue #936). A hand-written file list left
# the runtime free to grow a file the harness never carried, and a run against a
# runtime missing it passed.
mkdir -p "$GAME"
RUNTIME_INSTALL="$(bash "$ROOT/scripts/mission-runtime-install.sh" "$GAME")"
read -r RUNTIME_VERSION RUNTIME_FILES <<<"$RUNTIME_INSTALL"
# Named to sort last, so the probe reads a frame every other gadget has finished
# with. The runtime is at layer 1000 and the probe at 2000. The install wrote
# the tree, so the probe goes in beside the runtime's own gadget.
mkdir -p "$GAME/luarules/gadgets"
cp "$HEADLESS/probe.lua" "$GAME/luarules/gadgets/zzz_coilbox_harness_probe.lua"
for mission in "$FIXTURES"/*/; do
  id="$(basename "$mission")"
  mkdir -p "$GAME/missions/$id"
  cp "$mission/mission.lua" "$GAME/missions/$id/mission.lua"
done
sed "s|@BASE@|$BASE_NAME|g" "$HEADLESS/modinfo.lua" >"$GAME/modinfo.lua"

discover
GAME_NAME="$(archive_name coilbox-mission-harness.sdd 1)"
if [ -z "$GAME_NAME" ]; then
  echo "the engine did not recognise the scratch game, see $WORK/discover.log" >&2
  exit 2
fi

echo "engine:  $ENGINE"
echo "game:    $BASE_NAME"
echo "map:     $MAP_NAME"
echo "runtime: version $RUNTIME_VERSION, $RUNTIME_FILES files from lua/mission-runtime"
if [ -n "$DIFFICULTY" ]; then
  echo "difficulty: $DIFFICULTY"
else
  echo "difficulty: none chosen, so the runtime picks its own default"
fi
if [ -n "$LUAUI" ]; then
  echo "luaui:   $LUAUI"
else
  echo "luaui:   none in $DATA_DIR, so this run proves nothing about the widget"
fi
echo

failures=0

run_mission() { # a fixture mission id, or "gate" for a game with no mission
  local id="$1"
  local log="$WORK/$id.log"
  local script="$WORK/$id.script.txt"
  local modoption=""
  if [ "$id" != gate ]; then
    modoption="$(printf '\t\tcoilbox_mission=%s\x3b' "$id")"
    # A launcher that never chose writes nothing, and that is the default here
    # too: the runtime's own fallback is part of what this proves.
    if [ -n "$DIFFICULTY" ]; then
      modoption="$modoption$(printf '\n\t\tcoilbox_difficulty=%s\x3b' "$DIFFICULTY")"
    fi
  fi

  MODOPTIONS="$modoption" GAME_NAME="$GAME_NAME" MAP_NAME="$MAP_NAME" \
    TEMPLATE="$HEADLESS/start-script.tdf" SCRIPT="$script" \
    luajit -e '
      local template = io.open(os.getenv("TEMPLATE")):read("*a")
      template = template:gsub("@GAME@", os.getenv("GAME_NAME"))
      template = template:gsub("@MAP@", os.getenv("MAP_NAME"))
      template = template:gsub("@MODOPTIONS@", (os.getenv("MODOPTIONS"):gsub("%%", "%%%%")))
      local out = io.open(os.getenv("SCRIPT"), "w")
      out:write(template)
      out:close()
    '

  echo "== $id"
  if ! engine "$script" >"$log" 2>&1; then
    echo "  fail the engine exited nonzero, see $log"
    failures=$((failures + 1))
    return
  fi

  local passed failed
  passed=$(grep -c 'HARNESS ok ' "$log" || true)
  failed=$(grep -c 'HARNESS fail ' "$log" || true)
  grep 'HARNESS fail ' "$log" | sed 's/^.*HARNESS fail /  fail /' || true
  # A claim the run could not reach. Neither passed nor failed, and said out loud
  # rather than counted, because a check nothing made is a hole in the run.
  grep 'HARNESS skip ' "$log" | sed 's/^.*HARNESS skip /  skip /' || true

  # The gate is the one claim the probe cannot make for itself. Without the
  # modoption the gadget never defines a callin, so what has to be read is the
  # engine's own record of what it loaded.
  local loaded
  loaded=$(grep -c 'Loaded synced gadget:  Coilbox mission runtime' "$log" || true)
  if [ "$id" = gate ]; then
    if [ "$loaded" -eq 0 ]; then
      echo "  ok a game with no coilbox_mission modoption loads no runtime gadget"
      passed=$((passed + 1))
    else
      echo "  fail the runtime gadget loaded in a game with no mission"
      failed=$((failed + 1))
    fi
  elif [ "$loaded" -eq 0 ]; then
    echo "  fail the runtime gadget did not load"
    failed=$((failed + 1))
  fi

  # Anything the runtime called an error is a failure whether or not a check
  # noticed, and so is a gadget the handler threw out for raising.
  local errors
  errors=$(grep -c '\[coilbox-mission\] Error' "$log" || true)
  if [ "$errors" -gt 0 ]; then
    grep '\[coilbox-mission\] Error' "$log" | sed 's/^.*\[coilbox-mission\] /  fail runtime /'
    failed=$((failed + errors))
  fi
  if grep -q 'Removed gadget: *Coilbox' "$log"; then
    echo "  fail the gadget handler removed a coilbox gadget"
    failed=$((failed + 1))
  fi
  # The same for the widget half. A widget that raises in a callin is thrown out
  # by the widget handler, which says so and carries on.
  if grep -q 'Removed widget: *Coilbox' "$log"; then
    echo "  fail the widget handler removed a coilbox widget"
    failed=$((failed + 1))
  fi

  if [ "$(grep -c 'HARNESS done' "$log" || true)" -eq 0 ]; then
    echo "  fail the probe never reached the end of its plan"
    failed=$((failed + 1))
  fi

  echo "  $passed passed, $failed failed"
  failures=$((failures + failed))
}

for mission in "${MISSIONS[@]}"; do
  run_mission "$mission"
done

echo
if [ "$failures" -eq 0 ]; then
  rm -r "$WORK"
  echo "all passed"
else
  echo "$failures failed. The engine logs are in $WORK"
  exit 1
fi
