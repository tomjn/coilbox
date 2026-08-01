#!/usr/bin/env bun
/**
 * Builds the downloadable export of "Silence the Jericho" from its fixture.
 *
 * `src/scenario/fixtures/jericho.json` is a bare scenario document, which is
 * what the compile tests and the headless harness read. The app's Import wants a
 * coilbox container instead, so the fixture alone cannot be opened on another
 * machine. This wraps it in that container and writes the result to
 * `docs/public/scenarios/silence-the-jericho.json`, which VitePress serves
 * verbatim, so the docs page can link straight at a downloadable file.
 *
 * `src/scenario/example.test.ts` re-encodes the same export and fails when the
 * committed file does not match, so the file cannot rot as the format moves.
 *
 * Run with `bun scripts/build-jericho-export.mjs`.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseScenario } from "../src/scenario/model.ts";
import {
  encodeScenarioExport,
  scenarioMediaFiles,
} from "../src/scenario/transfer.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(ROOT, "src/scenario/fixtures/jericho.json");
const OUT = join(ROOT, "docs/public/scenarios/silence-the-jericho.json");

const scenario = parseScenario(JSON.parse(readFileSync(FIXTURE, "utf8")));
if (!scenario) {
  throw new Error(`${FIXTURE} does not parse as a scenario`);
}

/**
 * An export carries every portrait and voice clip its dialogue names, inlined as
 * a data URI. Jericho names none, so the media map is empty and nothing has to
 * be read off disk. If a clip is ever added, those bytes live in the app's own
 * media store rather than in this repo, so refuse rather than write an export
 * that quietly loses them.
 */
const files = scenarioMediaFiles(scenario);
if (files.length > 0) {
  throw new Error(
    `jericho.json now names dialogue media (${files.join(", ")}), which this script cannot read. Export it from the app instead.`,
  );
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${encodeScenarioExport({ scenario, media: {} })}\n`);

// `docs/public` is linted like the rest of the repo, and Biome prints a short
// JSON array on one line where `JSON.stringify` always breaks it. Format the
// file here, the way `stars:catalogue` does, so regenerating is one command and
// the result passes `biome ci`. The test compares parsed content for the same
// reason: whitespace here belongs to Biome, not to the encoder.
execFileSync("bunx", ["biome", "check", "--write", OUT], { stdio: "inherit" });
console.log(`wrote ${OUT}`);
