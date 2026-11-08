#!/usr/bin/env node
// Runs probe.html in headless Chrome through agent-browser and measures the
// steady frame time of the whole strategic map at three camera poses. Each run
// appends one line per map to <out>/<label>.jsonl, and summary.mjs reads those.
//
//   node scripts/map-frame-timing/run.mjs --label new --runs 1 --port 1479
//
// Options: --label (names the output), --runs (page loads per map),
// --port (the vite dev server's), --perf (performance mode), --towns (time
// the towns' share at all six views, see README.md), --maps (comma
// list from the table below), --out (default docs/reports/map-frame-timing),
// --max-load (do not start a run at or above this 1 minute load average,
// default 6) and --max-wait (seconds to wait for it to fall, default 240).
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { loadavg } from "node:os";

const MAPS = {
  temperate: "skin=territories&planet=temperate",
  desert: "skin=territories&planet=desert",
  ice: "skin=territories&planet=ice",
  cities: "skin=cities&nodes=30",
};

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) {
      const next = all[i + 1];
      acc.push([a.slice(2), next && !next.startsWith("--") ? next : "1"]);
    }
    return acc;
  }, []),
);
const label = args.label ?? "run";
const runs = Number(args.runs ?? 3);
const port = args.port ?? "1479";
const perf = args.perf === "1";
const towns = args.towns === "1";
const maxLoad = Number(args["max-load"] ?? 6);
const maxWaitMs = Number(args["max-wait"] ?? 240) * 1000;
for (const [option, value] of Object.entries({ runs, maxLoad, maxWaitMs })) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${option} must be a number of at least 0, got ${value}`);
  }
}
const maps = (args.maps ?? Object.keys(MAPS).join(",")).split(",");
const out = args.out ?? "docs/reports/map-frame-timing";
const session = `map-frame-timing-${label}`;
mkdirSync(out, { recursive: true });
const jsonl = `${out}/${label}${perf ? "-perf" : ""}${towns ? "-towns" : ""}.jsonl`;

const ab = (...a) =>
  execFileSync("agent-browser", a, {
    encoding: "utf8",
    env: { ...process.env, AGENT_BROWSER_SESSION: session },
    maxBuffer: 1 << 26,
  });

// The size of the app's window: 1285 by 1003 CSS pixels at a device pixel
// ratio of 2 is a 2570 by 2006 drawing buffer.
ab("set", "viewport", "1285", "1003", "2");

for (const name of maps) {
  if (!MAPS[name]) throw new Error(`unknown map ${name}`);
  for (let run = 1; run <= runs; run++) {
    // The 1 minute average lags the machine, so give it a bounded time to
    // fall before giving up.
    const waitedFrom = Date.now();
    while (loadavg()[0] >= maxLoad && Date.now() - waitedFrom < maxWaitMs) {
      ab("wait", "10000");
    }
    const loadBefore = loadavg()[0];
    if (loadBefore >= maxLoad) {
      console.error(
        `load ${loadBefore.toFixed(2)} is at or above ${maxLoad}, stopping before ${name} run ${run}`,
      );
      ab("close");
      process.exit(2);
    }
    const url = `http://localhost:${port}/scripts/map-frame-timing/probe.html?${MAPS[name]}${perf ? "&perf=1" : ""}${towns ? "&towns=1" : ""}&_=${Date.now()}`;
    ab("open", url);
    ab("wait", "--fn", "window.probeGo !== undefined");
    ab("eval", "window.probeGo(); 1");
    ab("wait", "--fn", "window.__result", "--timeout", "180000");
    const result = JSON.parse(JSON.parse(ab("eval", "window.__result")));
    result.map = name;
    result.run = run;
    result.loadBefore = loadBefore;
    result.loadAfter = loadavg()[0];
    appendFileSync(jsonl, `${JSON.stringify(result)}\n`);
    console.error(
      `${name} run ${run}: ${Object.entries(result.frames)
        .map(([p, f]) => `${p} ${f.best}${towns ? ` (towns ${f.townMs})` : ""}`)
        .join(", ")} ms, load ${loadBefore.toFixed(2)} to ${result.loadAfter.toFixed(2)}`,
    );
  }
}
ab("close");
