import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { identify } from "../container/container";
import { parseScenario, type Scenario } from "./model";
import { encodeScenarioExport, readScenarioExport } from "./transfer";

/**
 * The committed export of "Silence the Jericho", the mission authored in the
 * Scenario Builder (issue #773).
 *
 * `fixtures/jericho.json` is a bare scenario document, which is what the compile
 * corpus and the headless harness read, and which the app's Import does not
 * accept. `docs/public/scenarios/silence-the-jericho.json` is the same mission
 * as a coilbox container, so it can be downloaded off the docs site and imported
 * on a machine that has never seen this repo. `scripts/build-jericho-export.mjs`
 * writes it from the fixture.
 *
 * These tests are what stops the committed file rotting when the scenario format
 * moves: the fixture is edited, the export is not regenerated, and nobody
 * notices until someone tries to import a mission that is a version behind.
 */

const REPO = join(__dirname, "..", "..");
const FIXTURE = join(__dirname, "fixtures", "jericho.json");
const EXPORT = join(REPO, "docs/public/scenarios/silence-the-jericho.json");

const REGENERATE = "regenerate it with `bun scripts/build-jericho-export.mjs`";

function fixtureScenario(): Scenario {
  const scenario = parseScenario(JSON.parse(readFileSync(FIXTURE, "utf8")));
  if (!scenario) throw new Error("jericho.json does not parse as a scenario");
  return scenario;
}

const text = readFileSync(EXPORT, "utf8");

describe("the committed Silence the Jericho export", () => {
  it("identifies as a scenario this build can read", () => {
    expect(identify(text)).toEqual({
      kind: "scenario",
      version: 1,
      compatibility: "ok",
      warnings: [],
    });
  });

  it("reads back as the scenario the fixture holds", () => {
    const read = readScenarioExport(text);
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    expect(read.payload.scenario).toEqual(fixtureScenario());
    // Jericho's dialogue names no portrait and no voice clip, which is why the
    // export can be built from the fixture alone.
    expect(read.payload.media).toEqual({});
  });

  /**
   * Compared as parsed content rather than as text, because the committed file
   * is Biome-formatted and Biome prints a short array on one line where
   * `JSON.stringify` breaks it. The content is the part that can go stale.
   */
  it(`matches what the encoder emits today, or ${REGENERATE}`, () => {
    const fresh = encodeScenarioExport({
      scenario: fixtureScenario(),
      media: {},
    });
    expect(JSON.parse(text)).toEqual(JSON.parse(fresh));
  });
});
