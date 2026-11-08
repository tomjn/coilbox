#!/usr/bin/env bash
# Run the tests that pin a generated unit under Node, which is V8, the engine
# of Windows' webview (#5113). `bun run test` runs vitest on JavaScriptCore
# (bunfig.toml), the engine of the macOS and Linux webviews, so the two runs
# together cover both. Needs `node` on PATH. lint.yml and check.sh call this.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if ! command -v node >/dev/null; then
  echo "scripts/vitest-v8.sh needs node on PATH (vitest runs on it, which is V8)" >&2
  exit 1
fi

exec node node_modules/vitest/vitest.mjs run \
  src/lego/generate.test.ts \
  src/lego/generatorJobs.test.ts \
  src/lego/portableAngles.test.ts \
  src/lego/portableRotation.test.ts \
  src/lego/reroll.test.ts
