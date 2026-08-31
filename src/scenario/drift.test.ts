import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileScenario } from "./compile";
import { missionDrifted } from "./drift";
import { parseScenario, type Scenario } from "./model";

/** A valid scenario carrying only the fields a test cares about. */
function build(overrides: Record<string, unknown> = {}): Scenario {
  const scenario = parseScenario({
    id: "s1",
    name: "Scenario",
    setup: {},
    ...overrides,
  });
  if (!scenario) throw new Error("fixture is not a valid scenario");
  return scenario;
}

describe("drift", () => {
  it("says a mission compiled from this document has not drifted", () => {
    const scenario = build();

    expect(missionDrifted(scenario, compileScenario(scenario))).toBe(false);
  });

  it("says a changed document has drifted from what ships", () => {
    const scenario = build();
    const shipped = compileScenario(scenario);

    expect(missionDrifted({ ...scenario, name: "Renamed" }, shipped)).toBe(
      true,
    );
  });

  it("says a mission nothing compiled has drifted", () => {
    expect(missionDrifted(build(), "return { schemaVersion = 1 }")).toBe(true);
  });

  /**
   * The trip a mission actually makes: the document is written into the game as
   * JSON and read back out of it before anything compares the two.
   *
   * If `parseScenario` drops or reorders anything the compiler emits, every one
   * of a game's missions reads as drifted on every launch, and a loose game is
   * rewritten each time it is played. That would be silent, because a drift
   * that corrects itself looks exactly like a game that was already right.
   * Every committed fixture goes through it, since a field only one mission
   * uses is where a lossy parse would hide.
   */
  describe.each([
    "ambush",
    "garrison",
    "jericho",
    "siege",
    "splinter",
  ])("%s.json, written into a game and read back", (name) => {
    it("compiles to the same mission it shipped", () => {
      const path = join(__dirname, "fixtures", `${name}.json`);
      const authored = parseScenario(JSON.parse(readFileSync(path, "utf8")));
      if (!authored) throw new Error(`${name}.json is not a valid scenario`);
      const shipped = compileScenario(authored);

      const readBack = parseScenario(JSON.parse(JSON.stringify(authored)));
      if (!readBack) throw new Error(`${name}.json did not survive the trip`);

      expect(missionDrifted(readBack, shipped)).toBe(false);
    });
  });
});
