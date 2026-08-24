# Resolve the headless engine and its base content for a mission harness.
#
# Sourced, not run, with DATA_DIR already set. Sets ENGINE to a spring-headless
# binary and BASE_CONTENT to a base/ directory to link into the scratch data
# directory, or exits 2 naming what is missing.
#
# The base content matters as much as the binary: the engine parses even its
# start script with Lua it loads out of springcontent.sdz, and without one it
# dies claiming "GAME-section missing" from a script that has one, which points
# nowhere near the cause. So the hunt only accepts a binary that has base
# content, and prefers the copy beside the binary, the way an installed engine
# under engine/<platform>/<version>/ ships, because that copy always matches.
#
#   COILBOX_SPRING_HEADLESS  the binary. Default is the first spring-headless
#                            with base content: loose in DATA_DIR, then the
#                            installed engines under its engine/, then PATH.

usable_base() { # directory holding a spring-headless
  [ -d "$1/base" ] || [ -d "$DATA_DIR/base" ]
}

ENGINE="${COILBOX_SPRING_HEADLESS:-}"
if [ -z "$ENGINE" ]; then
  candidates=("$DATA_DIR/spring-headless")
  for bin in "$DATA_DIR"/engine/*/*/spring-headless; do
    candidates+=("$bin")
  done
  candidates+=("$(command -v spring-headless || true)")
  for bin in "${candidates[@]}"; do
    { [ -n "$bin" ] && [ -x "$bin" ] && usable_base "$(dirname "$bin")"; } || continue
    ENGINE="$bin"
    break
  done
fi
if [ -z "$ENGINE" ] || [ ! -x "$ENGINE" ]; then
  echo "no headless engine with base content. Set COILBOX_SPRING_HEADLESS to a spring-headless binary" >&2
  exit 2
fi

BASE_CONTENT="$(dirname "$ENGINE")/base"
[ -d "$BASE_CONTENT" ] || BASE_CONTENT="$DATA_DIR/base"
if [ ! -d "$BASE_CONTENT" ]; then
  echo "no base content: neither $(dirname "$ENGINE")/base nor $DATA_DIR/base exists" >&2
  exit 2
fi
