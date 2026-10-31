#!/usr/bin/env bash
# Play the replay logger's two fixtures in a real engine and check what the logger
# wrote. No ordinary replay reaches the rule for a building or the choice between
# two candidates, and that choice reads the Lua stack with getfenv, so this is the
# proof that both work on the engine's own Lua and not only under LuaJIT.
#
# For each fixture:
# 1. Plays a short scripted match in spring-headless, in a scratch game on top of
#    the base game holding the gadgets from lua/replay-logger/tests/headless/. The
#    engine records a replay. The logger is not in this run.
# 2. Plays that replay under the analysis game coilbox generates, which is the
#    route the app takes, through the ignored test
#    a_real_replay_reproduces_under_the_analysis_game. It has to reach Reproduced.
# 3. Checks the lines the logger wrote with check_fixture.lua.
#
# The building fixture plays on Splinter Faction, the only one of the two games
# whose teams have no unit before a fixture can make one a building. The two
# gadget fixture plays on both, because Splinter Faction has a gadget handler of
# its own and Metal Factions uses the engine's, and getfenv depends on how a
# handler loads a gadget.
#
# The match is generated every run because a replay only plays back against the
# exact game it was recorded on.
#
# Every assertion is a count, so a run in which the engine never started fails.
#
# Needs a headless engine, Splinter Faction, Metal Factions, a map, luajit,
# cargo-nextest and a built unitsync worker. CI has none of these and does not run
# this script. Run it after changing how lua/replay-logger follows a start unit.
#
# Usage: scripts/replay-logger-headless.sh
#
#   COILBOX_SPRING_HEADLESS  the binary, as for scripts/mission-headless.sh.
#   COILBOX_SPRING_DATA      where games/ and maps/ are. Default ~/.spring.
#   COILBOX_LOGGER_SF        Splinter Faction's archive under games/.
#   COILBOX_LOGGER_MF        Metal Factions' archive under games/.
#   COILBOX_LOGGER_MAP       the map's archive under maps/.
#   UNITSYNC_WORKER          the unitsync worker. Default
#                            target/debug/coilbox-unitsync-worker.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURES="$ROOT/lua/replay-logger/tests/headless"
START_SCRIPT="$ROOT/lua/rewind-recorder/tests/headless/start-script.tdf"

DATA_DIR="${COILBOX_SPRING_DATA:-$HOME/.spring}"

# The engine and the base content to run it on, shared with every harness.
. "$ROOT/scripts/mission-engine.sh"

SF_ARCHIVE="${COILBOX_LOGGER_SF:-SplinterFaction_0.1.96.sdz}"
MF_ARCHIVE="${COILBOX_LOGGER_MF:-metal_factions-v2.58.sdz}"
MAP_ARCHIVE="${COILBOX_LOGGER_MAP:-Tumult.sd7}"
for needed in "games/$SF_ARCHIVE" "games/$MF_ARCHIVE" "maps/$MAP_ARCHIVE"; do
  if [ ! -e "$DATA_DIR/$needed" ]; then
    echo "no $needed in $DATA_DIR" >&2
    exit 2
  fi
done
command -v luajit >/dev/null || { echo "luajit is not on PATH (brew install luajit)" >&2; exit 2; }
command -v cargo-nextest >/dev/null || { echo "cargo-nextest is not on PATH (brew install cargo-nextest)" >&2; exit 2; }

WORKER="${UNITSYNC_WORKER:-$ROOT/target/debug/coilbox-unitsync-worker}"
if [ ! -x "$WORKER" ]; then
  echo "unitsync worker not found at $WORKER. Build it with: cargo build -p coilbox-unitsync-worker" >&2
  exit 2
fi

archive_name() { # cache file, archive filename, modtype
  [ -f "$1" ] || return 0
  CACHE="$1" ARCHIVE="$2" MODTYPE="$3" luajit -e '
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

failures=0

# One fixture on one game. Stops at the first step that fails, and the rest of the
# runs still go ahead.
run_fixture() { # fixture, game archive, side of team 0, side of team 1, gadget files...
  local fixture="$1" archive="$2" side0="$3" side1="$4"
  shift 4
  local work game_dir base_name game_name map_name replay
  work="$(mktemp -d "${TMPDIR:-/tmp}/coilbox-logger-headless.XXXXXX")"
  game_dir="$work/data/games/coilbox-logger-fixture.sdd"
  mkdir -p "$work/data/games" "$work/data/maps" "$work/write"
  ln -s "$BASE_CONTENT" "$work/data/base"
  ln -s "$DATA_DIR/games/$archive" "$work/data/games/$archive"
  ln -s "$DATA_DIR/maps/$MAP_ARCHIVE" "$work/data/maps/$MAP_ARCHIVE"

  # The fixture's own clock ends a match that never starts after 300 seconds. This
  # is twice that, a limit for an engine that hangs, and not a measured time.
  engine() {
    timeout 600 "$ENGINE" --isolation --isolation-dir "$work/data" --write-dir "$work/write" --only-local "$@"
  }
  local cache="$work/write/cache/ArchiveCache22.lua"

  echo "== $fixture on $archive"
  engine --calc-checksum coilbox-logger-discovery >"$work/discover.log" 2>&1 || true
  base_name="$(archive_name "$cache" "$archive" 1)"
  map_name="$(archive_name "$cache" "$MAP_ARCHIVE" 3)"
  if [ -z "$base_name" ] || [ -z "$map_name" ]; then
    echo "  fail the engine did not recognise $archive or $MAP_ARCHIVE, see $work/discover.log"
    failures=$((failures + 1))
    return
  fi

  mkdir -p "$game_dir/luarules/gadgets"
  for gadget in "$@"; do
    cp "$FIXTURES/$gadget" "$game_dir/luarules/gadgets/coilbox_logger_$gadget"
  done
  sed -e "s|@BASE@|$base_name|g" -e "s|@NAME@|Coilbox logger fixture $fixture|g" \
    "$FIXTURES/modinfo.lua" >"$game_dir/modinfo.lua"
  engine --calc-checksum coilbox-logger-discovery >"$work/discover.log" 2>&1 || true
  game_name="$(archive_name "$cache" coilbox-logger-fixture.sdd 1)"
  if [ -z "$game_name" ]; then
    echo "  fail the engine did not recognise the fixture game, see $work/discover.log"
    failures=$((failures + 1))
    return
  fi

  sed -e "s|@GAME@|$game_name|" -e "s|@MAP@|$map_name|" \
    -e "s|side=Federation of Kala;|side=$side0;|" -e "s|side=Loz Alliance;|side=$side1;|" \
    "$START_SCRIPT" >"$work/script.txt"

  if ! engine "$work/script.txt" >"$work/match.log" 2>&1; then
    echo "  fail the engine exited nonzero, see $work/match.log"
    failures=$((failures + 1))
    return
  fi
  # A run in which the engine started and the gadget did not load has none of these.
  if [ "$(grep -c 'FIXTURE created ' "$work/match.log" || true)" != 1 ] \
    || [ "$(grep -c 'FIXTURE done ' "$work/match.log" || true)" = 0 ]; then
    echo "  fail the fixture did not play, see $work/match.log"
    failures=$((failures + 1))
    return
  fi
  replay="$(ls "$work"/write/demos/*.sdfz 2>/dev/null | sort | tail -n 1 || true)"
  if [ -z "$replay" ]; then
    echo "  fail the engine recorded no replay, see $work/match.log"
    failures=$((failures + 1))
    return
  fi

  # Unitsync, which the analysis run asks for the fixture game's short name, reads
  # the base content from the engine's folder and refuses a second copy.
  rm "$work/data/base"

  if ! (
    cd "$ROOT"
    UNITSYNC_WORKER="$WORKER" \
      COILBOX_ANALYSIS_REPLAY="$replay" \
      COILBOX_ANALYSIS_ENGINE_DIR="$(dirname "$ENGINE")" \
      COILBOX_ANALYSIS_DATA_DIRS="$work/data" \
      COILBOX_ANALYSIS_TIMEOUT_SECS=300 \
      COILBOX_ANALYSIS_KEEP="$work/keep" \
      cargo nextest run -p tauri-plugin-coilbox-content --run-ignored only --no-capture \
      -E 'test(a_real_replay_reproduces_under_the_analysis_game)'
  ) >"$work/analysis.log" 2>&1; then
    echo "  fail the analysis run did not reproduce the match, see $work/analysis.log"
    failures=$((failures + 1))
    return
  fi

  if luajit "$FIXTURES/check_fixture.lua" "$fixture" "$work/keep/events.jsonl"; then
    rm -r "$work"
  else
    echo "  the run's files are in $work"
    failures=$((failures + 1))
  fi
}

run_fixture building "$SF_ARCHIVE" "Federation of Kala" "Loz Alliance" fixture_building.lua
run_fixture two_gadgets "$SF_ARCHIVE" "Federation of Kala" "Loz Alliance" \
  fixture_two_gadgets_morph.lua fixture_two_gadgets_spawner.lua
run_fixture two_gadgets "$MF_ARCHIVE" "Aven" "Gear" \
  fixture_two_gadgets_morph.lua fixture_two_gadgets_spawner.lua

echo
if [ "$failures" -eq 0 ]; then
  echo "all passed in ${SECONDS}s"
else
  echo "$failures failed"
  exit 1
fi
