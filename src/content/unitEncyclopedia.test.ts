import { describe, expect, it } from "vitest";
import type { UnitDatasetEntry } from "./bindings";
import { encyclopediaSections, unitLabel } from "./unitEncyclopedia";

function unit(
  name: string,
  extra: Partial<UnitDatasetEntry> = {},
): UnitDatasetEntry {
  return { name, ...extra };
}

const ARMADA = [{ id: "armcom", label: "Armada" }];

describe("encyclopediaSections", () => {
  it("puts a faction's units under that faction", () => {
    const units = [
      unit("armcom", { buildOptions: ["armsolar"] }),
      unit("armsolar", { fullName: "Solar Collector" }),
    ];
    const sections = encyclopediaSections(units, ARMADA, "");
    expect(sections.map((s) => s.label)).toEqual(["Armada"]);
    expect(sections[0].cells.map((c) => c.id)).toEqual(["armcom", "armsolar"]);
  });

  it("puts a unit no faction reaches in its own block", () => {
    const units = [unit("armcom"), unit("armghost")];
    const sections = encyclopediaSections(units, ARMADA, "");
    expect(sections.map((s) => s.label)).toEqual(["Armada", "Other units"]);
    expect(sections[1].cells.map((c) => c.id)).toEqual(["armghost"]);
  });

  it("folds a commander's upgrades into one cell", () => {
    const units = [
      unit("armcom", { morphTargets: [{ into: "armcom1" }] }),
      unit("armcom1", { morphTargets: [{ into: "armcom2" }] }),
      unit("armcom2"),
    ];
    const sections = encyclopediaSections(units, ARMADA, "");
    expect(sections[0].cells.map((c) => c.id)).toEqual(["armcom"]);
    expect(sections[0].cells[0].upgrades).toBe(2);
    expect(sections[0].cells[0].stages).toEqual(["armcom1", "armcom2"]);
  });

  it("gives a unit that morphs nowhere no upgrades", () => {
    const units = [
      unit("armcom", { buildOptions: ["armsolar"] }),
      unit("armsolar"),
    ];
    const sections = encyclopediaSections(units, ARMADA, "");
    const solar = sections[0].cells.find((c) => c.id === "armsolar");
    expect(solar?.upgrades).toBe(0);
    expect(solar?.stages).toEqual([]);
  });

  it("finds a unit by its def key", () => {
    const units = [
      unit("armcom", { buildOptions: ["armsolar"] }),
      unit("armsolar", { fullName: "Solar Collector" }),
    ];
    const sections = encyclopediaSections(units, ARMADA, "armsolar");
    expect(sections.flatMap((s) => s.cells).map((c) => c.id)).toEqual([
      "armsolar",
    ]);
  });

  it("finds a unit by the name a player sees", () => {
    const units = [
      unit("armcom", { buildOptions: ["armsolar"] }),
      unit("armsolar", { fullName: "Solar Collector" }),
    ];
    const sections = encyclopediaSections(units, ARMADA, "solar coll");
    expect(sections.flatMap((s) => s.cells).map((c) => c.id)).toEqual([
      "armsolar",
    ]);
  });

  it("finds a folded stage by its own def key", () => {
    // The one people notice: a def key pasted out of a mission file or a replay
    // belongs to a stage that has no cell of its own.
    const units = [
      unit("armcom", { morphTargets: [{ into: "armcom1" }] }),
      unit("armcom1"),
    ];
    const sections = encyclopediaSections(units, ARMADA, "armcom1");
    expect(sections.flatMap((s) => s.cells).map((c) => c.id)).toEqual([
      "armcom",
    ]);
  });

  it("keeps a faction's commander under its own heading when the start unit is a later stage", () => {
    // buildTechForest walks morph edges forward only, so a root left as
    // "armcom1" would never reach "armcom" backwards, and the commander
    // would fall out of Armada and into "Other units".
    const units = [
      unit("armcom", { morphTargets: [{ into: "armcom1" }] }),
      unit("armcom1"),
    ];
    const sections = encyclopediaSections(
      units,
      [{ id: "armcom1", label: "Armada" }],
      "",
    );
    expect(sections.map((s) => s.label)).toEqual(["Armada"]);
    expect(sections[0].cells.map((c) => c.id)).toEqual(["armcom"]);
  });

  it("drops a section left empty by the search", () => {
    const units = [unit("armcom"), unit("armghost")];
    const sections = encyclopediaSections(units, ARMADA, "armghost");
    expect(sections.map((s) => s.label)).toEqual(["Other units"]);
  });

  it("puts everything in one block when the game's sides could not be read", () => {
    // The spec names this: a game with no start units degrades to one long
    // block rather than to an empty page, which is what the picker does too.
    const units = [unit("armcom"), unit("armsolar")];
    const sections = encyclopediaSections(units, [], "");
    expect(sections.map((s) => s.label)).toEqual(["Other units"]);
    expect(sections[0].cells.map((c) => c.id)).toEqual(["armcom", "armsolar"]);
  });

  it("matches case insensitively and ignores surrounding space", () => {
    const units = [
      unit("armcom"),
      unit("armsolar", { fullName: "Solar Collector" }),
    ];
    const sections = encyclopediaSections(units, ARMADA, "  ARMSOLAR ");
    expect(sections.flatMap((s) => s.cells).map((c) => c.id)).toEqual([
      "armsolar",
    ]);
  });
});

describe("unitLabel", () => {
  it("prefers the name a player sees", () => {
    expect(
      unitLabel({ name: "armsolar", fullName: "Solar Collector" }, "armsolar"),
    ).toBe("Solar Collector");
  });

  it("falls back to the def key when the game names nothing", () => {
    expect(unitLabel({ name: "armsolar" }, "armsolar")).toBe("armsolar");
    expect(unitLabel(undefined, "armsolar")).toBe("armsolar");
  });
});
