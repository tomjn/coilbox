#!/usr/bin/env bash
# Fail when source adds a hand-rolled English plural such as
# `${n === 1 ? "" : "s"}`, or a local `plural` helper (#4605). A translator
# cannot reshape a word and a separate "s", so a count goes through an ICU
# `plural` message. A line that is not about a count passes with a
# `// i18n: not a plural` comment on it.
#
# Plain grep so CI and a local run give the same answer.
# src/container/container.ts is left out because the hub vendors it by blob
# hash. Tests and the catalogs are left out because they are not shipped copy.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

ternary='(===|!==|>|<=) ?1 ?\? ?["'"'"'`]'
helper='(function plural\b|const plural =)'

hits=$(
  grep -rnE "$ternary|$helper" src \
    --include='*.ts' --include='*.tsx' \
    --exclude='*.test.ts' --exclude='*.test.tsx' --exclude-dir=locales |
    grep -v '^src/container/container\.ts:' |
    grep -v 'i18n: not a plural'
)

if [ -n "$hits" ]; then
  echo "Hand-rolled plural found. Use an ICU plural message, or add"
  echo "'// i18n: not a plural' to a line that is not about a count:"
  echo
  echo "$hits"
  exit 1
fi
echo "No hand-rolled plurals."
