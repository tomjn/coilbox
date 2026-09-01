import { describe, expect, it, vi } from "vitest";
import { scenarioMissionValue } from "./compile";
import { newScenario, newScenarioId, starterScenario } from "./create";
import { isSetUp } from "./listing";
import { parseScenario, SCENARIO_SCHEMA_VERSION } from "./model";

// validate.ts reaches the plugin through bindings.ts, whose plugin-sdk import
// Vitest's node resolver cannot load from the published dist. Stubbed the way
// corpus.test.ts stubs it: only validateMission is used here, and it never
// calls scenarioReadMission.
vi.mock("./bindings", () => ({ scenarioReadMission: vi.fn() }));

import { validateMission } from "./validate";

/** The id charset the storage plugin's `valid_id` enforces in Rust. */
const VALID_ID = /^[A-Za-z0-9-]+$/;

describe("newScenario", () => {
  it("mints an id the storage plugin will accept", () => {
    expect(newScenarioId()).toMatch(VALID_ID);
    expect(newScenario("Ambush").id).toMatch(VALID_ID);
  });

  it("produces a document the parser accepts unchanged", () => {
    const made = newScenario("Ambush", "Hold the pass");
    const parsed = parseScenario(JSON.parse(JSON.stringify(made)));
    expect(parsed).toEqual(made);
    expect(parsed?.schemaVersion).toBe(SCENARIO_SCHEMA_VERSION);
    expect(parsed?.name).toBe("Ambush");
    expect(parsed?.description).toBe("Hold the pass");
  });

  it("starts with the skirmish default setup and empty registries", () => {
    const made = newScenario("Ambush");
    expect(made.setup.gameName).toBe("");
    expect(made.setup.mapName).toBe("");
    expect(made.setup.participants.length).toBeGreaterThan(0);
    expect(made.zones).toEqual([]);
    expect(made.triggers).toEqual([]);
    expect(made.objectives).toEqual([]);
  });

  it("gives each scenario its own setup, so editing one cannot reach another", () => {
    const a = newScenario("A");
    const b = newScenario("B");
    a.setup.participants[0].name = "Renamed";
    a.setup.modOptionValues.foo = "bar";
    expect(b.setup.participants[0].name).not.toBe("Renamed");
    expect(b.setup.modOptionValues).toEqual({});
    expect(a.id).not.toBe(b.id);
  });

  it("leaves the timestamps for saveScenario to stamp", () => {
    const made = newScenario("Ambush");
    expect(made.createdAt).toBe("");
    expect(made.updatedAt).toBe("");
  });
});

/**
 * The starter (issue #2183). A template that is an empty document under another
 * name helps nobody, and a template full of content the validator refuses helps
 * less, so both halves are pinned: it holds a working mission, and every
 * reference in it resolves.
 */
describe("starterScenario", () => {
  it("produces a document the parser accepts unchanged", () => {
    const made = starterScenario("First mission", "My first go");
    expect(parseScenario(JSON.parse(JSON.stringify(made)))).toEqual(made);
  });

  it("holds a mission rather than an empty document", () => {
    const made = starterScenario("First mission");
    expect(made.objectives).toHaveLength(1);
    expect(made.dialogue).toHaveLength(1);
    expect(made.triggers).toHaveLength(2);
    expect(newScenario("First mission").triggers).toHaveLength(0);
  });

  // The one check that makes this a template worth offering: the compiled
  // mission has no problems in it. Nothing names a unit type, a team or a
  // position, so there is nothing in it to be wrong about the game and map the
  // author has not picked yet.
  it("compiles to a mission the validator has nothing to say about", () => {
    expect(validateMission(scenarioMissionValue(starterScenario("X")))).toEqual(
      [],
    );
  });

  it("wins the mission by completing the objective it was given", () => {
    const made = starterScenario("X");
    const [objective] = made.objectives;
    const ending = made.triggers[made.triggers.length - 1];
    expect(ending.actions).toEqual([
      { type: "complete_objective", params: { objective: objective.id } },
      { type: "victory", params: {} },
    ]);
  });

  // A game and a map are the author's first decision and cannot be guessed, so
  // the starter is a draft exactly as a blank scenario is. Saying so here stops
  // anyone "finishing" the template by naming a game nobody has.
  it("still needs a game and a map before it can be launched", () => {
    expect(isSetUp(starterScenario("X"))).toBe(false);
  });
});
