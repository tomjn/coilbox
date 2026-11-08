#!/usr/bin/env node
// Prints the best frame time of every map and pose from run.mjs's .jsonl
// files, one column a file, with the headroom under 60 frames a second (16.7
// ms) and the range of the 1 minute load average at the start of the runs
// behind each cell. run.mjs refuses to start a run at or above 6.
//
//   node scripts/map-frame-timing/summary.mjs old.jsonl new.jsonl new-perf.jsonl
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const BUDGET_MS = 1000 / 60;
const POSES = ["far", "close", "tilt"];
const files = process.argv.slice(2);
if (files.length === 0) throw new Error("give one or more .jsonl files");

const rows = files.map((f) =>
  readFileSync(f, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l)),
);
const maps = [...new Set(rows.flat().map((r) => r.map))];
const names = files.map((f) => basename(f, ".jsonl"));

const cell = (rs, map, pose) => {
  const mine = rs.filter((r) => r.map === map);
  if (mine.length === 0) return undefined;
  const loads = mine.map((r) => r.loadBefore);
  return {
    ms: Math.min(...mine.map((r) => r.frames[pose].best)),
    runs: mine.length,
    lo: Math.min(...loads),
    hi: Math.max(...loads),
  };
};

console.log(
  `view | ${names.map((n) => `${n} ms`).join(" | ")} | headroom to ${BUDGET_MS.toFixed(1)} ms (${names.at(-1)}) | load`,
);
for (const map of maps) {
  for (const pose of POSES) {
    const cells = rows.map((rs) => cell(rs, map, pose));
    const last = cells.at(-1);
    const lo = Math.min(...cells.filter(Boolean).map((c) => c.lo));
    const hi = Math.max(...cells.filter(Boolean).map((c) => c.hi));
    console.log(
      `${map} ${pose} | ${cells.map((c) => (c ? `${c.ms.toFixed(2)} (${c.runs} runs)` : "-")).join(" | ")} | ${last ? (BUDGET_MS - last.ms).toFixed(2) : "-"} | ${lo.toFixed(2)} to ${hi.toFixed(2)}`,
    );
  }
}
