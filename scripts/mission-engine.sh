# Resolve the headless engine and its base content for a mission harness.
#
# Sourced, not run, with DATA_DIR already set. Sets ENGINE to a spring-headless
# binary and BASE_CONTENT to a base/ directory to link into the scratch data
# directory, or exits 2 naming what is missing.
#
# The base content matters as much as the binary: the engine parses even its
# start script with Lua it loads out of springcontent.sdz, and without one it
# dies claiming "GAME-section missing" from a script that has one, which points
# nowhere near the cause. An installed engine ships its own beside the binary.
#
# There is one engine for this work, ENGINE_VERSION, and nothing searches for
# another: an older build behaves and renders differently, so its results are
# not evidence. If it is not installed the harness stops (#4827).
#
#   COILBOX_SPRING_HEADLESS  a spring-headless binary to use instead, for
#                            someone who means to.

ENGINE_VERSION="2026.09.01"
ENGINE_PLATFORM="macos_arm64"

if [ -n "${COILBOX_SPRING_HEADLESS:-}" ]; then
  ENGINE="$COILBOX_SPRING_HEADLESS"
else
  ENGINE="$DATA_DIR/engine/$ENGINE_PLATFORM/$ENGINE_VERSION/spring-headless"
fi
if [ ! -x "$ENGINE" ]; then
  if [ -n "${COILBOX_SPRING_HEADLESS:-}" ]; then
    echo "COILBOX_SPRING_HEADLESS is $ENGINE, which is not an executable" >&2
  else
    echo "engine $ENGINE_VERSION is not installed: expected $ENGINE" >&2
    echo "Install engine $ENGINE_VERSION there, or set COILBOX_SPRING_HEADLESS to a spring-headless binary on purpose." >&2
  fi
  exit 2
fi

BASE_CONTENT="$(dirname "$ENGINE")/base"
[ -d "$BASE_CONTENT" ] || BASE_CONTENT="$DATA_DIR/base"
if [ ! -d "$BASE_CONTENT" ]; then
  echo "no base content: neither $(dirname "$ENGINE")/base nor $DATA_DIR/base exists" >&2
  exit 2
fi
