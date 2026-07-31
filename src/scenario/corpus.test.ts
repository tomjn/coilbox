import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { compileScenario, scenarioMissionValue } from "./compile";
import { parseScenario, type Scenario } from "./model";
import { ACTION_TYPES, CONDITION_TYPES } from "./triggerTypes";

// validate.ts reaches the plugin through bindings.ts, whose plugin-sdk import
// Vitest's node resolver cannot load from the published dist. Stubbed the way
// validate.test.ts and storage.test.ts stub theirs. This suite only uses
// validateMission, which never calls scenarioReadMission.
vi.mock("./bindings", () => ({
  scenarioReadMission: vi.fn(),
}));

import { validateMission } from "./validate";

/**
 * The fixture corpus (issue #740): hand-written scenario documents exercising
 * every condition and action type in `triggerTypes.ts`, so the compile tests
 * here and the headless runtime harness later (issue #749) share one set of
 * examples.
 *
 * Each `fixtures/<id>.json` is a bare scenario document, the same shape
 * `parseScenario` reads out of `scenarios/<id>.json` in app data. A checked-in
 * `fixtures/missions/<id>/mission.lua` is that fixture's real
 * `compileScenario` output, kept in sync by the byte-identical check below. A
 * Lua-side test can `VFS.Include` or `dofile` those `.lua` files directly by
 * rooting at `fixtures/`, the same layout `missionPath` expects and the same
 * pattern the Rust fixture at
 * `crates/coilbox-springlua/tests/fixtures/mission/missions/demo/mission.lua`
 * uses, without needing a JSON decoder or a TypeScript toolchain.
 */

const FIXTURES_DIR = join(__dirname, "fixtures");

function loadFixture(file: string): Scenario {
  const raw = JSON.parse(readFileSync(join(FIXTURES_DIR, file), "utf8"));
  const scenario = parseScenario(raw);
  if (!scenario)
    throw new Error(`fixture ${file} does not parse as a scenario`);
  return scenario;
}

const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json"));
const fixtures = files.map((file) => ({ file, scenario: loadFixture(file) }));

describe("scenario fixture corpus", () => {
  it("has fixtures to check", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const { file, scenario } of fixtures) {
    it(`${file} compiles and validates cleanly`, () => {
      const emitted = compileScenario(scenario);
      expect(emitted.startsWith("-- Compiled by coilbox")).toBe(true);

      const issues = validateMission(scenarioMissionValue(scenario));
      expect(issues).toEqual([]);
    });

    it(`${file} matches its checked-in compiled Lua`, () => {
      const emitted = compileScenario(scenario);
      const golden = readFileSync(
        join(FIXTURES_DIR, "missions", scenario.id, "mission.lua"),
        "utf8",
      );
      expect(emitted).toBe(golden);
    });
  }

  /**
   * The guard test the issue is actually for: a condition or action type added
   * to `triggerTypes.ts` with no fixture using it fails here, rather than the
   * corpus silently rotting out of step with the capability table.
   */
  it("covers every condition and action type in triggerTypes.ts", () => {
    const seen = new Set<string>();
    for (const { scenario } of fixtures) {
      for (const trigger of scenario.triggers) {
        for (const condition of trigger.conditions.conditions) {
          seen.add(`condition:${condition.type}`);
        }
        for (const action of trigger.actions) {
          seen.add(`action:${action.type}`);
        }
      }
    }

    const wanted = [
      ...Object.keys(CONDITION_TYPES).map((t) => `condition:${t}`),
      ...Object.keys(ACTION_TYPES).map((t) => `action:${t}`),
    ];
    const missing = wanted.filter((t) => !seen.has(t));

    expect(missing).toEqual([]);
  });
});
