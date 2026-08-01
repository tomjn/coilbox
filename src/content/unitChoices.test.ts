import { describe, expect, it } from "vitest";
import type { UnitDatasetEntry } from "./bindings";
import { unitChoices, unitLabel } from "./unitChoices";

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

describe("unitChoices", () => {
  it("orders by the name an author reads, not the one the game stores", () => {
    const choices = unitChoices([
      unit("armpw", "Peewee"),
      unit("armsolar", "Solar Collector"),
      unit("armflash", "Flash"),
    ]);
    expect(choices.map((c) => c.label)).toEqual([
      "Flash",
      "Peewee",
      "Solar Collector",
    ]);
    expect(choices.map((c) => c.value)).toEqual([
      "armflash",
      "armpw",
      "armsolar",
    ]);
  });

  it("carries the internal name as the description", () => {
    expect(unitChoices([unit("armpw", "Peewee")])[0].description).toBe("armpw");
  });

  it("leaves the description off when it would repeat the label", () => {
    expect(unitChoices([unit("armpw")])[0].description).toBeUndefined();
  });

  it("settles two units sharing a readable name by internal name", () => {
    const choices = unitChoices([
      unit("corpw", "Peewee"),
      unit("armpw", "Peewee"),
    ]);
    expect(choices.map((c) => c.value)).toEqual(["armpw", "corpw"]);
  });
});
