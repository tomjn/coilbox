import { describe, expect, it } from "vitest";
import type { UnitDatasetEntry } from "./bindings";
import { unitLabel } from "./unitChoices";

function unit(name: string, fullName?: string): UnitDatasetEntry {
  return { name, fullName };
}

describe("unitLabel", () => {
  it("prefers the readable name", () => {
    expect(unitLabel(unit("armpw", "Peewee"))).toBe("Peewee");
  });

  it("falls back to the internal name when there is none", () => {
    expect(unitLabel(unit("armpw"))).toBe("armpw");
    expect(unitLabel(unit("armpw", "  "))).toBe("armpw");
  });
});
