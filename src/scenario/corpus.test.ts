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

  /**
   * Type-name coverage isn't enough: a fixture can name a type without
   * exercising the shape of data it carries. Issue #811 found the corpus had
   * no prefab at all, so no prefab building with a factory queue and no
   * queue with `repeat` either, and every group was `dormant`, so none of
   * them started on the map. Guard those shapes explicitly, the same way the
   * type-name check above is guarded, so a fixture that stops exercising one
   * fails here instead of silently leaving `mission.lua` untested.
   */
  it("covers every prefab and group-dormancy shape", () => {
    const allPrefabs = fixtures.flatMap(({ scenario }) => scenario.prefabs);
    const allBuildings = allPrefabs.flatMap((p) => p.buildings);
    const allGroups = fixtures.flatMap(({ scenario }) => scenario.groups);
    const allTriggers = fixtures.flatMap(({ scenario }) => scenario.triggers);

    const shapes: Record<string, boolean> = {
      "a repeating trigger": allTriggers.some((t) => t.repeat),
      "a trigger with a cooldown": allTriggers.some(
        (t) => (t.cooldown ?? 0) > 0,
      ),
      "a trigger disarmed at start": allTriggers.some((t) => !t.enabled),
      "a prefab": allPrefabs.length > 0,
      "a prefab building with a factory queue": allBuildings.some(
        (b) => (b.queue?.length ?? 0) > 0,
      ),
      "a factory queue that repeats": allBuildings.some(
        (b) => b.repeat === true,
      ),
      "a group that starts on the map (not dormant)": allGroups.some(
        (g) => g.dormant === false,
      ),
    };

    const missing = Object.entries(shapes)
      .filter(([, present]) => !present)
      .map(([label]) => label);

    expect(missing).toEqual([]);
  });

  /**
   * `ScenarioOrder` in model.ts allows five kinds: `move`, `patrol` and
   * `fight` (a waypoint list) or `guard` and `attack` (a target). Before this
   * fixture only ever used `guard` and `attack`, which is also the gap issue
   * #811 named. An order appears either as a group's opening orders or as the
   * payload of a `give_orders` action, so both are read.
   */
  const ORDER_KINDS = ["move", "patrol", "fight", "guard", "attack"] as const;

  function orderKindsOf(orders: unknown): string[] {
    if (!Array.isArray(orders)) return [];
    return orders
      .map((o) =>
        typeof o === "object" && o !== null
          ? (o as { kind?: unknown }).kind
          : undefined,
      )
      .filter((k): k is string => typeof k === "string");
  }

  it("covers every order kind ScenarioOrder allows", () => {
    const seenKinds = new Set<string>();
    for (const { scenario } of fixtures) {
      for (const group of scenario.groups) {
        for (const order of group.orders) seenKinds.add(order.kind);
      }
      for (const trigger of scenario.triggers) {
        for (const action of trigger.actions) {
          if (action.type !== "give_orders") continue;
          for (const kind of orderKindsOf(action.params.orders)) {
            seenKinds.add(kind);
          }
        }
      }
    }

    const missing = ORDER_KINDS.filter((k) => !seenKinds.has(k));

    expect(missing).toEqual([]);
  });
});
