import { describe, expect, it } from "vitest";
import { newScenario } from "../scenario/create";
import type { Difficulty, Scenario } from "../scenario/model";
import {
  conquestScenarioDifficulty,
  scenarioLevel,
  warpathScenarioDifficulty,
} from "./scenarioDifficulty";

const E: Difficulty = "easy";
const N: Difficulty = "normal";
const H: Difficulty = "hard";

describe("conquestScenarioDifficulty", () => {
  // Rows are threat levels 0 to 3, columns location difficulty 1 to 5. The PR
  // carries the same table.
  const table: Difficulty[][] = [
    [E, E, E, N, N],
    [E, E, N, N, H],
    [N, N, N, H, H],
    [N, N, H, H, H],
  ];

  it("follows the table for every threat level and location difficulty", () => {
    for (let threat = 0; threat <= 3; threat++) {
      for (let location = 1; location <= 5; location++) {
        expect(
          conquestScenarioDifficulty(threat, location),
          `threat ${threat}, location ${location}`,
        ).toBe(table[threat][location - 1]);
      }
    }
  });

  it("never gets easier as either input rises", () => {
    const rank = (d: Difficulty) => ["easy", "normal", "hard"].indexOf(d);
    for (let threat = 0; threat <= 3; threat++) {
      for (let location = 1; location <= 5; location++) {
        const here = rank(conquestScenarioDifficulty(threat, location));
        if (threat < 3) {
          expect(
            rank(conquestScenarioDifficulty(threat + 1, location)),
          ).toBeGreaterThanOrEqual(here);
        }
        if (location < 5) {
          expect(
            rank(conquestScenarioDifficulty(threat, location + 1)),
          ).toBeGreaterThanOrEqual(here);
        }
      }
    }
  });

  it("clamps inputs outside their ranges", () => {
    expect(conquestScenarioDifficulty(-4, 0)).toBe("easy");
    expect(conquestScenarioDifficulty(9, 99)).toBe("hard");
    // A saved conquest with no threat level reads it as 0.
    expect(conquestScenarioDifficulty(Number.NaN, 5)).toBe("normal");
  });
});

describe("warpathScenarioDifficulty", () => {
  // Rows are run difficulty 1 to 5 with no ascension, columns tech tier 1 to 5.
  const table: Difficulty[][] = [
    [E, E, E, N, N],
    [E, E, N, N, N],
    [E, N, N, N, H],
    [N, N, N, H, H],
    [N, N, H, H, H],
  ];

  it("follows the table for every run difficulty and tier", () => {
    for (let difficulty = 1; difficulty <= 5; difficulty++) {
      for (let tier = 1; tier <= 5; tier++) {
        expect(
          warpathScenarioDifficulty(difficulty, 0, tier),
          `difficulty ${difficulty}, tier ${tier}`,
        ).toBe(table[difficulty - 1][tier - 1]);
      }
    }
  });

  it("is harder late on an easy run than early on it", () => {
    expect(warpathScenarioDifficulty(1, 0, 1)).toBe("easy");
    expect(warpathScenarioDifficulty(1, 0, 5)).toBe("normal");
  });

  it("starts harder on a hard run than on an easy one", () => {
    expect(warpathScenarioDifficulty(1, 0, 1)).toBe("easy");
    expect(warpathScenarioDifficulty(5, 0, 1)).toBe("normal");
  });

  it("adds ascension to the run difficulty, as a skirmish encounter does", () => {
    expect(warpathScenarioDifficulty(2, 2, 3)).toBe(
      warpathScenarioDifficulty(4, 0, 3),
    );
    // Past the top of the slider is the top share, never beyond it.
    expect(warpathScenarioDifficulty(5, 5, 1)).toBe(
      warpathScenarioDifficulty(5, 0, 1),
    );
  });

  it("clamps a tier outside 1 to 5", () => {
    expect(warpathScenarioDifficulty(5, 0, 99)).toBe("hard");
    expect(warpathScenarioDifficulty(1, 0, 0)).toBe("easy");
  });
});

describe("scenarioLevel", () => {
  const withRange = (): Scenario => {
    const s = newScenario("Siege");
    s.actors = [
      {
        id: "a1",
        unitDef: "corllt",
        team: "p0",
        pos: { x: 1, z: 1 },
        difficulty: { atLeast: "hard" },
      } as Scenario["actors"][number],
    ];
    return s;
  };

  it("gives the level for a scenario that varies by difficulty", () => {
    expect(scenarioLevel(withRange(), () => "hard")).toBe("hard");
  });

  it("leaves a scenario that does not use difficulty unaffected", () => {
    let asked = false;
    const level = scenarioLevel(newScenario("Plain"), () => {
      asked = true;
      return "hard";
    });
    expect(level).toBeUndefined();
    expect(asked).toBe(false);
  });

  it("gives nothing when there is no scenario", () => {
    expect(scenarioLevel(undefined, () => "hard")).toBeUndefined();
  });
});
