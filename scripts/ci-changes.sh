#!/usr/bin/env bash
# Read a pull request's changed files on stdin and print which lint.yml jobs
# they can affect, as `rust=true|false` and `lua=true|false` lines for
# $GITHUB_OUTPUT. The frontend jobs always run, so they are not listed.
#
# The rules go by path, not file type. Rust embeds src/data, lua/ and its
# Markdown, and tauri-build reads the images in src-tauri/icons. Vitest reads
# Markdown under docs/ as well.
#
# rust: false when every file is in src/ outside src/data, in docs/, or a
#       Markdown file at the root. Anything else may reach a crate.
# lua:  true when a file is in lua/ or is the script that runs its suites.
#
# A change to this script or to lint.yml runs every job, so the filter is
# tested by the run it would otherwise skip.
set -uo pipefail

rust=false
lua=false
while IFS= read -r file; do
  [ -n "$file" ] || continue
  case "$file" in
    .github/workflows/lint.yml | scripts/ci-changes.sh)
      rust=true
      lua=true
      ;;
    lua/* | scripts/mission-tests.sh)
      rust=true
      lua=true
      ;;
    src/data/*) rust=true ;;
    src/* | docs/*) ;;
    */*) rust=true ;;
    *.md) ;;
    *) rust=true ;;
  esac
done

echo "rust=$rust"
echo "lua=$lua"
