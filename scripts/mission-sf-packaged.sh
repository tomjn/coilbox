#!/usr/bin/env bash
# Prove a packaged game plays a mission it ships inside itself (issue #2160).
#
# Every other proof on this feature runs against a loose .sdd, because that was
# the only kind coilbox could put a mission into: it compiled the scenario and
# wrote missions/<id>/mission.lua into the game folder on the way to launching,
# so a packaged .sd7 fell to the generated test mutator however complete its
# runtime was. A game that ships its own missions has nothing to write, so being
# unwritable stops mattering. This is the run that settles that.
#
# So the shape is different from scripts/mission-sf-proof.sh in one way that is
# the whole point: there is no mutator. The content root holds one game archive,
# a .sd7 built here out of the Splinter Faction working copy, and everything the
# engine plays comes out of that one file. Nothing is written into it and nothing
# is written beside it, which the script checks rather than assumes.
#
# What goes into the archive:
#
#   the game            copied from the loose checkout, minus its .git
#   the runtime         through coilbox's own install, not a copy of it
#   the guards          scripts/sf-proof/splinterfaction-guards.patch
#   the mission         src/scenario/fixtures/missions/splinter/mission.lua and
#                       src/scenario/fixtures/splinter.json, at
#                       missions/first-contact/
#   the probe           scripts/sf-proof/packaged-probe.lua
#
# The probe is in the archive because there is nowhere else for it to go. A
# headless run needs somebody to ask for a faster speed and to quit at the end,
# and reading a rules param needs Lua in the game. It sits behind the runtime and
# the game's own gadgets and only reads.
#
# What this proves is the engine half: a packaged archive is a place the runtime
# can read a mission out of, and a mission read that way plays to its own ending
# with the game's guards holding. It does not exercise coilbox's route decision,
# which is TypeScript and is covered by the table in src/scenario/launch.test.ts.
# Nothing here runs coilbox, so "no mutator was written" is a claim about this
# run's content root, not about what the app would have chosen.
#
# The loose checkout is never written to. Everything happens in a copy, which is
# about 1.4 GB and is deleted as soon as the archive is built.
#
# Usage: scripts/mission-sf-packaged.sh [--keep]
#
#   --keep                   leave the scratch directory, archive and logs behind
#
#   COILBOX_SPRING_HEADLESS  the binary. Default is the first spring-headless
#                            with base content beside it or in the data
#                            directory: loose in COILBOX_SPRING_DATA, then the
#                            installed engines under its engine/, then PATH.
#   COILBOX_SPRING_DATA      where games/ and maps/ are. Default ~/.spring.
#   COILBOX_SF_GAME          the game folder under games/. It must be a loose
#                            .sdd. Default SplinterFaction.sdd.
#   COILBOX_HARNESS_MAP      the map archive's filename under maps/. Default the
#                            first one there.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROOF="$ROOT/scripts/sf-proof"
# The game's own name for the mission, which is what coilbox_mission carries and
# what the runtime turns into a VFS path. A readable folder rather than a UUID,
# because that is what tells coilbox this is the game's content and not a stray
# left over from a test.
MISSION_FOLDER=first-contact
MISSION_SRC="$ROOT/src/scenario/fixtures/missions/splinter/mission.lua"
DOCUMENT_SRC="$ROOT/src/scenario/fixtures/splinter.json"
GUARDS_PATCH="$PROOF/splinterfaction-guards.patch"

KEEP=0
for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=1 ;;
    *)
      echo "unknown argument: $arg" >&2
      echo "usage: scripts/mission-sf-packaged.sh [--keep]" >&2
      exit 2
      ;;
  esac
done

DATA_DIR="${COILBOX_SPRING_DATA:-$HOME/.spring}"
SF_GAME="${COILBOX_SF_GAME:-SplinterFaction.sdd}"
SF_DIR="$DATA_DIR/games/$SF_GAME"

# The engine and the base content to run it on, shared with every harness.
. "$ROOT/scripts/mission-engine.sh"

[ -d "$SF_DIR" ] || { echo "no loose game at $SF_DIR" >&2; exit 2; }
[ -f "$MISSION_SRC" ] || { echo "no compiled mission at $MISSION_SRC" >&2; exit 2; }
[ -f "$DOCUMENT_SRC" ] || { echo "no scenario document at $DOCUMENT_SRC" >&2; exit 2; }
command -v 7zz >/dev/null || {
  echo "packaging the game needs 7zz on PATH (brew install sevenzip)" >&2
  exit 2
}
command -v rsync >/dev/null || { echo "copying the game needs rsync on PATH" >&2; exit 2; }
command -v git >/dev/null || { echo "applying the guards needs git on PATH" >&2; exit 2; }

MAP_ARCHIVE="${COILBOX_HARNESS_MAP:-}"
if [ -z "$MAP_ARCHIVE" ]; then
  MAP_ARCHIVE="$(ls "$DATA_DIR/maps" | grep -v '\.md5\.gz$' | grep -E '\.sd[7z]$' | sort | head -n 1 || true)"
  [ -n "$MAP_ARCHIVE" ] || { echo "no map in $DATA_DIR/maps" >&2; exit 2; }
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/coilbox-sf-packaged.XXXXXX")"
COPY="$WORK/loose"
SD7="$WORK/data/games/splinterfaction-packaged.sd7"

cleanup() {
  [ "$KEEP" = 1 ] || rm -rf "$WORK"
}
trap cleanup EXIT

mkdir -p "$WORK/data/games" "$WORK/data/maps" "$WORK/write"
ln -s "$BASE_CONTENT" "$WORK/data/base"
ln -s "$DATA_DIR/maps/$MAP_ARCHIVE" "$WORK/data/maps/$MAP_ARCHIVE"

# A copy, so the loose checkout is never written to and so the guards can be
# applied without anyone being asked. .git is left behind because it is three
# times the size of the game and none of it ships.
echo "copying $SF_GAME..." >&2
rsync -a --exclude '.git' "$SF_DIR/" "$COPY/"

# The runtime goes in through coilbox's own install rather than being trusted to
# already be there, for the reason issue #934 records: a proof that trusted the
# game's copy measured a runtime that had drifted from main and stayed green.
RUNTIME="$(bash "$ROOT/scripts/mission-runtime-install.sh" "$COPY")"
read -r RUNTIME_VERSION RUNTIME_FILES <<<"$RUNTIME"

# The guards are Splinter Faction's own change and are not upstream, so a
# checkout may or may not carry them. This is a scratch copy, so the missing ones
# are added here rather than refused. Splinter Faction's .gitattributes checks
# .lua out with CRLF endings and the patch is stored with LF ones, so the context
# lines only match when the trailing whitespace is ignored.
GAME_END="$COPY/LuaRules/Gadgets/game_end.lua"
GAME_SPAWN="$COPY/LuaRules/Gadgets/game_spawn.lua"
missing=()
grep -q 'GG\.CoilboxMission' "$GAME_END" 2>/dev/null ||
  missing+=("the Spring.GameOver guard")
grep -q 'suppressesStart' "$GAME_SPAWN" 2>/dev/null ||
  missing+=("the suppressesStart guard")
grep -q 'suppressesEveryStart' "$GAME_SPAWN" 2>/dev/null ||
  missing+=("the suppressesEveryStart guard")

if [ "${#missing[@]}" -eq 0 ]; then
  GUARDS="all three, already in the checkout"
elif [ "${#missing[@]}" -eq 3 ]; then
  git -C "$COPY" apply -p1 --ignore-whitespace "$GUARDS_PATCH" || {
    echo "the guards patch did not apply to the copy of $SF_GAME" >&2
    echo "See docs/mission-runtime.md for what it adds." >&2
    exit 2
  }
  GUARDS="all three, patched into the copy"
else
  echo "$SF_GAME has some of the guards already, so the patch cannot be applied whole:" >&2
  printf '  missing %s\n' "${missing[@]}" >&2
  echo "Revert the game's gadgets, or add the rest by hand. See docs/mission-runtime.md" >&2
  exit 2
fi

# The mission the game ships. Both files: the compiled Lua is what plays and the
# document is what an editor would open, and a game that shipped only one of them
# would not be the case this proves.
mkdir -p "$COPY/missions/$MISSION_FOLDER"
cp "$MISSION_SRC" "$COPY/missions/$MISSION_FOLDER/mission.lua"
cp "$DOCUMENT_SRC" "$COPY/missions/$MISSION_FOLDER/scenario.json"

# Named to sort last so the probe reads a frame every other gadget, the game's
# and the runtime's alike, has finished with.
sed "s|@MISSION_FOLDER@|$MISSION_FOLDER|g" "$PROOF/packaged-probe.lua" \
  >"$COPY/LuaRules/Gadgets/zzz_coilbox_packaged_probe.lua"

# -mx=1 rather than the default, because this archive is built every run and read
# once. A player's .sd7 is compressed harder and more solidly, which costs
# coilbox's reader and costs the engine nothing, so it is not what this run is
# about.
echo "packaging $(basename "$SD7")..." >&2
7zz a -bso0 -bsp0 -mx=1 "$SD7" "$COPY"/* >/dev/null

# The loose copy goes now, both because 1.4 GB of scratch is worth not holding
# and because the packaged archive has to be the only Splinter Faction the engine
# can see. The content root below holds one game and it is the .sd7.
rm -r "$COPY"

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
engine --calc-checksum coilbox-sf-packaged-discovery >"$WORK/discover.log" 2>&1 || true

GAME_NAME="$(archive_name "$(basename "$SD7")" 1)"
MAP_NAME="$(archive_name "$MAP_ARCHIVE" 3)"
if [ -z "$GAME_NAME" ]; then
  echo "the engine did not recognise $(basename "$SD7") as a game, see $WORK/discover.log" >&2
  KEEP=1
  exit 2
fi
if [ -z "$MAP_NAME" ]; then
  echo "the engine did not recognise $MAP_ARCHIVE as a map, see $WORK/discover.log" >&2
  KEEP=1
  exit 2
fi

echo "engine:  $ENGINE"
echo "game:    $GAME_NAME, packaged as $(basename "$SD7"), $(du -h "$SD7" | cut -f1 | tr -d ' ')"
echo "map:     $MAP_NAME"
echo "mission: missions/$MISSION_FOLDER/, inside the archive"
echo "runtime: version $RUNTIME_VERSION, $RUNTIME_FILES files from lua/mission-runtime"
echo "guards:  $GUARDS"
echo "mutator: none, which is the point"
echo

LOG="$WORK/$MISSION_FOLDER.log"
SCRIPT="$WORK/$MISSION_FOLDER.script.txt"

MODOPTIONS="$(printf '\t\tcoilbox_mission=%s\x3b' "$MISSION_FOLDER")" \
  GAME_NAME="$GAME_NAME" MAP_NAME="$MAP_NAME" \
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

# What the content root's games directory was before the run, to compare with
# after. A mission that needed writing would have to land here.
BEFORE="$(ls -l "$WORK/data/games")"

if ! engine "$SCRIPT" >"$LOG" 2>&1; then
  echo "the engine exited nonzero, see $LOG"
  KEEP=1
  exit 1
fi

grep 'HARNESS note ' "$LOG" | sed 's/^.*HARNESS note /  note /' || true
grep 'HARNESS fail ' "$LOG" | sed 's/^.*HARNESS fail /  fail /' || true

passed=$(grep -c 'HARNESS ok ' "$LOG" || true)
failed=$(grep -c 'HARNESS fail ' "$LOG" || true)

# The gadget the archive carries has to be the one that loaded. Matched without
# case, because the wording is the game's own gadget handler's: Splinter
# Faction's says "Loaded SYNCED gadget".
if [ "$(grep -ci 'Loaded synced gadget: *Coilbox mission runtime' "$LOG" || true)" -eq 0 ]; then
  echo "  fail the runtime gadget in the packaged archive did not load"
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

# The assertion the feature exists for. The mutator is a whole game folder
# coilbox writes next to the one being played, so anything that fell back to it
# would leave a coilbox-mission-test.sdd in this content root. The archive itself
# is one file, so a mission written into the game would change it.
strays="$(find "$WORK" -name 'coilbox-mission-test.sdd' -print)"
if [ -n "$strays" ]; then
  echo "  fail the test mutator was written:"
  printf '    %s\n' "$strays"
  failed=$((failed + 1))
else
  echo "  ok no coilbox-mission-test.sdd was written anywhere in the content root"
  passed=$((passed + 1))
fi
AFTER="$(ls -l "$WORK/data/games")"
if [ "$AFTER" != "$BEFORE" ]; then
  echo "  fail the games directory changed during the run, before:"
  echo "$BEFORE"
  echo "  and after:"
  echo "$AFTER"
  failed=$((failed + 1))
else
  echo "  ok the packaged game was played without being written to"
  passed=$((passed + 1))
fi

echo
echo "  $passed passed, $failed failed"
if [ "$failed" -eq 0 ]; then
  echo "all passed: a packaged game played the mission it ships, and nothing was written"
else
  echo "the engine log is in $LOG"
  KEEP=1
  exit 1
fi
