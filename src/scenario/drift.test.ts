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
});
