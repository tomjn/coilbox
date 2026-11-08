import { describe, expect, it } from "vitest";

import { bodyPlanById } from "./bodyPlans";
import { GENERATOR_JOBS } from "./generate";
import { generateCheckedUnit } from "./generateChecked";
import { type LegoProject, parseLegoProjectJson } from "./model";
import { groupProjects } from "./projectGroups";
import { validateProjectName } from "./projectNames";
import { rerollUnit } from "./reroll";
import {
  generateRoster,
  type RosterRequest,
  rosterRequestProblem,
  rosterUnitName,
  tierSize,
  unitVolume,
} from "./roster";
import { starterModules } from "./starterModules";
import { bundledPack } from "./testPack";

const pack = bundledPack();
const modules = starterModules(pack);

function unitOptions() {
  let n = 0;
  return () => {
    n += 1;
    return {
      id: `unit-${n}`,
      rootPieceId: `root-${n}`,
      now: "2026-11-08T00:00:00.000Z",
      pack,
      modules,
    };
  };
}

function plan(id: string) {
  const found = bodyPlanById(id);
  if (!found) throw new Error(`no plan ${id}`);
  return found;
}

const STYLE = {
  id: "style-1",
  name: "Blocky",
  shapes: [],
  proportions: "stocky" as const,
};

const REQUEST: RosterRequest = {
  id: "roster-1",
  name: "Raiders",
  seed: 5,
  plans: [plan("biped"), plan("wheeled")],
  jobs: ["scout", "assault", "artillery"],
  tiers: 3,
  style: STYLE,
};

function roster(request: RosterRequest = REQUEST): LegoProject[] {
  const result = generateRoster(request, unitOptions());
  if (result.status !== "ok") throw new Error(result.message);
  return result.units;
}

const LUA_NAME = /^[a-z_][a-z0-9_]*$/;

describe("tierSize", () => {
  it("makes three tiers small, medium and large exactly", () => {
    for (const job of GENERATOR_JOBS) {
      expect([1, 2, 3].map((tier) => tierSize(job.id, tier, 3))).toEqual([
        { size: "small", factor: job.size.small },
        { size: "medium", factor: job.size.medium },
        { size: "large", factor: job.size.large },
      ]);
    }
  });

  it("makes one tier medium", () => {
    expect(tierSize("scout", 1, 1)).toEqual({
      size: "medium",
      factor: GENERATOR_JOBS.find((j) => j.id === "scout")?.size.medium,
    });
  });

  it("steps up from small to large for any count of tiers", () => {
    for (const job of GENERATOR_JOBS) {
      for (let tiers = 2; tiers <= 9; tiers++) {
        const factors = Array.from(
          { length: tiers },
          (_, i) => tierSize(job.id, i + 1, tiers).factor,
        );
        expect(factors[0]).toBe(job.size.small);
        expect(factors[tiers - 1]).toBe(job.size.large);
        for (let i = 1; i < tiers; i++) {
          expect(factors[i], `${job.id} ${tiers}`).toBeGreaterThan(
            factors[i - 1],
          );
        }
      }
    }
  });
});

describe("rosterUnitName", () => {
  it("is a Lua name that sorts by job, then tier", () => {
    const names = ["scout", "assault"].flatMap((job) =>
      [1, 2, 3].map((tier) => rosterUnitName("Red Raiders!", job, tier)),
    );
    for (const name of names) expect(name).toMatch(LUA_NAME);
    expect(names[0]).toBe("red_raiders_scout_t1");
    expect([...names].sort()).toEqual([
      "red_raiders_assault_t1",
      "red_raiders_assault_t2",
      "red_raiders_assault_t3",
      "red_raiders_scout_t1",
      "red_raiders_scout_t2",
      "red_raiders_scout_t3",
    ]);
  });

  it("never starts with a digit", () => {
    expect(rosterUnitName("9th", "scout", 1)).toMatch(LUA_NAME);
  });
});

describe("rosterRequestProblem", () => {
  it("accepts a request whose names are free", () => {
    expect(rosterRequestProblem(REQUEST, [])).toBeNull();
  });

  it("refuses a name a saved unit already has", () => {
    const saved = [
      { name: "raiders scout 2", unitName: "x" },
    ] as unknown as LegoProject[];
    expect(rosterRequestProblem(REQUEST, saved)).toMatch(/already called/);
    const sameUnit = [
      { name: "Other", unitName: "raiders_assault_t1" },
    ] as unknown as LegoProject[];
    expect(rosterRequestProblem(REQUEST, sameUnit)).toMatch(/already called/);
    const upper = [
      { name: "Other", unitName: "RAIDERS_ASSAULT_T1" },
    ] as unknown as LegoProject[];
    expect(rosterRequestProblem(REQUEST, upper)).toMatch(/already called/);
  });

  it("refuses a request with nothing to make", () => {
    expect(rosterRequestProblem({ ...REQUEST, name: "  " }, [])).not.toBeNull();
    expect(rosterRequestProblem({ ...REQUEST, plans: [] }, [])).not.toBeNull();
    expect(rosterRequestProblem({ ...REQUEST, jobs: [] }, [])).not.toBeNull();
    expect(rosterRequestProblem({ ...REQUEST, tiers: 0 }, [])).not.toBeNull();
    expect(rosterRequestProblem({ ...REQUEST, tiers: 10 }, [])).not.toBeNull();
    expect(rosterRequestProblem({ ...REQUEST, tiers: 1.5 }, [])).not.toBeNull();
  });
});

describe("generateRoster", () => {
  const units = roster();

  it("makes one unit per job and tier, in the style", () => {
    expect(
      units.map((u) => [u.roster?.job, u.roster?.tier, u.roster?.tiers]),
    ).toEqual([
      ["scout", 1, 3],
      ["scout", 2, 3],
      ["scout", 3, 3],
      ["assault", 1, 3],
      ["assault", 2, 3],
      ["assault", 3, 3],
      ["artillery", 1, 3],
      ["artillery", 2, 3],
      ["artillery", 3, 3],
    ]);
    for (const unit of units) {
      expect(unit.roster?.id).toBe("roster-1");
      expect(unit.roster?.name).toBe("Raiders");
      expect(unit.generated?.style).toEqual(STYLE);
    }
  });

  it("gives the jobs the plans in turn, the same plan for every tier", () => {
    expect(units.map((u) => u.generated?.plan)).toEqual([
      ...Array(3).fill("biped"),
      ...Array(3).fill("wheeled"),
      ...Array(3).fill("biped"),
    ]);
  });

  it("makes each tier bigger than the one below it", () => {
    for (let i = 0; i < units.length; i += 3) {
      const [a, b, c] = units.slice(i, i + 3).map((u) => unitVolume(u, pack));
      expect(b, units[i].unitName).toBeGreaterThan(a);
      expect(c, units[i].unitName).toBeGreaterThan(b);
    }
  });

  it("steps up across five tiers too, recording the factor between sizes", () => {
    const five = roster({ ...REQUEST, jobs: ["scout", "builder"], tiers: 5 });
    expect(five).toHaveLength(10);
    for (let i = 0; i < five.length; i += 5) {
      const volumes = five.slice(i, i + 5).map((u) => unitVolume(u, pack));
      for (let n = 1; n < 5; n++) {
        expect(volumes[n]).toBeGreaterThan(volumes[n - 1]);
      }
    }
    // Tiers 1, 3 and 5 are on a size. 2 and 4 are between.
    expect(five.slice(0, 5).map((u) => u.generated?.factor)).toEqual([
      undefined,
      tierSize("scout", 2, 5).factor,
      undefined,
      tierSize("scout", 4, 5).factor,
      undefined,
    ]);
  });

  it("names every unit uniquely, as a Lua name, sorted by job then tier", () => {
    const names = units.map((u) => u.unitName);
    expect(new Set(names).size).toBe(units.length);
    for (const name of names) expect(name).toMatch(LUA_NAME);
    expect(names.slice(0, 3)).toEqual([
      "raiders_scout_t1",
      "raiders_scout_t2",
      "raiders_scout_t3",
    ]);
    expect(units[0].name).toBe("Raiders Scout 1");
    for (const unit of units) {
      expect(validateProjectName(units, unit.id, unit.name)).toBeNull();
    }
  });

  it("gives the same roster for the same request", () => {
    expect(JSON.stringify(roster())).toBe(JSON.stringify(units));
  });

  it("makes a tier on a size the unit the generate screen makes", () => {
    const one = generateCheckedUnit(
      {
        seed: units[1].generated?.seed ?? 0,
        plan: plan("biped"),
        job: "scout",
        size: "medium",
      },
      {
        ...unitOptions()(),
        id: units[1].id,
        rootPieceId: units[1].rootPieceId,
        style: STYLE,
      },
    );
    if (one.status !== "ok") throw new Error(one.message);
    expect(units[1].pieces).toEqual(one.unit.pieces);
  });

  it("says which unit it could not make bigger than the tier below", () => {
    // With no modules to hang on the skeleton a unit has no box to measure, so
    // no seed makes any tier bigger than the (empty) tier below.
    const { style: _none, ...plain } = REQUEST;
    const options = unitOptions();
    const result = generateRoster(
      { ...plain, seed: 1, plans: [plan("aircraft")], jobs: ["scout"] },
      () => ({ ...options(), modules: [] }),
    );
    expect(result).toEqual({
      status: "failed",
      message: expect.stringMatching(
        /^No seed from 1 to \d+ made Raiders Scout \d bigger than the tier below it\.$/,
      ),
    });
  });

  it("keeps a tier's factor when the unit is rerolled", () => {
    const five = roster({ ...REQUEST, jobs: ["assault"], tiers: 5 });
    const between = five[1];
    const result = rerollUnit(between, { pack, modules });
    if (result.status !== "ok") throw new Error(result.message);
    expect(result.unit.generated?.factor).toBe(between.generated?.factor);
    expect(result.unit.roster).toEqual(between.roster);
  });

  // As `generate.test.ts` does for one unit (#5113): the measure that steps
  // the tiers up must not bring in a call the engines disagree on.
  it("calls no maths function the engines disagree on", () => {
    const names = [
      "sin",
      "cos",
      "tan",
      "asin",
      "acos",
      "atan",
      "atan2",
      "log",
      "exp",
      "pow",
      "hypot",
      "cbrt",
    ] as const;
    const originals = new Map<string, unknown>();
    for (const name of names) {
      originals.set(name, Math[name]);
      Object.defineProperty(Math, name, {
        configurable: true,
        writable: true,
        value: () => {
          throw new Error(`generateRoster called Math.${name}`);
        },
      });
    }
    try {
      roster({ ...REQUEST, tiers: 4 });
    } finally {
      for (const name of names) {
        Object.defineProperty(Math, name, {
          configurable: true,
          writable: true,
          value: originals.get(name),
        });
      }
    }
  });

  it("is saved as one group that a reload keeps", () => {
    const reloaded = units.map((u) => {
      const parsed = parseLegoProjectJson(JSON.stringify(u));
      if (!parsed) throw new Error(`${u.name} did not reload`);
      return parsed;
    });
    const grouped = groupProjects([...reloaded].reverse());
    expect(grouped.own).toEqual([]);
    expect(grouped.rosters).toHaveLength(1);
    expect(grouped.rosters[0].label).toBe("Raiders");
    expect(grouped.rosters[0].projects.map((p) => p.unitName)).toEqual(
      [...units.map((u) => u.unitName)].sort(),
    );
  });
});
