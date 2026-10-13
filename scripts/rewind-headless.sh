#!/usr/bin/env bash
# Record a fixture match with the real rewind recorder, in a real engine.
#
# 1. Plays a short scripted match in spring-headless: Splinter Faction, a
#    scratch game on top of it (lua/rewind-recorder/tests/headless/) that adds
#    one moving unit and ends the match at frame 360, and a start script. The
#    engine records a replay of it.
# 2. Plays that replay back under the analysis game coilbox generates, with the
#    recorder in it. This is the route the app takes, run through the ignored
#    test a_real_replay_reproduces_under_the_analysis_game.
# 3. Counts what the dump holds, thins it into a track, and reads the track
#    back (crates/coilbox-track-thin/examples/rewind_fixture.rs).
# 4. Compares the counts to the values below, which are known for one version
#    of Splinter Faction on one map.
# 5. Puts the same replay through the analysis queue as a recording, which is
#    the route the app takes (issue #3785), and checks it ends with one track
#    and no dump.
#
# The match is generated every run, not committed as a replay, because a replay
# only plays back against the exact game version it was recorded on. The known
# values depend on the game version, so the script stops with a message naming
# the version they are for when it is given another.
#
# Every assertion is a count. A run in which the engine never started, or the
# recorder never loaded, has no errors to report and would read as a pass, so
# nothing here passes on the absence of an error.
#
# Needs a headless engine, Splinter Faction, the map, luajit, cargo-nextest and
# a built unitsync worker (bun run sidecar:unitsync, or cargo build -p
# coilbox-unitsync-worker). CI has none of these and does not run this script.
# Run it after changing lua/rewind-recorder, crates/coilbox-track,
# crates/coilbox-track-thin or the analysis game.
#
# Usage: scripts/rewind-headless.sh
#
#   COILBOX_SPRING_HEADLESS  the binary, as for scripts/mission-headless.sh.
#   COILBOX_SPRING_DATA      where games/ and maps/ are. Default ~/.spring.
#   COILBOX_REWIND_GAME      the Splinter Faction archive's filename under
#                            games/. Default is the version the known values
#                            below are for.
#   COILBOX_REWIND_MAP       the map archive's filename under maps/.
#   UNITSYNC_WORKER          the unitsync worker. Default
#                            target/debug/coilbox-unitsync-worker.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HEADLESS="$ROOT/lua/rewind-recorder/tests/headless"
RECORDER_TESTS="$ROOT/lua/rewind-recorder/tests"

# The values this script knows, and what they are for: the game and map named
# here, played by the fixture in lua/rewind-recorder/tests/headless/.
KNOWN_GAME_ARCHIVE="SplinterFaction_0.1.89.sdz"
KNOWN_GAME_VERSION="SplinterFaction 0.1.89"
KNOWN_MAP_ARCHIVE="Tumult.sd7"
KNOWN_MAP_NAME="Tumult"
# The two units the fixture creates. Splinter Faction spawns no commander in
# the first 900 frames, while its players choose a faction.
KNOWN_UNITS=2
KNOWN_UNITS_DESTROYED=1
KNOWN_FEATURES=29
# The fixture ends the match at frame 360, and the recorder's last frame is
# the one it ended on.
KNOWN_LAST_FRAME=360
# The rows the recorder writes for what the teams hold and for the rest of
# their economy, each written when a number changes (issue #3982).
KNOWN_TEAM_RESOURCE_ROWS=15
KNOWN_TEAM_ECONOMY_ROWS=8
# The samples of the dump that thinning measures against the track.
KNOWN_SAMPLES_CHECKED=214
# The frames at which the track is compared with the engine's own report of
# where the fixture's moving unit was: at its start, on the move, nearly there
# and stopped.
POSITION_FRAMES=(30 90 150 270)

DATA_DIR="${COILBOX_SPRING_DATA:-$HOME/.spring}"

# The engine and the base content to run it on, shared with every harness.
. "$ROOT/scripts/mission-engine.sh"

GAME_ARCHIVE="${COILBOX_REWIND_GAME:-$KNOWN_GAME_ARCHIVE}"
MAP_ARCHIVE="${COILBOX_REWIND_MAP:-$KNOWN_MAP_ARCHIVE}"
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

WORK="$(mktemp -d "${TMPDIR:-/tmp}/coilbox-rewind-headless.XXXXXX")"
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
if [ "$BASE_NAME" != "$KNOWN_GAME_VERSION" ]; then
  echo "the known values are for $KNOWN_GAME_VERSION and $GAME_ARCHIVE is $BASE_NAME." >&2
  echo "Record the fixture on $KNOWN_GAME_VERSION, or work out the new values and change them in this script." >&2
  exit 2
fi
if [ "$MAP_NAME" != "$KNOWN_MAP_NAME" ]; then
  echo "the known values are for the map $KNOWN_MAP_NAME and $MAP_ARCHIVE is $MAP_NAME." >&2
  exit 2
fi

mkdir -p "$GAME/luarules/gadgets"
cp "$HEADLESS/fixture_match.lua" "$GAME/luarules/gadgets/coilbox_rewind_fixture_match.lua"
sed "s|@BASE@|$BASE_NAME|g" "$HEADLESS/modinfo.lua" >"$GAME/modinfo.lua"

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
GAME_NAME="$GAME_NAME" MAP_NAME="$MAP_NAME" TEMPLATE="$HEADLESS/start-script.tdf" SCRIPT="$SCRIPT" \
  luajit -e '
    local template = io.open(os.getenv("TEMPLATE")):read("*a")
    template = template:gsub("@GAME@", os.getenv("GAME_NAME"))
    template = template:gsub("@MAP@", os.getenv("MAP_NAME"))
    local out = io.open(os.getenv("SCRIPT"), "w")
    out:write(template)
    out:close()
  '

failures=0

# One claim: a name, what the run gave, and what it should have given.
expect() { # what, actual, expected
  if [ "$2" = "$3" ]; then
    echo "  ok $1: $2"
  else
    echo "  fail $1: expected $3, got '$2'"
    failures=$((failures + 1))
  fi
}

# Whether two numbers differ by no more than a third.
within() { # a, b, tolerance
  awk -v a="$1" -v b="$2" -v t="$3" 'BEGIN { d = a - b; if (d < 0) d = -d; exit !(d <= t) }'
}

echo "== playing the fixture match"
MATCH_LOG="$WORK/match.log"
if ! engine "$SCRIPT" >"$MATCH_LOG" 2>&1; then
  echo "  fail the engine exited nonzero, see $MATCH_LOG"
  exit 1
fi
# The fixture gadget says what it did. A run in which the engine started and
# the gadget did not load has none of these lines.
expect "the fixture created its units" "$(grep -c 'FIXTURE created ' "$MATCH_LOG" || true)" 1
expect "the fixture ended the match" "$(grep -c 'FIXTURE done ' "$MATCH_LOG" || true)" 1
if [ "$failures" -ne 0 ]; then
  echo "  fail the fixture game did not run in the engine, see $MATCH_LOG"
  exit 1
fi
REPLAY="$(ls "$WORK"/write/demos/*.sdfz 2>/dev/null | sort | tail -n 1 || true)"
if [ -z "$REPLAY" ]; then
  echo "  fail the engine recorded no replay, see $MATCH_LOG"
  exit 1
fi
echo "  replay $(basename "$REPLAY")"

# Unitsync, which the analysis run asks for the fixture game's short name,
# reads the base content from the engine's folder and refuses a second copy.
rm "$WORK/data/base"

echo "== recording it under the analysis game"
ANALYSIS_LOG="$WORK/analysis.log"
DUMP="$WORK/fixture.dump"
if ! (
  cd "$ROOT"
  UNITSYNC_WORKER="$WORKER" \
    COILBOX_ANALYSIS_REPLAY="$REPLAY" \
    COILBOX_ANALYSIS_ENGINE_DIR="$(dirname "$ENGINE")" \
    COILBOX_ANALYSIS_DATA_DIRS="$WORK/data" \
    COILBOX_ANALYSIS_TIMEOUT_SECS=300 \
    COILBOX_ANALYSIS_RECORD="$DUMP" \
    cargo nextest run -p tauri-plugin-coilbox-content --run-ignored only --no-capture \
    -E 'test(a_real_replay_reproduces_under_the_analysis_game)'
) >"$ANALYSIS_LOG" 2>&1; then
  echo "  fail the analysis run did not pass. The end of $ANALYSIS_LOG:"
  tail -n 25 "$ANALYSIS_LOG" | sed 's/^/    /'
  exit 1
fi
if [ ! -s "$DUMP" ]; then
  echo "  fail the analysis run left no dump, see $ANALYSIS_LOG"
  exit 1
fi

echo "== counting the dump"
SUMMARY="$WORK/summary.txt"
luajit "$RECORDER_TESTS/dump_summary.lua" "$DUMP" >"$SUMMARY"
summary() { # a line's name, as dump_summary.lua prints it
  awk -v name="$1" '{ label = substr($0, 1, 34); sub(/ +$/, "", label) } label == name { print substr($0, 36); exit }' "$SUMMARY"
}
expect "units created" "$(summary 'units created')" "$KNOWN_UNITS"
expect "units destroyed" "$(summary 'units destroyed')" "$KNOWN_UNITS_DESTROYED"
expect "features created" "$(summary 'features created')" "$KNOWN_FEATURES"
expect "last frame" "$(summary 'last frame')" "$KNOWN_LAST_FRAME"
expect "team resource rows" "$(summary 'team resource rows')" "$KNOWN_TEAM_RESOURCE_ROWS"
expect "team economy rows" "$(summary 'team economy rows')" "$KNOWN_TEAM_ECONOMY_ROWS"
# The recorder keeps the rules parameters the request names, and the analysis
# run takes those from the game's playback adapter. The fixture game has a
# short name of its own, so no adapter is for it and none is asked for.
expect "team rules parameters asked for" "$(summary 'team parameters asked for')" ""

echo "== thinning it into a track and reading the track back"
TRACK="$WORK/fixture.track"
FACTS="$WORK/facts.txt"
if ! (cd "$ROOT" && cargo run -q -p coilbox-track-thin --example rewind_fixture -- \
  "$DUMP" "$TRACK" "${POSITION_FRAMES[@]}") >"$FACTS" 2>"$WORK/thin.log"; then
  echo "  fail thinning the dump failed:"
  sed 's/^/    /' "$WORK/thin.log"
  exit 1
fi
fact() { # a line's name
  awk -v name="$1" '$1 == name { print $2; exit }' "$FACTS"
}
expect "units in the track" "$(fact units)" "$KNOWN_UNITS"
expect "features in the track" "$(fact features)" "$KNOWN_FEATURES"
expect "last frame of the track" "$(fact last_frame)" "$KNOWN_LAST_FRAME"
expect "samples measured against the track" "$(fact samples_checked)" "$KNOWN_SAMPLES_CHECKED"

TOLERANCE="$(fact tolerance)"
WORST="$(fact worst_error)"
if [ -n "$WORST" ] && [ -n "$TOLERANCE" ] && within "$WORST" 0 "$TOLERANCE"; then
  echo "  ok the furthest sample from the track is $WORST elmos, within the tolerance of $TOLERANCE"
else
  echo "  fail the furthest sample from the track is '$WORST' elmos, tolerance '$TOLERANCE'"
  failures=$((failures + 1))
fi

# Where the engine said the moving unit was, against where the track puts it.
# A track is allowed to be its tolerance away from a sample.
for frame in "${POSITION_FRAMES[@]}"; do
  said="$(awk -v f="$frame" '/FIXTURE unit / && $0 ~ ("FIXTURE unit " f " ") { print $(NF-2), $(NF-1), $NF; exit }' "$MATCH_LOG")"
  read -r sx sy sz <<<"$said"
  kept="$(awk -v f="$frame" '$1 == "unit" && $2 == f && $3 == 0 { print $5, $6, $7; exit }' "$FACTS")"
  read -r tx ty tz <<<"$kept"
  if [ -z "$said" ] || [ -z "$kept" ]; then
    echo "  fail frame $frame: the engine said '$said' and the track has '$kept'"
    failures=$((failures + 1))
    continue
  fi
  distance="$(awk -v a="$sx" -v b="$sy" -v c="$sz" -v x="$tx" -v y="$ty" -v z="$tz" \
    'BEGIN { printf "%.3f", sqrt((a - x) ^ 2 + (b - y) ^ 2 + (c - z) ^ 2) }')"
  if within "$distance" 0 "$TOLERANCE"; then
    echo "  ok frame $frame: the engine said $sx $sy $sz, the track has $tx $ty $tz, $distance elmos apart"
  else
    echo "  fail frame $frame: the engine said $sx $sy $sz, the track has $tx $ty $tz, $distance elmos apart"
    failures=$((failures + 1))
  fi
done

echo "== recording it through the analysis queue"
QUEUE_LOG="$WORK/queue.log"
if (
  cd "$ROOT"
  UNITSYNC_WORKER="$WORKER" \
    COILBOX_ANALYSIS_REPLAY="$REPLAY" \
    COILBOX_ANALYSIS_ENGINE_DIR="$(dirname "$ENGINE")" \
    COILBOX_ANALYSIS_DATA_DIRS="$WORK/data" \
    cargo nextest run -p tauri-plugin-coilbox-content --run-ignored only --no-capture \
    -E 'test(a_real_replay_is_recorded_through_the_queue_into_a_track)'
) >"$QUEUE_LOG" 2>&1; then
  echo "  ok the queue stored one track and left no dump"
else
  echo "  fail the queue did not record the replay. The end of $QUEUE_LOG:"
  tail -n 25 "$QUEUE_LOG" | sed 's/^/    /'
  failures=$((failures + 1))
fi

echo
if [ "$failures" -eq 0 ]; then
  rm -r "$WORK"
  echo "all passed in ${SECONDS}s"
else
  echo "$failures failed. The logs are in $WORK"
  exit 1
fi
