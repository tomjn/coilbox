#!/usr/bin/env bash
# Play a recorded track back with the real player gadget, in a real engine.
#
# 1. Plays a scripted match in spring-headless: Splinter Faction, a scratch game
#    on top of it (lua/rewind-player/tests/headless/fixture_match.lua) in which a
#    building is built, a unit dies and leaves a wreck, the wreck goes and the
#    ground changes, and a start script. The engine records a replay of it.
# 2. Records that replay into a track, writes the playback game for it and
#    launches the engine on it, with a driver gadget that seeks the player
#    about and says what the engine has each time. This is the ignored test
#    a_real_track_is_played_at_any_time, and the assertions are in it.
# 3. Does it again with every chunk of the track moved past 16,777,216 bytes,
#    which is how a long track is read (issue #3971).
# 4. Runs a_real_replay_is_played_back_in_the_engine on the same replay, which
#    checks the game and the start script themselves.
#
# The match is generated every run, not committed as a replay, because a replay
# only plays back against the exact game version it was recorded on.
#
# The engine is headless and draws nothing, so this shows what the engine holds
# and not what a person would see.
#
# Needs a headless engine, Splinter Faction, the map, luajit, cargo-nextest and
# a built unitsync worker (bun run sidecar:unitsync, or cargo build -p
# coilbox-unitsync-worker). CI has none of these and does not run this script.
# Run it after changing lua/rewind-player or the playback game.
#
# Usage: scripts/rewind-playback-headless.sh
#
#   COILBOX_SPRING_HEADLESS  the binary, as for scripts/mission-headless.sh.
#   COILBOX_SPRING_DATA      where games/ and maps/ are. Default ~/.spring.
#   COILBOX_REWIND_GAME      the Splinter Faction archive's filename under
#                            games/.
#   COILBOX_REWIND_MAP       the map archive's filename under maps/.
#   UNITSYNC_WORKER          the unitsync worker. Default
#                            target/debug/coilbox-unitsync-worker.
#   COILBOX_PLAYBACK_KEEP    set to keep the scratch folder and its logs.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HEADLESS="$ROOT/lua/rewind-player/tests/headless"
# The scratch game's modinfo and start script are the recorder fixture's.
RECORDER_HEADLESS="$ROOT/lua/rewind-recorder/tests/headless"

DATA_DIR="${COILBOX_SPRING_DATA:-$HOME/.spring}"

# The engine and the base content to run it on, shared with every harness.
. "$ROOT/scripts/mission-engine.sh"

GAME_ARCHIVE="${COILBOX_REWIND_GAME:-SplinterFaction_0.1.89.sdz}"
MAP_ARCHIVE="${COILBOX_REWIND_MAP:-Tumult.sd7}"
for needed in "games/$GAME_ARCHIVE" "maps/$MAP_ARCHIVE"; do
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

WORK="$(mktemp -d "${TMPDIR:-/tmp}/coilbox-rewind-playback.XXXXXX")"
GAME="$WORK/data/games/coilbox-rewind-fixture.sdd"

mkdir -p "$WORK/data/games" "$WORK/data/maps" "$WORK/write"
ln -s "$BASE_CONTENT" "$WORK/data/base"
ln -s "$DATA_DIR/games/$GAME_ARCHIVE" "$WORK/data/games/$GAME_ARCHIVE"
ln -s "$DATA_DIR/maps/$MAP_ARCHIVE" "$WORK/data/maps/$MAP_ARCHIVE"

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

# As in scripts/mission-headless.sh: a start script names a game and a map by
# the name its archive declares, and only the engine knows what that is.
discover() {
  engine --calc-checksum coilbox-rewind-discovery >"$WORK/discover.log" 2>&1 || true
}

discover
BASE_NAME="$(archive_name "$GAME_ARCHIVE" 1)"
MAP_NAME="$(archive_name "$MAP_ARCHIVE" 3)"
if [ -z "$BASE_NAME" ] || [ -z "$MAP_NAME" ]; then
  echo "the engine did not recognise $GAME_ARCHIVE as a game or $MAP_ARCHIVE as a map, see $WORK/discover.log" >&2
  exit 2
fi

mkdir -p "$GAME/luarules/gadgets"
cp "$HEADLESS/fixture_match.lua" "$GAME/luarules/gadgets/coilbox_rewind_playback_fixture_match.lua"
sed "s|@BASE@|$BASE_NAME|g" "$RECORDER_HEADLESS/modinfo.lua" >"$GAME/modinfo.lua"

discover
GAME_NAME="$(archive_name coilbox-rewind-fixture.sdd 1)"
if [ -z "$GAME_NAME" ]; then
  echo "the engine did not recognise the fixture game, see $WORK/discover.log" >&2
  exit 2
fi

echo "engine:  $ENGINE"
echo "game:    $BASE_NAME"
echo "map:     $MAP_NAME"
echo

SCRIPT="$WORK/script.txt"
GAME_NAME="$GAME_NAME" MAP_NAME="$MAP_NAME" TEMPLATE="$RECORDER_HEADLESS/start-script.tdf" SCRIPT="$SCRIPT" \
  luajit -e '
    local template = io.open(os.getenv("TEMPLATE")):read("*a")
    template = template:gsub("@GAME@", os.getenv("GAME_NAME"))
    template = template:gsub("@MAP@", os.getenv("MAP_NAME"))
    local out = io.open(os.getenv("SCRIPT"), "w")
    out:write(template)
    out:close()
  '

echo "== playing the fixture match"
MATCH_LOG="$WORK/match.log"
if ! engine "$SCRIPT" >"$MATCH_LOG" 2>&1; then
  echo "  fail the engine exited nonzero, see $MATCH_LOG"
  exit 1
fi
# The fixture gadget says what it did. A run in which the engine started and
# the gadget did not load has none of these lines.
for said in 'PLAYBACK_FIXTURE created ' 'PLAYBACK_FIXTURE building ' 'PLAYBACK_FIXTURE wrecks removed ' 'PLAYBACK_FIXTURE done '; do
  if [ "$(grep -c "$said" "$MATCH_LOG" || true)" != 1 ]; then
    echo "  fail the fixture match did not say '$said', see $MATCH_LOG"
    exit 1
  fi
done
grep 'PLAYBACK_FIXTURE ' "$MATCH_LOG" | sed 's/^.*PLAYBACK_FIXTURE /  /'
REPLAY="$(ls "$WORK"/write/demos/*.sdfz 2>/dev/null | sort | tail -n 1 || true)"
if [ -z "$REPLAY" ]; then
  echo "  fail the engine recorded no replay, see $MATCH_LOG"
  exit 1
fi
echo "  replay $(basename "$REPLAY")"

# Unitsync, which the runs below ask for a game's short name, reads the base
# content from the engine's folder and refuses a second copy.
rm "$WORK/data/base"

failures=0

# One ignored test on the replay. The lines the gadgets logged are shown, and
# the test's own output is kept for a failure.
playback() { # what, test name, log name, blocks to move the track by or nothing
  local log="$WORK/$3.log"
  echo "== $1"
  if (
    cd "$ROOT"
    UNITSYNC_WORKER="$WORKER" \
      COILBOX_ANALYSIS_REPLAY="$REPLAY" \
      COILBOX_ANALYSIS_ENGINE_DIR="$(dirname "$ENGINE")" \
      COILBOX_ANALYSIS_DATA_DIRS="$WORK/data" \
      COILBOX_PLAYBACK_GAME="$BASE_NAME" \
      COILBOX_PLAYBACK_SECONDS=300 \
      COILBOX_PLAYBACK_LOG="$WORK/$3.engine.log" \
      COILBOX_PLAYBACK_PAD_BLOCKS="${4:-}" \
      cargo nextest run -p tauri-plugin-coilbox-content --run-ignored only --no-capture \
      -E "test($2)"
  ) >"$log" 2>&1; then
    grep -E '^(seek |construction |terrain |play |death |explosions |played_past_death |played_to_end |after_empty |teams |long_string |work |options |the track is )' "$log" | sed 's/^/  /' || true
    grep -E 'COILBOX_REWIND_PLAYER ' "$log" | sed 's/^.*COILBOX_REWIND_PLAYER /  player: /' || true
    echo "  ok"
  else
    echo "  fail. The end of $log:"
    tail -n 40 "$log" | sed 's/^/    /'
    failures=$((failures + 1))
  fi
}

playback "playing the track back and seeking about" a_real_track_is_played_at_any_time playback
# 300,000 blocks are 19,200,000 bytes, so every chunk is past 16,777,216.
playback "the same with the track moved past 16,777,216 bytes" a_real_track_is_played_at_any_time moved 300000
playback "the playback game and its start script" a_real_replay_is_played_back_in_the_engine game

echo
if [ "$failures" -eq 0 ]; then
  if [ -n "${COILBOX_PLAYBACK_KEEP:-}" ]; then
    echo "all passed in ${SECONDS}s. The logs are in $WORK"
  else
    rm -r "$WORK"
    echo "all passed in ${SECONDS}s"
  fi
else
  echo "$failures failed. The logs are in $WORK"
  exit 1
fi
