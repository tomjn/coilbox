#!/usr/bin/env bash
# Bakes Persepolis's feature types in SHARDS vitest processes side by side,
# each into the bake cache only, then runs the map export, which finds every
# bake in the cache. Arguments go to that last vitest run.
#
#   DENSITY=256 ./bake-parallel.sh
#
# SHARDS defaults to 4, the most parallel lanes this 8 core, 16 GB Mac has
# been run with comfortably. Each shard's output is in docs/reports/town-models/shard-logs/.
set -euo pipefail
cd "$(dirname "$0")"
SHARDS=${SHARDS:-4}
export DENSITY=${DENSITY:-256}
LOGS=../../docs/reports/town-models/shard-logs
mkdir -p "$LOGS"
pids=()
for i in $(seq 0 $((SHARDS - 1))); do
  # No time limit: the config's 600 s is less than a full bake, and a busy machine slows a shard down.
  SHARD="$i/$SHARDS" bunx vitest run map.test.ts -t "city map" --testTimeout=0 >"$LOGS/$i.log" 2>&1 &
  pids+=($!)
done
failed=0
for i in "${!pids[@]}"; do
  if ! wait "${pids[$i]}"; then
    echo "shard $i failed, see $LOGS/$i.log"
    failed=1
  fi
done
[ "$failed" = 0 ] || exit 1
bunx vitest run map.test.ts --testTimeout=0 "$@"
