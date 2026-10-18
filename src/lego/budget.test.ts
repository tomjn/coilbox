import { describe, expect, it } from "vitest";
import {
  budgetProblem,
  budgetStanding,
  overBudgetLoadouts,
  parseBudget,
} from "./budget";
import { loadoutFamily } from "./loadoutFamily";
import { duplicateLoadout } from "./loadouts";
import { newProject, parseLegoProjectJson } from "./model";
import type { UnitStats } from "./unitStats";

function chassis() {
  return {
    ...newProject({
      id: "p",
      rootPieceId: "root",
      name: "Tank",
      packId: "lego",
      packVersion: "1",
      now: "2026-10-18T00:00:00Z",
    }),
    unitName: "tank",
  };
}

let next = 0;
const newId = () => `id${++next}`;

function stats(cost: number | null): UnitStats {
  return { cost, health: 500, speed: 50, range: 300, dps: 20 };
}

describe("budget in a saved project", () => {
  it("is saved with the chassis and loads back", () => {
    const saved = JSON.stringify({ ...chassis(), budget: 250 });
    expect(parseLegoProjectJson(saved)?.budget).toBe(250);
  });

  it("is dropped when it is not a positive number", () => {
    for (const bad of [0, -5, "300", null, Number.NaN]) {
      const saved = JSON.stringify({ ...chassis(), budget: bad });
      expect(parseLegoProjectJson(saved)).not.toBeNull();
      expect(parseLegoProjectJson(saved)).not.toHaveProperty("budget");
    }
  });

  it("leaves a project with no budget exactly as it was", () => {
    const loaded = parseLegoProjectJson(JSON.stringify(chassis()));
    expect(loaded).not.toHaveProperty("budget");
    expect(parseBudget(undefined)).toBeNull();
  });

  it("is not one of the fields each loadout has its own of", async () => {
    const { LOADOUT_FIELDS } = await import("./model");
    expect(LOADOUT_FIELDS as readonly string[]).not.toContain("budget");
  });
});

describe("budgetStanding", () => {
  it("says what is left", () => {
    expect(budgetStanding(250, 180)).toEqual({
      budget: 250,
      used: 180,
      left: 70,
      over: false,
    });
  });

  it("says how far over, and is not over when it matches exactly", () => {
    expect(budgetStanding(250, 300)).toMatchObject({ left: -50, over: true });
    expect(budgetStanding(250, 250)).toMatchObject({ left: 0, over: false });
  });

  it("is null with no budget or no cost", () => {
    expect(budgetStanding(undefined, 100)).toBeNull();
    expect(budgetStanding(250, null)).toBeNull();
  });
});

describe("budgetProblem", () => {
  it("is one short warning that says export is not blocked", () => {
    const found = budgetProblem(budgetStanding(250, 300));
    expect(found).toMatchObject({ source: "budget", severity: "warning" });
    expect(found?.message).toBe("Over budget by 50. Export is not blocked.");
  });

  it("is nothing within the budget", () => {
    expect(budgetProblem(budgetStanding(250, 250))).toBeNull();
    expect(budgetProblem(null)).toBeNull();
  });
});

describe("overBudgetLoadouts", () => {
  it("lists the loadouts whose cost is over the budget", () => {
    next = 0;
    const two = {
      ...duplicateLoadout(chassis(), { newId }),
      budget: 200,
    };
    const [a, b] = two.loadouts?.map((l) => l.id) as string[];
    const cost = { [a]: 150, [b]: 260 };
    const over = overBudgetLoadouts(
      two,
      (unit) => cost[unit.activeLoadout ?? ""],
    );
    expect([...over]).toEqual([b]);
  });

  it("is empty with no budget", () => {
    next = 0;
    const two = duplicateLoadout(chassis(), { newId });
    expect(overBudgetLoadouts(two, () => 999).size).toBe(0);
  });
});

describe("the family view budget row", () => {
  function family(budget: number | undefined, costs: number[]) {
    next = 0;
    const two = { ...duplicateLoadout(chassis(), { newId }), budget };
    const ids = two.loadouts?.map((l) => l.id) as string[];
    return loadoutFamily(two, (unit) => {
      const at = ids.indexOf(unit.activeLoadout ?? "");
      return stats(costs[at]);
    });
  }

  it("shows what is left in each loadout and marks the ones over", () => {
    const row = family(200, [150, 260])?.rows.find((r) => r.id === "budget");
    expect(row?.cells).toEqual(["50 left", "60 over"]);
    expect(row?.differs).toBe(true);
    expect(row?.over).toEqual([1]);
  });

  it("is absent with no budget", () => {
    const rows = family(undefined, [150, 260])?.rows ?? [];
    expect(rows.some((r) => r.id === "budget")).toBe(false);
  });
});
