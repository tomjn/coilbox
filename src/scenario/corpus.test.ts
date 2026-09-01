import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { compileScenario, scenarioMissionValue } from "./compile";
import { requiredRuntimeVersion } from "./gating";
import {
  amountVar,
  baseBuildings,
  type DifficultyRange,
  parseScenario,
  type Scenario,
} from "./model";
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

    /**
     * A fixture's `runtimeVersion` is written by hand, and the runtime refuses a
     * mission that asks for more than it has. One that asks for less is worse:
     * it runs on a runtime that ignores half of it.
     */
    it(`${file} asks for the runtime it actually needs`, () => {
      expect(scenario.runtimeVersion).toBe(requiredRuntimeVersion(scenario));
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
   * no base at all, so no base building with a factory queue and no
   * queue with `repeat` either, and every group was `dormant`, so none of
   * them started on the map. Guard those shapes explicitly, the same way the
   * type-name check above is guarded, so a fixture that stops exercising one
   * fails here instead of silently leaving `mission.lua` untested.
   */
  it("covers every base and group-dormancy shape", () => {
    const allBases = fixtures.flatMap(({ scenario }) => scenario.bases);
    const allBuildings = fixtures.flatMap(({ scenario }) =>
      scenario.bases.flatMap((base) =>
        baseBuildings(scenario.blueprints, base),
      ),
    );
    const allGroups = fixtures.flatMap(({ scenario }) => scenario.groups);
    const allTriggers = fixtures.flatMap(({ scenario }) => scenario.triggers);
    const rangedEnds = fixtures.flatMap(({ scenario }) =>
      [
        ...scenario.actors,
        ...scenario.groups,
        ...scenario.bases,
        ...scenario.triggers,
      ]
        .map((item) => item.difficulty)
        .filter((range): range is DifficultyRange => range !== undefined),
    );

    const shapes: Record<string, boolean> = {
      "a repeating trigger": allTriggers.some((t) => t.repeat),
      "a trigger with a cooldown": allTriggers.some(
        (t) => (t.cooldown ?? 0) > 0,
      ),
      "a trigger disarmed at start": allTriggers.some((t) => !t.enabled),
      "a base": allBases.length > 0,
      "a base building with a factory queue": allBuildings.some(
        (b) => (b.queue?.length ?? 0) > 0,
      ),
      "a factory queue that repeats": allBuildings.some(
        (b) => b.repeat === true,
      ),
      // Issue #878. Without one the runtime records nothing about any base
      // building and the headless probe is back to finding one by unit def.
      "a base building a trigger names": fixtures.some(({ scenario }) => {
        const named = new Set(
          scenario.bases.flatMap((base) => base.buildings.map((b) => b.id)),
        );
        return scenario.triggers.some((t) =>
          t.conditions.conditions.some((c) =>
            Object.values(c.params).some(
              (v) => typeof v === "string" && named.has(v),
            ),
          ),
        );
      }),
      // Issue #808. An amount that names a var compiles to a table where a
      // number would otherwise sit, so without one nothing checks that the
      // emitter, the validator and the runtime agree on that shape.
      "a trigger reading a number out of a var": allTriggers.some((t) =>
        [...t.conditions.conditions, ...t.actions].some((step) =>
          Object.values(step.params).some((value) => amountVar(value) !== null),
        ),
      ),
      // Issue #827. Both sides of the choice, because a corpus that only ever
      // named a team would stop covering the "everyone" path every scenario
      // written before runtime 3 takes.
      "a camera move or marker aimed at one team": allTriggers.some((t) =>
        t.actions.some(
          (a) =>
            (a.type === "camera_pan" || a.type === "map_marker") &&
            a.params.team !== undefined,
        ),
      ),
      "a camera move or marker aimed at everyone": allTriggers.some((t) =>
        t.actions.some(
          (a) =>
            (a.type === "camera_pan" || a.type === "map_marker") &&
            a.params.team === undefined,
        ),
      ),
      // Issue #802. Both sides again: the presence hold is what every scenario
      // written before runtime 3 asks for, and the uncontested one is the new
      // question.
      "a hold that has to be uncontested": allTriggers.some((t) =>
        t.conditions.conditions.some(
          (c) => c.type === "zone_held_for" && c.params.uncontested === true,
        ),
      ),
      "a hold that only asks for presence": allTriggers.some((t) =>
        t.conditions.conditions.some(
          (c) =>
            c.type === "zone_held_for" && c.params.uncontested === undefined,
        ),
      ),
      "a group that starts on the map (not dormant)": allGroups.some(
        (g) => g.dormant === false,
      ),
      // Issue #2164. Each registry a range can sit on, because a range is read
      // in a different place for each: actors and bases in the start module,
      // groups in the group module, triggers in the trigger engine. A corpus
      // covering only one of them would leave three of those unexercised.
      "an actor that only exists at some difficulties": fixtures.some((f) =>
        f.scenario.actors.some((a) => a.difficulty !== undefined),
      ),
      "a group that only exists at some difficulties": allGroups.some(
        (g) => g.difficulty !== undefined,
      ),
      "a base that only exists at some difficulties": allBases.some(
        (b) => b.difficulty !== undefined,
      ),
      "a trigger that only runs at some difficulties": allTriggers.some(
        (t) => t.difficulty !== undefined,
      ),
      // Both ends, and both together. `atMost` is the easier version of a
      // mission rather than the harder one, which is the half an author
      // writing "make it fair on easy" reaches for and the half a corpus that
      // only ever gated things upward would never emit.
      "a range bounded at the bottom": rangedEnds.some((r) => r.atLeast),
      "a range bounded at the top": rangedEnds.some((r) => r.atMost),
      "a range bounded at both ends": rangedEnds.some(
        (r) => r.atLeast && r.atMost,
      ),
    };

    const missing = Object.entries(shapes)
      .filter(([, present]) => !present)
      .map(([label]) => label);

    expect(missing).toEqual([]);
  });

  /**
   * Issue #868. Spring measures a map from its north-west corner, so a negative
   * coordinate is off the map, and the engine answers one by clamping the unit
   * onto the edge rather than refusing it. Three fixtures were authored around a
   * centre origin and the headless harness passed anyway, with the siege base
   * arriving as a heap on (0, 0).
   *
   * Zero is barred as well as negative. It is the map edge, and it is where a
   * clamp puts things, so a fixture standing on it cannot show it was not
   * clamped.
   */
  type Point = { path: string; x: number; z: number };

  function isPoint(value: unknown): value is { x: number; z: number } {
    return (
      typeof value === "object" &&
      value !== null &&
      typeof (value as { x?: unknown }).x === "number" &&
      typeof (value as { z?: unknown }).z === "number"
    );
  }

  /** Every `{ x, z }` anywhere in a scenario, with the path it sits at. */
  function pointsIn(value: unknown, path = ""): Point[] {
    if (isPoint(value)) return [{ path, x: value.x, z: value.z }];
    if (Array.isArray(value))
      return value.flatMap((entry, index) =>
        pointsIn(entry, `${path}[${index}]`),
      );
    if (typeof value === "object" && value !== null)
      return Object.entries(value).flatMap(([key, entry]) =>
        pointsIn(entry, path ? `${path}.${key}` : key),
      );
    return [];
  }

  it("puts every fixture coordinate on the map", () => {
    const offMap: string[] = [];
    for (const { file, scenario } of fixtures) {
      for (const point of pointsIn(scenario)) {
        // A blueprint building's offset is measured from the base's origin and
        // is free to point north or west of it. The position it resolves to is
        // checked below instead.
        if (point.path.endsWith(".offset")) continue;
        if (point.x <= 0 || point.z <= 0)
          offMap.push(`${file} ${point.path} at ${point.x},${point.z}`);
      }
      for (const base of scenario.bases) {
        for (const building of baseBuildings(scenario.blueprints, base)) {
          const x = base.origin.x + building.offset.x;
          const z = base.origin.z + building.offset.z;
          if (x <= 0 || z <= 0)
            offMap.push(
              `${file} base ${base.id}'s ${building.def} at ${x},${z}`,
            );
        }
      }
    }

    expect(offMap).toEqual([]);
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
