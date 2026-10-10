import { describe, expect, it } from "vitest";
import type { UnitDatasetEntry } from "./bindings";
import fixture from "./fixtures/splinter-faction-unit-dataset.json";
import {
  type ClassifiableUnit,
  classifyUnit,
  UNIT_CATEGORIES,
  type UnitCategory,
} from "./unitCategory";

const gun = { damage: 10, range: 300 };

function unit(
  stats: Record<string, unknown>,
  extra: Partial<ClassifiableUnit> = {},
): ClassifiableUnit {
  return { stats, ...extra };
}

describe("classifyUnit rules", () => {
  it("calls a static unit with a build menu a factory", () => {
    expect(classifyUnit(unit({ builder: true }, { buildOptions: ["a"] }))).toBe(
      "factory",
    );
  });

  it("calls a moving unit with a build menu a builder, armed or not", () => {
    expect(
      classifyUnit(
        unit(
          { builder: true, weapons: [gun], energyMake: 5 },
          { mobile: true, buildOptions: ["a"] },
        ),
      ),
    ).toBe("builder");
  });

  it("calls an unarmed builder with no menu a builder", () => {
    expect(classifyUnit(unit({ builder: true }))).toBe("builder");
  });

  it("does not trust a build menu on a def that never said builder", () => {
    expect(classifyUnit(unit({}, { buildOptions: ["a"] }))).toBe(
      "unclassified",
    );
  });

  it("judges an armed builder with no menu by its weapon", () => {
    expect(
      classifyUnit(unit({ builder: true, weapons: [gun] }, { mobile: true })),
    ).toBe("offence");
  });

  it("calls a unit that carries others a transport, ahead of its weapon", () => {
    expect(
      classifyUnit(
        unit({ transportCapacity: 4, weapons: [gun] }, { mobile: true }),
      ),
    ).toBe("transport");
  });

  it("calls an armed moving unit offence and an armed fixed one defence", () => {
    expect(classifyUnit(unit({ weapons: [gun] }, { mobile: true }))).toBe(
      "offence",
    );
    expect(classifyUnit(unit({ weapons: [gun] }))).toBe("defence");
  });

  it("calls a gun that also makes energy a gun", () => {
    expect(classifyUnit(unit({ weapons: [gun], energyMake: 100 }))).toBe(
      "defence",
    );
  });

  it.each([
    ["energyMake", 20],
    ["metalMake", 1],
    ["makesMetal", 1],
    ["extractsMetal", 0.001],
    ["windGenerator", 30],
    ["tidalGenerator", 20],
    ["metalStorage", 500],
    ["energyStorage", 500],
    ["energyUpkeep", -20],
    ["metalUpkeep", -1],
  ])("reads %s of %s as economy", (key, value) => {
    expect(classifyUnit(unit({ [key]: value }))).toBe("economy");
  });

  it("reads a positive upkeep as a cost, not income", () => {
    expect(classifyUnit(unit({ energyUpkeep: 50 }))).toBe("unclassified");
  });

  it("reads a declared zero the same as an undeclared key", () => {
    expect(
      classifyUnit(unit({ energyMake: 0, metalMake: 0, energyUpkeep: 0 })),
    ).toBe("unclassified");
  });

  it("calls economy ahead of a sensor", () => {
    expect(classifyUnit(unit({ energyStorage: 100, radarDistance: 900 }))).toBe(
      "economy",
    );
  });

  it.each([
    "radarDistance",
    "sonarDistance",
    "radarDistanceJam",
    "sonarDistanceJam",
    "seismicDistance",
  ])("reads %s as intelligence", (key) => {
    expect(classifyUnit(unit({ [key]: 1200 }))).toBe("intelligence");
  });

  it("leaves a unit with nothing to go on unclassified", () => {
    expect(classifyUnit(unit({ health: 100 }))).toBe("unclassified");
    expect(classifyUnit({})).toBe("unclassified");
  });

  it("ignores a stat of the wrong type", () => {
    expect(classifyUnit(unit({ energyMake: "20", weapons: "gun" }))).toBe(
      "unclassified",
    );
  });
});

/**
 * The measurement the rules were written against: every unit of a real game,
 * read by the unitsync worker (`fixtures/splinter-faction-unit-dataset.json`).
 */
describe("classifyUnit over a real game", () => {
  const units = (fixture as { units: UnitDatasetEntry[] }).units;
  const byName = (name: string): UnitCategory => {
    const found = units.find((u) => u.name === name);
    if (!found) throw new Error(`${name} is not in the fixture`);
    return classifyUnit(found);
  };

  it("counts every category", () => {
    const counts = Object.fromEntries(UNIT_CATEGORIES.map((c) => [c, 0]));
    for (const u of units) counts[classifyUnit(u)] += 1;
    expect(counts).toEqual({
      economy: 29,
      defence: 25,
      offence: 53,
      factory: 6,
      builder: 24,
      intelligence: 5,
      transport: 5,
      unclassified: 7,
    });
    expect(units).toHaveLength(154);
  });

  it("names the units a player of the game would", () => {
    expect(byName("fissionpowerplant")).toBe("economy");
    expect(byName("fedmetalextractor")).toBe("economy");
    expect(byName("f1landfac")).toBe("factory");
    expect(byName("fedcommander")).toBe("builder");
    expect(byName("fedcondor")).toBe("transport");
    expect(byName("sensortower")).toBe("intelligence");
  });

  it("leaves a unit the engine keys cannot describe unclassified", () => {
    // Its storage and supply are set outside the unitdef's engine keys.
    expect(byName("supplydepot")).toBe("unclassified");
  });
});
