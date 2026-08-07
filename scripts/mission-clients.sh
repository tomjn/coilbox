#!/usr/bin/env bash
# Watch three real clients decide what a mission aimed at one of them (#953).
#
# `camera_pan` and `map_marker` take a team. The synced half resolves the
# participant into an engine team and sends it along, and every client is handed
# the same message. Which of them acts on it is decided in the runtime's own
# unsynced half, against Spring.GetMyTeamID(). scripts/mission-headless.sh runs
# one client, so it can only read what arrived. Nothing there can watch a second
# client drop a message, and nothing there has a spectator at all.
#
# So this plays one ambush across three spring-headless processes at once: a
# host on the team the fixture's camera move and first marker name, a second
# player on the other team, and a spectator watching as the first. Each writes
# its own log and makes its own claim, and the script counts all three.
#
# The scratch game is the harness game with a different probe:
# lua/mission-runtime/tests/headless/clients-probe.lua, which counts the engine
# calls the runtime's unsynced half makes. The runtime itself goes in through
# coilbox's own install, the way it does everywhere else (issue #936).
#
# Usage: scripts/mission-clients.sh
#
#   COILBOX_SPRING_HEADLESS  the binary. Default is spring-headless in
#                            COILBOX_SPRING_DATA, then one on PATH.
#   COILBOX_SPRING_DATA      where games/ and maps/ are. Default ~/.spring.
#   COILBOX_HARNESS_GAME     the base game archive's filename under games/.
#                            Default the first balanced_annihilation-* there.
#   COILBOX_HARNESS_MAP      the map archive's filename under maps/. Default the
#                            first one there.
#   COILBOX_HARNESS_PORT     the port the host listens on. Default a random one
#                            above 20000, because nothing here can ask the
#                            engine which port it got.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME="$ROOT/lua/mission-runtime"
HEADLESS="$RUNTIME/tests/headless"
FIXTURES="$ROOT/src/scenario/fixtures/missions"

# The fixture with a camera move and a marker for one participant, and a second
# marker for everyone.
MISSION_ID=ambush

# How long any one client may take before the run is a hang rather than a
# failure. The mission itself is 200 frames.
CLIENT_TIMEOUT=180

DATA_DIR="${COILBOX_SPRING_DATA:-$HOME/.spring}"

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
command -v timeout >/dev/null || {
  echo "this needs timeout on PATH, so a client that never connects is a failure" >&2
  exit 2
}

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

PORT="${COILBOX_HARNESS_PORT:-$((20000 + RANDOM % 20000))}"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/coilbox-mission-clients.XXXXXX")"
GAME="$WORK/data/games/coilbox-mission-clients.sdd"

# One data directory shared by all three, read only to every one of them, and a
# write directory each. Two engines cannot share one, because each writes a
# cache, a log and a demo of its own.
mkdir -p "$WORK/data/games" "$WORK/data/maps" \
  "$WORK/write-aimed" "$WORK/write-other" "$WORK/write-watcher"
ln -s "$DATA_DIR/base" "$WORK/data/base"
ln -s "$DATA_DIR/games/$GAME_ARCHIVE" "$WORK/data/games/$GAME_ARCHIVE"
ln -s "$DATA_DIR/maps/$MAP_ARCHIVE" "$WORK/data/maps/$MAP_ARCHIVE"

CACHE="$WORK/write-aimed/cache/ArchiveCache22.lua"

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

# The same trick scripts/mission-headless.sh uses: a run that is going to fail
# still scans the archives and writes the cache first, and only the engine knows
# what name an archive declares. The scratch game is deliberately not there yet,
# because one read before it had a modinfo.lua is remembered as no game at all.
discover() { # a label for the log
  "$ENGINE" --isolation --isolation-dir "$WORK/data" --write-dir "$WORK/write-aimed" \
    --only-local --calc-checksum "$1" >"$WORK/discover.log" 2>&1 || true
}

discover coilbox-clients-discovery
BASE_NAME="$(archive_name "$GAME_ARCHIVE" 1)"
MAP_NAME="$(archive_name "$MAP_ARCHIVE" 3)"
if [ -z "$BASE_NAME" ] || [ -z "$MAP_NAME" ]; then
  echo "the engine did not recognise $GAME_ARCHIVE as a game or $MAP_ARCHIVE as a map" >&2
  exit 2
fi

mkdir -p "$GAME"
RUNTIME_INSTALL="$(bash "$ROOT/scripts/mission-runtime-install.sh" "$GAME")"
read -r RUNTIME_VERSION RUNTIME_FILES <<<"$RUNTIME_INSTALL"
mkdir -p "$GAME/luarules/gadgets" "$GAME/missions/$MISSION_ID"
cp "$HEADLESS/clients-probe.lua" "$GAME/luarules/gadgets/zzz_coilbox_clients_probe.lua"
cp "$FIXTURES/$MISSION_ID/mission.lua" "$GAME/missions/$MISSION_ID/mission.lua"
sed "s|@BASE@|$BASE_NAME|g" "$HEADLESS/modinfo.lua" >"$GAME/modinfo.lua"

discover coilbox-clients-discovery-2
GAME_NAME="$(archive_name coilbox-mission-clients.sdd 1)"
if [ -z "$GAME_NAME" ]; then
  echo "the engine did not recognise the scratch game, see $WORK/discover.log" >&2
  exit 2
fi

MODOPTIONS="$(printf '\t\tcoilbox_mission=%s\x3b' "$MISSION_ID")" \
  GAME_NAME="$GAME_NAME" MAP_NAME="$MAP_NAME" PORT="$PORT" \
  TEMPLATE="$HEADLESS/clients-host.tdf" SCRIPT="$WORK/host.script.txt" \
  luajit -e '
    local template = io.open(os.getenv("TEMPLATE")):read("*a")
    template = template:gsub("@GAME@", os.getenv("GAME_NAME"))
    template = template:gsub("@MAP@", os.getenv("MAP_NAME"))
    template = template:gsub("@PORT@", os.getenv("PORT"))
    template = template:gsub("@MODOPTIONS@", (os.getenv("MODOPTIONS"):gsub("%%", "%%%%")))
    local out = io.open(os.getenv("SCRIPT"), "w")
    out:write(template)
    out:close()
  '

for name in other watcher; do
  NAME="$name" PORT="$PORT" TEMPLATE="$HEADLESS/clients-client.tdf" \
    SCRIPT="$WORK/$name.script.txt" luajit -e '
      local template = io.open(os.getenv("TEMPLATE")):read("*a")
      template = template:gsub("@PORT@", os.getenv("PORT"))
      template = template:gsub("@NAME@", os.getenv("NAME"))
      local out = io.open(os.getenv("SCRIPT"), "w")
      out:write(template)
      out:close()
    '
done

echo "engine:  $ENGINE"
echo "game:    $BASE_NAME"
echo "map:     $MAP_NAME"
echo "mission: $MISSION_ID"
echo "runtime: version $RUNTIME_VERSION, $RUNTIME_FILES files from lua/mission-runtime"
echo "clients: aimed (team 0, hosting on port $PORT), other (team 1), watcher (spectating)"
echo

client() { # write directory, start script, log
  timeout "$CLIENT_TIMEOUT" "$ENGINE" --isolation --isolation-dir "$WORK/data" \
    --write-dir "$1" "$2" >"$3" 2>&1
}

# The host first, because the other two have nothing to connect to until its
# server is listening. A client that starts too early gives up rather than
# retrying, so this waits for the line the engine writes when the socket is up.
client "$WORK/write-aimed" "$WORK/host.script.txt" "$WORK/aimed.log" &
AIMED=$!

listening=0
for _ in $(seq 1 60); do
  if grep -q 'successfully bound socket' "$WORK/aimed.log" 2>/dev/null; then
    listening=1
    break
  fi
  kill -0 "$AIMED" 2>/dev/null || break
  sleep 1
done
if [ "$listening" -eq 0 ]; then
  echo "the host never opened a socket on port $PORT, see $WORK/aimed.log" >&2
  kill "$AIMED" 2>/dev/null || true
  exit 1
fi

client "$WORK/write-other" "$WORK/other.script.txt" "$WORK/other.log" &
OTHER=$!
client "$WORK/write-watcher" "$WORK/watcher.script.txt" "$WORK/watcher.log" &
WATCHER=$!

exits=0
for pid in $AIMED $OTHER $WATCHER; do
  wait "$pid" || exits=$((exits + 1))
done

failures=0

for name in aimed other watcher; do
  log="$WORK/$name.log"
  echo "== $name"
  grep 'HARNESS note ' "$log" | sed 's/^.*HARNESS note /  note /' || true
  grep 'HARNESS fail ' "$log" | sed 's/^.*HARNESS fail /  fail /' || true

  passed=$(grep -c 'HARNESS ok ' "$log" || true)
  failed=$(grep -c 'HARNESS fail ' "$log" || true)

  # A client that never joined would make no claim at all, and no claims is not
  # the same as no failures.
  if [ "$(grep -c 'HARNESS done' "$log" || true)" -eq 0 ]; then
    echo "  fail this client never reached the end of the mission"
    failed=$((failed + 1))
  fi
  errors=$(grep -c '\[coilbox-mission\] Error' "$log" || true)
  if [ "$errors" -gt 0 ]; then
    grep '\[coilbox-mission\] Error' "$log" | sed 's/^.*\[coilbox-mission\] /  fail runtime /'
    failed=$((failed + errors))
  fi

  echo "  $passed passed, $failed failed"
  failures=$((failures + failed))
done

if [ "$exits" -gt 0 ]; then
  echo
  echo "$exits of the three clients exited nonzero"
  failures=$((failures + exits))
fi

echo
if [ "$failures" -eq 0 ]; then
  rm -r "$WORK"
  echo "all passed"
else
  echo "$failures failed. The engine logs are in $WORK"
  exit 1
fi
