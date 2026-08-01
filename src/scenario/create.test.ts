import { describe, expect, it } from "vitest";
import { newScenario, newScenarioId } from "./create";
import { parseScenario, SCENARIO_SCHEMA_VERSION } from "./model";

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
