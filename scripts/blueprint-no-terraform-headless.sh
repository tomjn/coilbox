#!/usr/bin/env bash
# Give the blueprint widget's placing code a blueprint of a raised wall and a
# turret in a game that cannot terraform, and check that the turret is ordered and
# built while the wall is skipped and reported (issue #4797, the check #4796 could
# only half make in Splinter Faction).
#
# 1. Plays a scripted match in spring-headless: Metal Factions, which has no
#    terraform gadget, with a scratch game on top of it
#    (lua/blueprint-widget/tests/no-terraform/) and a start script. The scratch
#    game's gadget picks a builder and a turret it can build from Metal Factions'
#    own unit defs, creates the builder, and keeps the team's storage full. It also
#    gives the blueprint to the widget's own place.lua, with the rule the widget
#    uses for whether terraform is available. It is a gadget because Metal Factions'
#    own LuaUI does not start in a headless match.
# 2. Checks that the widget saw no terraformer, ordered the turret, counted the
#    wall as one skipped terrain change with its reason, queued only the build
#    order, that the turret went up, and that the ground stayed as it was.
#
# Every assertion is a count or a height the engine reported. A run in which the
# engine never started, or the fixture never loaded, has nothing to report and
# fails.
#
# Needs a headless engine (see scripts/mission-engine.sh), metal_factions-v2.58.sdz
# in the Spring data folder's games/ and a map. CI has none of these and does not
# run this script. Run it after changing how the widget places terrain changes in a
# game that cannot make them.
#
# Usage: scripts/blueprint-no-terraform-headless.sh
#
#   COILBOX_SPRING_HEADLESS  the binary, as for scripts/mission-headless.sh.
#   COILBOX_SPRING_DATA      where games/ and maps/ are. Default ~/.spring.
#   COILBOX_NT_GAME          the game archive's filename under games/.
#   COILBOX_NT_GAME_NAME     the name that archive declares.
#   COILBOX_NT_MAP           the map archive's filename under maps/.
#   COILBOX_NT_MAP_NAME      the name that archive declares.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE="$ROOT/lua/blueprint-widget/tests/no-terraform"
DATA_DIR="${COILBOX_SPRING_DATA:-$HOME/.spring}"

# The engine and the base content to run it on, shared with every harness.
. "$ROOT/scripts/mission-engine.sh"

GAME_ARCHIVE="${COILBOX_NT_GAME:-metal_factions-v2.58.sdz}"
BASE_NAME="${COILBOX_NT_GAME_NAME:-Metal Factions v2.58}"
MAP_ARCHIVE="${COILBOX_NT_MAP:-speedmetal_bar_v2.sd7}"
MAP_NAME="${COILBOX_NT_MAP_NAME:-SpeedMetal BAR V2}"
FIXTURE_NAME="Coilbox no-terraform fixture scratch"

for need in "games/$GAME_ARCHIVE" "maps/$MAP_ARCHIVE"; do
  if [ ! -e "$DATA_DIR/$need" ]; then
    echo "no $need in $DATA_DIR" >&2
    exit 2
  fi
done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/coilbox-no-terraform.XXXXXX")"

echo "engine:  $ENGINE"
echo "game:    $BASE_NAME"
echo "map:     $MAP_NAME"
echo

failures=0

expect() { # what, actual, expected
  if [ "$2" = "$3" ]; then
    echo "  ok $1: $2"
  else
    echo "  fail $1: expected '$3', got '$2'"
    failures=$((failures + 1))
  fi
}

dir="$WORK/match"
mkdir -p "$dir/data/games" "$dir/data/maps" "$dir/data/packages" "$dir/write"
ln -s "$BASE_CONTENT" "$dir/data/base"
ln -s "$DATA_DIR/games/$GAME_ARCHIVE" "$dir/data/games/$GAME_ARCHIVE"
ln -s "$DATA_DIR/maps/$MAP_ARCHIVE" "$dir/data/maps/$MAP_ARCHIVE"

game="$dir/data/games/coilbox-no-terraform-fixture.sdd"
mkdir -p "$game/LuaRules/Gadgets" "$game/LuaUI/coilbox_blueprints"
cp "$FIXTURE"/luarules/gadgets/*.lua "$game/LuaRules/Gadgets/"
# the blueprint widget's own placing code, which the gadget drives
cp "$ROOT/lua/blueprint-widget/luaui/coilbox_blueprints/place.lua" "$game/LuaUI/coilbox_blueprints/"
sed "s|@BASE@|$BASE_NAME|g" "$FIXTURE/modinfo.lua" >"$game/modinfo.lua"
sed -e "s|@GAME@|$FIXTURE_NAME|" -e "s|@MAP@|$MAP_NAME|" -e "s|@END_FRAME@|3000|" \
  "$FIXTURE/start-script.tdf" >"$dir/script.txt"

if ! timeout 900 "$ENGINE" --isolation --isolation-dir "$dir/data" --write-dir "$dir/write" --only-local \
  "$dir/script.txt" >"$dir/match.log" 2>&1; then
  echo "  fail the engine exited nonzero, see $dir/match.log"
  failures=$((failures + 1))
fi
LOG="$dir/match.log"

# The first line of the log matching a pattern, without its timestamps.
line() { # pattern
  grep -E "$1" "$LOG" | head -n 1 | sed 's/^\[t=[^]]*\]\[f=[^]]*\] //' || true
}

# A key=value field from a line.
field() { # line, key
  printf '%s\n' "$1" | tr ' ' '\n' | awk -F= -v k="$2" '$1 == k { print $2; exit }'
}

echo "== a blueprint of a raised wall and a turret, in a game with no terraform"
builder="$(line 'FIXTURE builder ')"
turret="$(field "$builder" turret)"
expect "the fixture created a builder that can build a turret" "$([ -n "$turret" ] && echo yes || echo no)" yes
expect "the fixture ended the match" "$(grep -c 'FIXTURE done ' "$LOG" || true)" 1
echo "  info builder $(field "$builder" unit) builds $turret"

caps="$(line 'PROBE capabilities ')"
expect "the builder is a builder" "$(field "$caps" builders)" 1
expect "no builder has the level command" "$(field "$caps" terraformers)" 0

placed="$(line 'PROBE blueprint ')"
expect "the turret was ordered to one builder" "$(field "$placed" sent)" 1
expect "no terraform order was sent" "$(field "$placed" terraform)" 0
expect "the wall was skipped and counted" "$(field "$placed" skipped)" 1
expect "and the reason was given" "$(field "$placed" why)" "terraforming_is_not_available_here"
expect "nothing was off the map, left over or blocked" "$(field "$placed" offMap)/$(field "$placed" remainder)/$(field "$placed" blocked)" "0/0/0"
queue="$(line 'PROBE queue ')"
expect "the builder's queue holds the build order alone" "$(printf '%s' "$queue" | awk '{ print $NF }' | grep -cE '^-[0-9]+$' || true)" 1

expect "the turret was started" "$(grep -c "FIXTURE created .*unit=$turret " "$LOG" || true)" 1
finished="$(line "FIXTURE finished .*unit=$turret ")"
expect "the turret was finished" "$([ -n "$finished" ] && echo yes || echo no)" yes
expect "the turret stands on the ground as it was" "$(awk -v g="$(field "$finished" ground)" -v o="$(field "$finished" orig)" 'BEGIN { printf "%.1f", g - o }')" "0.0"
profile="$(line 'FIXTURE profile-z ' | tr ' ' '\n' | awk -F: '$1 ~ /^[0-9]+$/ { printf "%s%s", sep, $2; sep = " " } END { print "" }')"
expect "the ground across where the wall would be is as it was" "$profile" "0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0"

echo
if [ "$failures" -ne 0 ]; then
  echo "$failures failed. The logs are in $WORK"
  exit 1
fi
rm -r "$WORK"
echo "all passed in ${SECONDS}s"
