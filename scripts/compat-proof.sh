#!/usr/bin/env bash
# Count the Lua errors each fixture game logs on a current engine, without and
# with its compat mutator (issue #4566).
#
# 1. Builds each game's mutator from the latest compat manifest, through the
#    same build the app's compat build command runs
#    (crates/tauri-plugin-coilbox-compat/examples/compat_proof_build.rs), into a
#    scratch content root. Nothing is written beside the games themselves.
# 2. Plays a headless match with two NullAI teams to frame 3000, once on the
#    base game and once on the mutator.
# 3. Counts the error lines in each run's infolog: every line with "Error" in
#    it, and every LuaRules or LuaUI line with "error" in it in any case, except
#    a line the engine logged at the warning level. The engine warns that it
#    cannot readlink() every folder archive, the mutator among them, and the
#    warning quotes the system's "Error" text.
# 4. Writes a table to docs/reports/compat-proof/<date>-<time>.md with the
#    counts, how each run ended, a verdict, the first three error lines on the
#    mutator and the first three the base game did not log.
#
# The verdict, and the exit code, follow one rule. A run "plays" when it logs
# the end gadget's line at the frame, or any line at or past it. The second
# covers a game whose gadget handler fails, so the end gadget never runs.
#
# - The base game plays: the mutator must play too, with at most as many
#   errors. Anything else is worse.
# - The base game does not play and the mutator does: better, whatever the
#   counts. A game that dies while loading logs a few errors and stops, so its
#   count says nothing about a mutator that plays on to the frame.
# - Neither plays: the mutator must have at most as many errors.
#
# The script exits 1 if any game is worse.
#
# The match is ended by a gadget in a scratch map wrapped around a real one
# (lua/compat/tests/headless/proof_end.lua), not by a scratch game, because a
# game on top would change the name and version the game under test sees, and
# some of the fixtures read them. A run that never logs the gadget's line did
# not reach the frame, which the table says.
#
# Needs a headless engine with libunitsync beside it, the games and the map,
# luajit, 7zz or unzip, and a built unitsync worker (cargo build -p
# coilbox-unitsync-worker). CI has none of these and does not run this script.
#
# Usage: scripts/compat-proof.sh [archive ...]
# Default: the five fixture games below, from games/ in COILBOX_SPRING_DATA.
#
#   COILBOX_SPRING_HEADLESS  the binary. Default is the newest installed
#                            engine's spring-headless, by version.
#   COILBOX_SPRING_DATA      where games/ and maps/ are. Default ~/.spring.
#   COILBOX_COMPAT_PROOF_MAP the map archive's filename under maps/. It needs a
#                            mapinfo.lua, which the scratch map wraps. Default
#                            Small_Supreme_Battlefield_v3.sd7.
#   COILBOX_COMPAT_PROOF_FRAMES  the frame to play to. Default 3000.
#   COILBOX_COMPAT_PROOF_TIMEOUT the seconds one match may take before it is
#                            stopped. Default 120.
#   COILBOX_COMPAT_PROOF_ENGINE_LUAUI  1 links the engine's LuaUI/, luaui.lua,
#                            fonts/, cmdcolors.txt and ctrlpanel.txt into the
#                            scratch data folder, as a player's install can
#                            read them beside the binary. They are what the
#                            engine installs from its cont/ folder, apart from
#                            base/, which is always linked, and examples/,
#                            which no game reads.
#                            0 leaves them out. Default 1, because the proof is
#                            about what a player sees, and a game that includes
#                            the engine's LuaUI files fails differently without
#                            them.
#   UNITSYNC_WORKER          the unitsync worker. Default
#                            target/debug/coilbox-unitsync-worker.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HEADLESS="$ROOT/lua/compat/tests/headless"
TARGET="${CARGO_TARGET_DIR:-$ROOT/target}"

DATA_DIR="${COILBOX_SPRING_DATA:-$HOME/.spring}"

if [ -z "${COILBOX_SPRING_HEADLESS:-}" ]; then
  COILBOX_SPRING_HEADLESS="$(ls -d "$DATA_DIR"/engine/*/*/spring-headless 2>/dev/null | sort -V | tail -n 1 || true)"
fi
# The engine and the base content to run it on, shared with every harness.
. "$ROOT/scripts/mission-engine.sh"
ENGINE_DIR="$(dirname "$ENGINE")"

GAMES=("$@")
[ ${#GAMES[@]} -gt 0 ] || GAMES=(
  xta-9.65.sd7
  balanced_annihilation-v15.9.8.sdz
  complete_annihilation-stable-8405.sdz
  expand_and_exterminate-0.46_for_spring_0.88.sdz
  spring_1944-2.31.sdz
)
MAP_ARCHIVE="${COILBOX_COMPAT_PROOF_MAP:-Small_Supreme_Battlefield_v3.sd7}"
FRAMES="${COILBOX_COMPAT_PROOF_FRAMES:-3000}"
# The slowest run to reach frame 3000 on 19 October 2026 took 35s, Balanced
# Annihilation on an Apple silicon Mac. This allows over three times that.
RUN_TIMEOUT="${COILBOX_COMPAT_PROOF_TIMEOUT:-120}"
ENGINE_LUAUI="${COILBOX_COMPAT_PROOF_ENGINE_LUAUI:-1}"
case "$ENGINE_LUAUI" in
  0 | 1) ;;
  *) echo "COILBOX_COMPAT_PROOF_ENGINE_LUAUI must be 0 or 1, not $ENGINE_LUAUI" >&2; exit 2 ;;
esac

for needed in "${GAMES[@]/#/games/}" "maps/$MAP_ARCHIVE"; do
  if [ ! -e "$DATA_DIR/$needed" ]; then
    echo "no $needed in $DATA_DIR" >&2
    exit 2
  fi
done
command -v luajit >/dev/null || { echo "luajit is not on PATH (brew install luajit)" >&2; exit 2; }
command -v timeout >/dev/null || { echo "timeout is not on PATH (brew install coreutils)" >&2; exit 2; }
case "$MAP_ARCHIVE" in
  *.sd7) command -v 7zz >/dev/null || { echo "7zz is not on PATH (brew install sevenzip)" >&2; exit 2; } ;;
esac

WORKER="${UNITSYNC_WORKER:-$TARGET/debug/coilbox-unitsync-worker}"
if [ ! -x "$WORKER" ]; then
  echo "unitsync worker not found at $WORKER. Build it with: cargo build -p coilbox-unitsync-worker" >&2
  exit 2
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/coilbox-compat-proof.XXXXXX")"
mkdir -p "$WORK/data/games" "$WORK/data/maps" "$WORK/write"

echo "engine: $ENGINE"
echo "work:   $WORK"
echo

echo "== building the mutators"
(cd "$ROOT" && cargo build -q -p tauri-plugin-coilbox-compat --example compat_proof_build)
BUILDER="$TARGET/debug/examples/compat_proof_build"
declare -A MUTATOR
build_failures=0
for archive in "${GAMES[@]}"; do
  # Unitsync reads the games from the data directory itself, so the scratch
  # root holds nothing yet but the mutators it is given.
  if UNITSYNC_WORKER="$WORKER" "$BUILDER" "$ENGINE_DIR" "$WORK/data" "$archive" \
    >"$WORK/$archive.build.txt" 2>"$WORK/$archive.build.log"; then
    MUTATOR[$archive]="$(sed -n 1p "$WORK/$archive.build.txt")"
    MANIFEST="$(sed -n 2p "$WORK/$archive.build.txt")"
    echo "  $archive: ${MUTATOR[$archive]}, $(sed -n 2p "$WORK/$archive.build.txt")"
    sed -n '3,$p' "$WORK/$archive.build.txt" | sed 's/^/    /'
  else
    echo "  fail $archive: the mutator did not build:"
    sed 's/^/    /' "$WORK/$archive.build.log"
    build_failures=$((build_failures + 1))
  fi
done
if [ "$build_failures" -ne 0 ]; then
  echo "$build_failures mutators did not build. The logs are in $WORK"
  exit 1
fi

# The engine runs isolated, so everything it reads is linked in. Unitsync
# refuses a second copy of the base content, so it comes in after the builds.
ln -s "$BASE_CONTENT" "$WORK/data/base"
for archive in "${GAMES[@]}"; do
  ln -s "$DATA_DIR/games/$archive" "$WORK/data/games/$archive"
done
ln -s "$DATA_DIR/maps/$MAP_ARCHIVE" "$WORK/data/maps/$MAP_ARCHIVE"
# The AI libraries live beside the binary, which an isolated engine never reads.
ln -s "$ENGINE_DIR/AI" "$WORK/data/AI"
ENGINE_UI="left out"
if [ "$ENGINE_LUAUI" = 1 ]; then
  ENGINE_UI="linked in"
  for entry in LuaUI luaui.lua fonts cmdcolors.txt ctrlpanel.txt; do
    if [ -e "$ENGINE_DIR/$entry" ]; then
      ln -s "$ENGINE_DIR/$entry" "$WORK/data/$entry"
    else
      echo "the engine has no $entry beside it, so the run cannot match an install. Set COILBOX_COMPAT_PROOF_ENGINE_LUAUI=0" >&2
      exit 2
    fi
  done
fi

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
# the name its archive declares, and only the engine knows what that is. The
# scratch map is not there yet, because an archive scanned before its
# mapinfo.lua was written would be remembered as no map at all.
discover() {
  engine --calc-checksum coilbox-compat-proof-discovery >"$WORK/discover.log" 2>&1 || true
}

discover
MAP_NAME="$(archive_name "$MAP_ARCHIVE" 3)"
if [ -z "$MAP_NAME" ]; then
  echo "the engine did not recognise $MAP_ARCHIVE as a map, see $WORK/discover.log" >&2
  exit 2
fi

# The scratch map: the real map's own mapinfo.lua, renamed and depending on
# the real map, plus the gadget that ends the match.
member() { # archive, file in it
  case "$1" in
    *.sd7) 7zz e -so "$1" "$2" 2>/dev/null ;;
    *) unzip -p "$1" "$2" 2>/dev/null ;;
  esac
}
SMF="$(case "$MAP_ARCHIVE" in
  *.sd7) 7zz l -ba "$DATA_DIR/maps/$MAP_ARCHIVE" ;;
  *) unzip -Z1 "$DATA_DIR/maps/$MAP_ARCHIVE" ;;
esac | grep -oiE 'maps/[^/]+\.smf$' | sed -n 1p || true)"
MAPINFO="$(member "$DATA_DIR/maps/$MAP_ARCHIVE" mapinfo.lua || true)"
if [ -z "$MAPINFO" ] || [ -z "$SMF" ]; then
  echo "$MAP_ARCHIVE has no mapinfo.lua or no .smf, so it cannot be wrapped. Pick another with COILBOX_COMPAT_PROOF_MAP" >&2
  exit 2
fi
PROOF_MAP="$WORK/data/maps/coilbox-compat-proof-map.sdd"
mkdir -p "$PROOF_MAP/LuaRules/Gadgets"
cp "$HEADLESS/proof_end.lua" "$PROOF_MAP/LuaRules/Gadgets/zzz_coilbox_compat_proof_end.lua"
MAPINFO="$MAPINFO" MAP_NAME="$MAP_NAME" SMF="$SMF" OUT="$PROOF_MAP/mapinfo.lua" luajit -e '
  local out = io.open(os.getenv("OUT"), "w")
  out:write("local info = (function()\n", os.getenv("MAPINFO"), "\nend)()\n")
  out:write(string.format("info.name = %q\n", "Coilbox compat proof map"))
  out:write("info.shortname = nil\ninfo.version = nil\n")
  out:write(string.format("info.mapfile = %q\n", os.getenv("SMF")))
  out:write(string.format("info.depend = { %q }\n", os.getenv("MAP_NAME")))
  out:write("return info\n")
  out:close()
'

discover
PROOF_MAP_NAME="$(archive_name coilbox-compat-proof-map.sdd 3)"
if [ -z "$PROOF_MAP_NAME" ]; then
  echo "the engine did not recognise the scratch map, see $WORK/discover.log" >&2
  exit 2
fi
declare -A BASE_NAME MUTATOR_NAME
for archive in "${GAMES[@]}"; do
  BASE_NAME[$archive]="$(archive_name "$archive" 1)"
  MUTATOR_NAME[$archive]="$(archive_name "${MUTATOR[$archive]}" 1)"
  if [ -z "${BASE_NAME[$archive]}" ] || [ -z "${MUTATOR_NAME[$archive]}" ]; then
    echo "the engine did not recognise $archive or ${MUTATOR[$archive]} as a game, see $WORK/discover.log" >&2
    exit 2
  fi
done

echo
echo "map:    $MAP_NAME, wrapped as $PROOF_MAP_NAME"
echo "frames: $FRAMES"
echo

# The lines of a log that count as errors.
error_lines() { # infolog
  awk -f "$ROOT/scripts/compat-proof-errors.awk" "$1"
}

# A log line without its time and frame.
bare() {
  sed -E 's/^(\[[tf]=[^]]*\])+ *//'
}

# Lines as one table cell, each in backticks, with pipes escaped.
cells() {
  sed -E 's/\|/\\|/g; s/`//g' | awk 'BEGIN { ORS = "" } { if (NR > 1) print "<br>"; print "`" $0 "`" }'
}

# Play one match and leave its infolog at the path given.
play() { # game name, infolog to keep
  local script="$WORK/script.txt"
  GAME_NAME="$1" MAP_NAME="$PROOF_MAP_NAME" FRAMES="$FRAMES" \
    TEMPLATE="$HEADLESS/start-script.tdf" SCRIPT="$script" \
    luajit -e '
      local template = io.open(os.getenv("TEMPLATE")):read("*a")
      template = template:gsub("@GAME@", (os.getenv("GAME_NAME"):gsub("%%", "%%%%")))
      template = template:gsub("@MAP@", (os.getenv("MAP_NAME"):gsub("%%", "%%%%")))
      template = template:gsub("@FRAMES@", os.getenv("FRAMES"))
      local out = io.open(os.getenv("SCRIPT"), "w")
      out:write(template)
      out:close()
    '
  rm -f "$WORK/write/infolog.txt"
  local started=$SECONDS status=0
  timeout "$RUN_TIMEOUT" "$ENGINE" --isolation --isolation-dir "$WORK/data" --write-dir "$WORK/write" \
    --only-local "$script" >"$2.stdout" 2>&1 || status=$?
  if [ -f "$WORK/write/infolog.txt" ]; then
    cp "$WORK/write/infolog.txt" "$2"
  else
    cp "$2.stdout" "$2"
  fi
  # The last frame anything was logged on, which is -1 for a game that never
  # finished loading.
  local last
  last="$(grep -oE '^\[t=[^]]*\]\[f=-?[0-9]+\]' "$2" | sed -E 's/.*\[f=(-?[0-9]+)\]/\1/' |
    awk 'BEGIN { m = -1 } { if ($1 + 0 > m) m = $1 + 0 } END { print m }')"
  local reached played=no
  if grep -q "COMPAT PROOF reached frame $FRAMES" "$2"; then
    reached="yes, exit code $status"
    played=yes
  elif [ "$last" -ge "$FRAMES" ]; then
    # The engine logged a line at or past the frame, but the end gadget never
    # said so, which happens when the game's gadget handler fails to load.
    reached="yes, frame $last logged, but nothing ended the match, so it was stopped after ${RUN_TIMEOUT}s"
    played=yes
  elif [ "$status" -eq 124 ]; then
    # Nothing ended the match, which happens when the game's gadget handler
    # never loaded the end gadget, so how far it got is not known.
    reached="not known, stopped after ${RUN_TIMEOUT}s, last logged frame $last"
  else
    reached="no, the engine quit with code $status at frame $last"
  fi
  echo "$reached" >"$2.reached"
  echo "$played" >"$2.played"
  echo "    $(error_lines "$2" | wc -l | tr -d ' ') errors, reached frame $FRAMES: $reached, $((SECONDS - started))s"
}

DATE="$(date +%Y-%m-%d)"
STAMP="$(date +%Y-%m-%d-%H%M%S)"
REPORT_DIR="$ROOT/docs/reports/compat-proof"
REPORT="$REPORT_DIR/$STAMP.md"
mkdir -p "$REPORT_DIR"
ROWS=""
worse=0

for archive in "${GAMES[@]}"; do
  echo "== $archive"
  before="$WORK/$archive.before.infolog.txt"
  after="$WORK/$archive.after.infolog.txt"
  echo "  base game ${BASE_NAME[$archive]}"
  play "${BASE_NAME[$archive]}" "$before"
  echo "  mutator ${MUTATOR_NAME[$archive]}"
  play "${MUTATOR_NAME[$archive]}" "$after"
  n_before="$(error_lines "$before" | wc -l | tr -d ' ')"
  n_after="$(error_lines "$after" | wc -l | tr -d ' ')"
  played_before="$(cat "$before.played")"
  played_after="$(cat "$after.played")"
  if [ "$played_before" = yes ] && [ "$played_after" = no ]; then
    verdict="worse, the base game plays and the mutator does not"
  elif [ "$played_before" = no ] && [ "$played_after" = yes ]; then
    verdict="better, only the mutator plays"
  elif [ "$n_after" -gt "$n_before" ]; then
    verdict="worse, more errors on the mutator"
  elif [ "$played_before" = yes ]; then
    verdict="ok, both play"
  else
    verdict="ok, neither plays"
  fi
  echo "  $verdict"
  case "$verdict" in worse*) worse=$((worse + 1)) ;; esac
  # The first three of the mutator's, and of those the base game did not log,
  # without the timestamps.
  error_lines "$before" | bare | sort -u >"$before.errors"
  first="$(error_lines "$after" | bare | sed -n 1,3p | cells)"
  only="$(error_lines "$after" | bare | awk -v seen="$before.errors" '
    BEGIN { while ((getline line < seen) > 0) had[line] = 1 }
    !($0 in had)' | sed -n 1,3p | cells)"
  ROWS="$ROWS| ${BASE_NAME[$archive]} | $n_before | $(cat "$before.reached") | $n_after | $(cat "$after.reached") | $verdict | $first | $only |
"
done

{
  echo "# Compat proof, $DATE"
  echo
  echo "Engine \`$ENGINE\`, compat $MANIFEST, map $MAP_NAME, two NullAI teams, to frame $FRAMES. The engine's LuaUI, luaui.lua, fonts, cmdcolors.txt and ctrlpanel.txt were $ENGINE_UI. Made by \`scripts/compat-proof.sh\`."
  echo
  echo "A run plays when it reaches frame $FRAMES. If the base game plays, the mutator must play with at most as many errors. If only the mutator plays, it is better whatever the counts, because a game that dies while loading stops logging. If neither plays, the mutator must have at most as many errors."
  echo
  echo "| Game | Errors before | Reached frame before | Errors after | Reached frame after | Verdict | First three error lines after | First three only after |"
  echo "| --- | --- | --- | --- | --- | --- | --- | --- |"
  printf '%s' "$ROWS"
} >"$REPORT"

echo
echo "report: $REPORT"
if [ "$worse" -eq 0 ]; then
  rm -r "$WORK"
  echo "no game is worse on its mutator"
else
  echo "$worse games are worse on their mutator. The logs are in $WORK"
  exit 1
fi
