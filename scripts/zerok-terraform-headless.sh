#!/usr/bin/env bash
# Raise walls in a real Zero-K match and build turrets on top of them, the way
# the blueprint widget will (issue #4789).
#
# 1. Plays a scripted Zero-K match in spring-headless: Zero-K, a scratch game on
#    top of it (lua/blueprint-widget/tests/zerok/) and a start script. The
#    scratch game's gadget creates one constructor per case in a row of lanes
#    and keeps the team's storage full. Its widget gives each constructor a
#    different sequence of orders: Zero-K's terraform order for a raised wall,
#    then a level or raise step with the same tag, then a Lotus on the wall,
#    with and without shift, and without the step.
# 2. Plays it again with Zero-K's Lasso Terraform GUI widget turned off in the
#    widget order file, a wall of another height, and tags from the probe's
#    own counter instead of WG.Terraform_GetNextTag.
#    Four more cases hand a blueprint of a raised wall and a turret on it to the
#    blueprint widget's own placing code (place.lua, copied in beside the probe,
#    since the widget itself needs gl): without and with shift, split between
#    two builders, and a wall with no buildings.
# 3. Checks what the gadget saw: which turrets went up on the raised ground
#    and when, what each builder's queue held, and the ground across a wall.
# 4. Saves the ground (issue #4798). One match raises a wall with two Lotus on
#    it, levels a pad with a solar collector on it and digs a trench, then
#    saves them with the blueprint widget's own record.lua and ground.lua, as
#    Save selection and Save ground do. A second match places the saved
#    selection on fresh ground and saves it again. ground_check.lua in the
#    fixture checks both: the steps, where they are, the order, and that the
#    second match left the same ground and saved the same steps.
#
# Every assertion is a count or a height the engine reported. A run in which
# the engine never started, or the fixture never loaded, has nothing to
# report and fails.
#
# The heights are known for one version of Zero-K on one flat map. The script
# names the version when it is given another.
#
# Needs luajit, a headless engine (see scripts/mission-engine.sh), Zero-K installed as a
# rapid package (pr-downloader --download-game zk:stable) and the map. CI has
# none of these and does not run this script. Run it after changing how the
# blueprint widget orders terrain changes in Zero-K.
#
# Usage: scripts/zerok-terraform-headless.sh
#
#   COILBOX_SPRING_HEADLESS  the binary, as for scripts/mission-headless.sh.
#   COILBOX_SPRING_DATA      where pool/, packages/, rapid/ and maps/ are.
#                            Default ~/.spring.
#   COILBOX_ZK_TAG           the rapid tag of the Zero-K to play. Default
#                            zk:stable.
#   COILBOX_ZK_MAP           the map archive's filename under maps/.
#   COILBOX_ZK_MAP_NAME      the name that archive declares.
#   COILBOX_ZK_ONLY          "ground" to play only the save ground matches.
#   COILBOX_ZK_KEEP          set to keep the logs when everything passes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE="$ROOT/lua/blueprint-widget/tests/zerok"

# The version the known values below were measured on.
KNOWN_GAME="Zero-K v1.14.10.3"
# A map flat across the middle, so every lane starts on level ground.
DEFAULT_MAP_ARCHIVE="speedmetal_bar_v2.sd7"
DEFAULT_MAP_NAME="SpeedMetal BAR V2"
# The scratch game's name in its start script: name and version in modinfo.lua.
FIXTURE_NAME="Coilbox Zero-K terraform fixture scratch"

# The ground across a wall raised by 112 and by 70, as height above the
# original ground at each distance in elmos from the wall's centre line. The
# top is 32 elmos wide. Each 8 elmo square of slope drops 28, and the slope
# ends in a step of 4.
KNOWN_PROFILE_112="16:112.0 24:84.0 32:56.0 40:28.0 48:4.0 56:0.0"
KNOWN_PROFILE_70="16:70.0 24:42.0 32:14.0 40:4.0 48:0.0 56:0.0"

DATA_DIR="${COILBOX_SPRING_DATA:-$HOME/.spring}"

# The engine and the base content to run it on, shared with every harness.
. "$ROOT/scripts/mission-engine.sh"

TAG="${COILBOX_ZK_TAG:-zk:stable}"
MAP_ARCHIVE="${COILBOX_ZK_MAP:-$DEFAULT_MAP_ARCHIVE}"
MAP_NAME="${COILBOX_ZK_MAP_NAME:-$DEFAULT_MAP_NAME}"

VERSIONS="$DATA_DIR/rapid/repos.springrts.com/zk/versions.gz"
if [ ! -f "$VERSIONS" ]; then
  echo "no Zero-K rapid index at $VERSIONS. Install Zero-K with: pr-downloader --filesystem-writepath $DATA_DIR --download-game $TAG" >&2
  exit 2
fi
# A line of versions.gz is tag,package hash,dependencies,name.
LINE="$(gzip -dc "$VERSIONS" | awk -F, -v tag="$TAG" '$1 == tag { print; exit }')"
PACKAGE="$(printf '%s' "$LINE" | cut -d, -f2)"
BASE_NAME="$(printf '%s' "$LINE" | cut -d, -f4)"
if [ -z "$PACKAGE" ] || [ ! -f "$DATA_DIR/packages/$PACKAGE.sdp" ]; then
  echo "$TAG is not installed in $DATA_DIR. Install it with: pr-downloader --filesystem-writepath $DATA_DIR --download-game $TAG" >&2
  exit 2
fi
if [ "$BASE_NAME" != "$KNOWN_GAME" ]; then
  echo "the known values are for $KNOWN_GAME and $TAG is $BASE_NAME." >&2
  echo "Install $KNOWN_GAME, or work out the new values and change them in this script." >&2
  exit 2
fi
if [ ! -e "$DATA_DIR/maps/$MAP_ARCHIVE" ]; then
  echo "no maps/$MAP_ARCHIVE in $DATA_DIR" >&2
  exit 2
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/coilbox-zerok-terraform.XXXXXX")"

echo "engine:  $ENGINE"
echo "game:    $BASE_NAME"
echo "map:     $MAP_NAME"
echo

failures=0

# One claim: a name, what the run gave, and what it should have given.
expect() { # what, actual, expected
  if [ "$2" = "$3" ]; then
    echo "  ok $1: $2"
  else
    echo "  fail $1: expected '$3', got '$2'"
    failures=$((failures + 1))
  fi
}

# Plays one match. Writes its log to $WORK/<name>/match.log.
play() { # name, wall height, own tags (0 or 1), lasso off (0 or 1), mode, steps file
  local mode="${5:-terraform}"
  local dir="$WORK/$1"
  mkdir -p "$dir/data/games" "$dir/data/maps" "$dir/data/packages" "$dir/write/LuaUI/Config"
  ln -s "$BASE_CONTENT" "$dir/data/base"
  ln -s "$DATA_DIR/pool" "$dir/data/pool"
  ln -s "$DATA_DIR/packages/$PACKAGE.sdp" "$dir/data/packages/$PACKAGE.sdp"
  ln -s "$DATA_DIR/maps/$MAP_ARCHIVE" "$dir/data/maps/$MAP_ARCHIVE"

  local game="$dir/data/games/coilbox-zk-terraform-fixture.sdd"
  mkdir -p "$game/LuaRules/Gadgets" "$game/LuaUI/Widgets" "$game/LuaUI/coilbox_blueprints"
  cp "$FIXTURE"/luarules/gadgets/*.lua "$game/LuaRules/Gadgets/"
  cp "$FIXTURE"/luaui/widgets/*.lua "$game/LuaUI/Widgets/"
  # the blueprint widget's own placing code, which the probe drives
  cp "$ROOT/lua/blueprint-widget/luaui/coilbox_blueprints/place.lua" "$ROOT/lua/blueprint-widget/luaui/coilbox_blueprints/terraform.lua" "$game/LuaUI/coilbox_blueprints/"
  sed "s|@BASE@|$BASE_NAME|g" "$FIXTURE/modinfo.lua" >"$game/modinfo.lua"
  if [ "$mode" != terraform ]; then
    # The ground probe saves with the widget's own modules.
    mkdir -p "$game/LuaUI/coilbox_blueprints"
    cp "$ROOT"/lua/blueprint-widget/luaui/coilbox_blueprints/{json,ground,record}.lua "$game/LuaUI/coilbox_blueprints/"
  fi
  if [ -n "${6:-}" ]; then
    cp "$6" "$game/LuaUI/coilbox_ground_steps.lua"
  fi

  if [ "$4" = 1 ]; then
    # Zero-K's widget handler reads which widgets are on from this file. 0
    # turns one off, and a version below its own discards the whole file.
    printf 'return {\n  version = 8,\n  ["Lasso Terraform GUI"] = 0,\n}\n' >"$dir/write/LuaUI/Config/ZK_order.lua"
  fi

  sed -e "s|@GAME@|$FIXTURE_NAME|" -e "s|@MAP@|$MAP_NAME|" -e "s|@END_FRAME@|9000|" \
    -e "s|@WALL_HEIGHT@|$2|" -e "s|@OWN_TAGS@|$3|" -e "s|@MODE@|$mode|" \
    "$FIXTURE/start-script.tdf" >"$dir/script.txt"

  if ! timeout 900 "$ENGINE" --isolation --isolation-dir "$dir/data" --write-dir "$dir/write" --only-local \
    "$dir/script.txt" >"$dir/match.log" 2>&1; then
    echo "  fail the engine exited nonzero, see $dir/match.log"
    failures=$((failures + 1))
  fi
}

# The first line of the log matching a pattern, without its timestamps.
line() { # log, pattern
  grep -E "$2" "$1" | head -n 1 | sed 's/^\[t=[^]]*\]\[f=[^]]*\] //' || true
}

# A key=value field from a line.
field() { # line, key
  printf '%s\n' "$1" | tr ' ' '\n' | awk -F= -v k="$2" '$1 == k { print $2; exit }'
}

# The turret of a case went up on ground raised by the wall's height, and
# only after the last of the case's terraform units had finished.
turret_on_wall() { # log, case, height
  local finished created gone_last
  finished="$(line "$1" "FIXTURE finished case=$2 ")"
  created="$(line "$1" "FIXTURE created case=$2 .*unit=turretlaser")"
  gone_last="$(grep -E "FIXTURE terraunit-gone case=$2 " "$1" | sed 's/.*frame=\([0-9]*\).*/\1/' | sort -n | tail -n 1)"
  local raised
  raised="$(awk -v y="$(field "$finished" y)" -v o="$(field "$finished" orig)" 'BEGIN { if (y == "" || o == "") print ""; else printf "%.1f", y - o }')"
  expect "case $2 turret stands on ground raised by" "$raised" "$3.0"
  local after="no"
  if [ -n "$gone_last" ] && [ -n "$created" ] && [ "$(field "$created" frame)" -gt "$gone_last" ]; then
    after="yes"
  fi
  expect "case $2 turret started after the terraform finished" "$after" "yes"
}

# The turret of a case went up on the original ground, and the case's
# terraform unit was never worked on and decayed.
turret_on_ground() { # log, case
  local finished gone
  finished="$(line "$1" "FIXTURE finished case=$2 ")"
  gone="$(line "$1" "FIXTURE terraunit-gone case=$2 ")"
  local raised
  raised="$(awk -v y="$(field "$finished" y)" -v o="$(field "$finished" orig)" 'BEGIN { if (y == "" || o == "") print ""; else printf "%.1f", y - o }')"
  expect "case $2 turret stands on ground raised by" "$raised" "0.0"
  expect "case $2 terraform unit decayed unbuilt" "$(field "$gone" health)" "0.000"
}

# The ground on one side of a case's wall, from the centre line outwards.
profile() { # log, case
  line "$1" "FIXTURE profile-z case=$2 " | tr ' ' '\n' |
    awk -F: '$1 ~ /^[0-9]+$/ && $1 >= 16 && $1 <= 56 { printf "%s%s", sep, $0; sep = " " } END { print "" }'
}

# The queue a case's first builder held at a frame, as command ids.
queue_at() { # log, case, frame
  line "$1" "FIXTURE queue case=$2 frame=$3 " | awk '{ print $NF }'
}

check_common() { # log, height, profile, tag source
  local log="$1"
  expect "the fixture created its builders" "$(grep -c 'FIXTURE builder ' "$log" || true)" 19
  expect "the fixture ended the match" "$(grep -c 'FIXTURE done ' "$log" || true)" 1
  expect "Zero-K did not end the match early" "$(grep -c 'game_message: .* has been destroyed' "$log" || true)" 0
  expect "the probe ordered every case" "$(grep -c 'PROBE ordered ' "$log" || true)" 17
  expect "tags came from" "$(field "$(line "$log" 'PROBE ordered case=1 ')" source)" "$4"
  expect "builders carry the level command as" "$(field "$(line "$log" 'PROBE level-desc ')" action)" "levelground"

  # Level then turret, shift or not, by CMD_LEVEL or CMD_RAISE, appended by
  # CMD_INSERT, with one wall segment or two, and with two builders.
  for case in 1 2 3 4 7 9 10 11 12 13; do
    turret_on_wall "$log" "$case" "$2"
  done
  # A turret ordered with no level step goes up on the ground as it was.
  turret_on_ground "$log" 5
  turret_on_ground "$log" 6
  # The terraform order alone makes a terraform unit that nobody builds.
  expect "case 8 terraform unit decayed unbuilt" "$(field "$(line "$log" 'FIXTURE terraunit-gone case=8 ')" health)" "0.000"

  # Queues once the orders have arrived. 40 is repair, which Zero-K's gadget
  # puts in front of the level step, 39736 level, 39737 raise, -599 the
  # Lotus and -406 the solar collector that was already queued.
  expect "case 1 queue without shift" "$(queue_at "$log" 1 120)" "40,39736,-599"
  expect "case 2 queue with shift" "$(queue_at "$log" 2 120)" "-406,39736,-599"
  expect "case 3 queue appended by CMD_INSERT" "$(queue_at "$log" 3 120)" "-406,39736,-599"
  expect "case 4 queue inserted at the front" "$(queue_at "$log" 4 120)" "40,-599,39736,-406"
  expect "case 7 queue with the raise command" "$(queue_at "$log" 7 120)" "40,39737,-599"

  # The blueprint widget's placing code: a wall and a turret on it, with the
  # buildings and the steps in the blueprint's order, and a wall alone.
  expect "case 11 queue from a blueprint without shift" "$(queue_at "$log" 11 120)" "40,39736,-599"
  expect "case 12 queue from a blueprint with shift" "$(queue_at "$log" 12 120)" "-406,39736,-599"
  expect "case 14 queue from a blueprint of a wall alone" "$(queue_at "$log" 14 120)" "40,39736"
  expect "case 11 wall from a blueprint" "$(profile "$log" 11)" "$3"
  expect "case 14 wall from a blueprint alone" "$(profile "$log" 14)" "$3"
  expect "case 14 built no turret" "$(grep -c 'FIXTURE created case=14 .*unit=turretlaser' "$log" || true)" 0
  expect "the blueprint cases were not skipped or off the map" "$(grep -c 'PROBE blueprint .*skipped=0 offMap=0' "$log" || true)" 7
  expect "case 1 ground across the wall" "$(profile "$log" 1)" "$3"
  expect "case 9 ground across the long wall" "$(profile "$log" 9)" "$3"
  check_model "$log"
}

# What Zero-K estimated for a case's terraform units, added up.
game_metal() { # log, case
  grep -E "FIXTURE terraunit-estimate case=$2 " "$1" | sed 's/.*estimate=\([-0-9.]*\).*/\1/' | awk '{ t += $1 } END { printf "%.4f", t }'
}

# Seconds from a case's first terraform unit appearing to its last going, which
# is when the builder had spent everything on it. The builder also walks there.
game_seconds() { # log, case
  { grep -E "FIXTURE created case=$2 .*unit=terraunit" "$1" | sed 's/.*frame=\([0-9]*\).*/c \1/'
    grep -E "FIXTURE terraunit-gone case=$2 " "$1" | sed 's/.*frame=\([0-9]*\).*/g \1/'; } |
    awk '$1 == "c" && (lo == "" || $2 < lo) { lo = $2 } $1 == "g" && $2 > hi { hi = $2 } END { printf "%.1f", (hi - lo) / 30 }'
}

# The widget's model of the ground against the game's (issue #4797): the metal
# the cost panel adds for each terraform, against the estimate Zero-K puts on
# the terraform units once ordered, and every corner the model changes against
# the ground the game left. The model's metal is worked out as in Zero-K, so
# the two should agree to the four places the log prints. The ground agrees to
# the foot of a slope: the model works a slope out in one pass and Zero-K builds
# it up over many updates, so a few corners at the foot of a slope, mostly the
# diagonals, end up to the 4 elmos of the foot's step away from the model's.
check_model() { # log
  local log="$1" case model game work speed compared worst
  local defs
  defs="$(line "$log" 'FIXTURE defs ')"
  speed="$(field "$defs" buildSpeed)"
  echo "  info $defs"
  for case in 9 11 14 15 16 17; do
    model="$(field "$(line "$log" "FIXTURE model case=$case ")" metal)"
    work="$(field "$(line "$log" "FIXTURE model case=$case ")" work)"
    game="$(game_metal "$log" "$case")"
    echo "  info case $case terraform metal: panel $model, game $game. Time: panel $(awk -v w="$work" -v s="$speed" 'BEGIN { printf "%.1f", w / s }')s, game $(game_seconds "$log" "$case")s"
    expect "case $case: the panel's terraform metal is the game's estimate" "$model" "$game"
  done
  for case in 9 14 15 16 17; do
    compared="$(line "$log" "FIXTURE compare case=$case ")"
    worst="$(field "$compared" worst)"
    echo "  info case $case ground: $compared"
    expect "case $case: no corner is further than the foot's 4 elmos from the model's" "$(awk -v w="$worst" 'BEGIN { print (w <= 4.0001) ? "yes" : "no" }')" yes
    expect "case $case: corners the game changed that the model did not" "$(field "$compared" unexpected)" 0
  done
}

if [ "${COILBOX_ZK_ONLY:-}" != ground ]; then
echo "== the default match: lasso widget on, a wall raised by 112"
play default 112 0 0
LOG="$WORK/default/match.log"
expect "Zero-K's terraform widget was on" "$(field "$(line "$LOG" 'PROBE at-orders ')" lassoInitialised)" "function"
expect "WG.Terraform_GetNextTag was there" "$(field "$(line "$LOG" 'PROBE at-orders ')" GetNextTag)" "function"
check_common "$LOG" 112 "$KNOWN_PROFILE_112" WG

echo
echo "== the lasso widget off, a wall raised by 70, the probe's own tags"
play lasso-off 70 1 1
LOG="$WORK/lasso-off/match.log"
expect "Zero-K's terraform widget was off" "$(field "$(line "$LOG" 'PROBE at-orders ')" lassoInitialised)" "nil"
expect "WG.Terraform_GetNextTag was still there" "$(field "$(line "$LOG" 'PROBE at-orders ')" GetNextTag)" "function"
check_common "$LOG" 70 "$KNOWN_PROFILE_70" own
fi

echo
echo "== save the ground: build and save, then place the saved selection and save again"
play ground-build 112 0 0 ground_build
if luajit "$FIXTURE/ground_check.lua" steps "$WORK/ground-build/match.log" "$WORK/ground-steps.lua"; then
  play ground-place 112 0 0 ground_place "$WORK/ground-steps.lua"
  if ! luajit "$FIXTURE/ground_check.lua" check "$WORK/ground-build/match.log" "$WORK/ground-place/match.log"; then
    failures=$((failures + 1))
  fi
  echo "  the changes in height the build match left:"
  luajit "$FIXTURE/ground_check.lua" stats "$WORK/ground-build/match.log" | sed 's/^/    /'
else
  echo "  fail the build match saved no selection, see $WORK/ground-build/match.log"
  failures=$((failures + 1))
fi

echo
if [ "$failures" -eq 0 ]; then
  if [ -n "${COILBOX_ZK_KEEP:-}" ]; then
    echo "The logs are in $WORK"
  else
    rm -r "$WORK"
  fi
  echo "all passed in ${SECONDS}s"
else
  echo "$failures failed. The logs are in $WORK"
  exit 1
fi
