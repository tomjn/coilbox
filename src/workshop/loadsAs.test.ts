import { describe, expect, it } from "vitest";
import { type SettledTypedValues, settledSummary } from "./loadsAs";

function settled(
  outcomes: SettledTypedValues["fields"][number]["outcome"][],
): SettledTypedValues {
  return {
    written: {},
    fields: outcomes.map((outcome) => ({
      field: { kind: "unit", unit: "armcom", path: "maxdamage" },
      typed: 0.5,
      loadsAsTyped: 0.045,
      outcome,
    })),
    loads: 3,
    elapsedMs: 900,
  };
}

describe("settledSummary", () => {
  it("says nothing when every typed value already loads as typed", () => {
    expect(settledSummary(settled(["asTyped", "asTyped"]))).toBeNull();
  });

  it("counts written values and values left as typed", () => {
    expect(settledSummary(settled(["written", "unproven", "unread"]))).toBe(
      "1 typed value is written so the game's own Lua turns it into the typed number, checked by loading the game. 2 are written as typed, and the game may load them as something else.",
    );
  });
});
