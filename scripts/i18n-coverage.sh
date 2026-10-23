#!/usr/bin/env bash
# Prints a markdown table of how much of each locale is translated, for the
# frontend job's summary (#4599). The counts come from the table that
# `lingui extract --verbose` prints, saved to the file named by $1.
#
#   bunx lingui extract --clean --verbose > extract.log
#   scripts/i18n-coverage.sh extract.log
set -euo pipefail

log=${1:?usage: i18n-coverage.sh <lingui extract --verbose output>}

# Rows of the statistics table as "locale total missing", without the header
# and the source locale's row. Colour codes are stripped in case the output
# went to a terminal.
rows=$(awk -F'│' '
  { gsub(/\033\[[0-9;]*m/, "") }
  NF == 5 && $2 !~ /Language|source/ {
    for (i = 2; i <= 4; i++) gsub(/ /, "", $i)
    print $2, $3, $4
  }
' "$log")

echo "## Translation coverage"
echo
if [ -z "$rows" ]; then
  echo "No catalog statistics in the \`lingui extract --verbose\` output."
  exit 0
fi

echo "| Locale | Translated | Missing |"
echo "| --- | --- | --- |"
while read -r locale total missing; do
  # Rounded down, so a locale missing a few strings never shows 100.0%.
  awk -v l="$locale" -v t="$total" -v m="$missing" 'BEGIN {
    done = t - m
    pct = t > 0 ? int(done * 1000 / t) / 10 : 0
    printf "| %s | %d of %d (%.1f%%) | %d |\n", l, done, t, pct, m
  }'
done <<<"$rows"
