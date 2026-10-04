import { describe, expect, it } from "vitest";
import type { UnitDatasetEntry } from "../content/bindings";
import { buildBuildGraph, buildEdgeMap } from "../content/buildTree";
import type { RogueliteRun } from "./model";
import {
  limitReadiness,
  noLimitMessage,
  noLimitReason,
  unitLimitFor,
} from "./unitLimit";

// Unit names are the real ones from Metal Factions v2.58, SplinterFaction
// 0.1.86 and Zero-K v1.14.8.0, trimmed to a few units each. `claw_commander`
// morphs into `claw_u1commander`, which builds exactly what it builds, and
// `claw_light_drone` is something no unit builds or morphs into.
const unit = (
  name: string,
  buildOptions: string[] = [],
  morphInto: string[] = [],
): UnitDatasetEntry => ({
  name,
  buildOptions,
  morphTargets: morphInto.map((into) => ({
    into,
    cmdname: "Morph",
    metal: 0,
    energy: 0,
    time: 1,
  })),
});

const CLAW_BUILDS = ["claw_light_plant", "claw_totem", "claw_tombstone"];
const CLAW: UnitDatasetEntry[] = [
  unit("claw_commander", CLAW_BUILDS, ["claw_u1commander"]),
  unit("claw_u1commander", CLAW_BUILDS),
  unit("claw_light_plant", ["claw_knife"]),
  unit("claw_knife"),
  unit("claw_totem", [], ["claw_totem_laser"]),
  unit("claw_totem_laser"),
  unit("claw_tombstone", [], ["claw_avenger"]),
  unit("claw_avenger"),
  unit("claw_light_drone"),
];

function run(unlocked: string[], startUnit: string | undefined): RogueliteRun {
  return {
    schemaVersion: 1,
    type: "roguelite-run",
    name: "Test Reach",
    settings: {
      seed: 1,
      length: "standard",
      difficulty: 2,
      ascension: 0,
      game: { shortname: "mf" },
      factionId: "p",
      skin: "galaxy",
    },
    startUnit,
    nodes: [{ id: "start", type: "start", col: 0, row: 0 }],
    edges: [],
    progress: {
      currentNodeId: "start",
      visited: ["start"],
      hull: 100,
      maxHull: 100,
      salvage: 0,
      unlockedUnits: unlocked,
      perks: [],
      status: "active",
    },
    history: [],
    createdAt: "t",
    updatedAt: "t",
  };
}

describe("noLimitReason", () => {
  const edges = buildEdgeMap(CLAW);

  it("says a side with no start unit has no limit", () => {
    expect(noLimitReason(undefined, edges)).toBe("no-start-unit");
  });

  it("says Zero-K's placeholder start unit is not in the unit data", () => {
    const zk = buildEdgeMap([unit("armcom", ["armmex"]), unit("armmex")]);
    expect(noLimitReason("update_your_damn_engine", zk)).toBe(
      "start-unit-not-in-data",
    );
  });

  it("says Metal Factions' Random side is not in the unit data", () => {
    expect(noLimitReason("random", edges)).toBe("start-unit-not-in-data");
  });

  it("says a start unit that builds nothing reaches nothing", () => {
    expect(noLimitReason("claw_light_drone", edges)).toBe("reaches-nothing");
  });

  it("reads the start unit without regard to case", () => {
    expect(noLimitReason("CLAW_COMMANDER", edges)).toBeNull();
  });

  it("finds no problem with a start unit that reaches a roster", () => {
    expect(noLimitReason("claw_commander", edges)).toBeNull();
  });
});

describe("unitLimitFor", () => {
  const edges = buildEdgeMap(CLAW);

  it("limits a run to what it has unlocked, from a start unit that reaches a roster", () => {
    const limit = unitLimitFor(
      run(["claw_commander", "claw_light_plant"], "claw_commander"),
      edges,
    );
    expect(limit.kind).toBe("limited");
    if (limit.kind !== "limited") return;
    expect(limit.disabled.sort()).toEqual([
      "claw_knife",
      "claw_tombstone",
      "claw_totem",
    ]);
  });

  it("gives no limit for a placeholder start unit, and says why", () => {
    expect(unitLimitFor(run([], "update_your_damn_engine"), edges)).toEqual({
      kind: "none",
      reason: "start-unit-not-in-data",
    });
  });

  it("gives no limit for a start unit that reaches nothing, and says why", () => {
    expect(unitLimitFor(run([], "claw_light_drone"), edges)).toEqual({
      kind: "none",
      reason: "reaches-nothing",
    });
  });

  it("does not disable a form the start unit morphs into, since no reward offers it", () => {
    // `claw_u1commander` builds what `claw_commander` does but nothing builds
    // it, so the run can never unlock it. Disabling it would lock the player
    // out of their commander's upgrade for good.
    const limit = unitLimitFor(
      run(["claw_commander"], "claw_commander"),
      edges,
    );
    if (limit.kind !== "limited") throw new Error("expected a limit");
    expect(limit.disabled).not.toContain("claw_u1commander");
    expect(limit.disabled).not.toContain("claw_totem_laser");
    expect(limit.disabled).not.toContain("claw_avenger");
  });

  it("leaves an unlocked unit that only a morph reaches alone", () => {
    const limit = unitLimitFor(
      run(["claw_commander", "claw_u1commander"], "claw_commander"),
      edges,
    );
    if (limit.kind !== "limited") throw new Error("expected a limit");
    expect(limit.disabled).not.toContain("claw_u1commander");
  });

  it("never disables a unit that no route reaches", () => {
    const limit = unitLimitFor(
      run(["claw_commander"], "claw_commander"),
      edges,
    );
    if (limit.kind !== "limited") throw new Error("expected a limit");
    expect(limit.disabled).not.toContain("claw_light_drone");
  });

  it("covers every unit the unlock rewards can offer", () => {
    // Rewards are drawn from the build graph, so a reward the run offers is
    // always one the limit understands.
    const offered = buildBuildGraph("claw_commander", edges).order;
    const limit = unitLimitFor(run([], "claw_commander"), edges);
    if (limit.kind !== "limited") throw new Error("expected a limit");
    expect(limit.disabled.sort()).toEqual([...offered].sort());
  });
});

describe("limitReadiness", () => {
  const withStart = run(["claw_commander"], "claw_commander");

  it("waits while the unit data is loading", () => {
    expect(limitReadiness(withStart, { status: "loading" })).toEqual({
      kind: "loading",
    });
  });

  it("waits before the unit data has started to load", () => {
    expect(limitReadiness(withStart, { status: "idle" })).toEqual({
      kind: "loading",
    });
  });

  it("says the limit could not be worked out when the unit data failed", () => {
    expect(limitReadiness(withStart, { status: "error" })).toEqual({
      kind: "failed",
    });
  });

  it("does not read a failed load as nothing to disable", () => {
    const readiness = limitReadiness(withStart, {
      status: "error",
      units: [],
    });
    expect(readiness.kind).toBe("failed");
  });

  it("gives the limit once the unit data has loaded", () => {
    const readiness = limitReadiness(withStart, {
      status: "ready",
      units: CLAW,
    });
    expect(readiness.kind).toBe("ready");
    if (readiness.kind !== "ready") return;
    expect(readiness.limit.kind).toBe("limited");
  });

  it("gives the limit from a unit set the worker could not checksum", () => {
    const readiness = limitReadiness(withStart, {
      status: "unsyncable",
      units: CLAW,
    });
    expect(readiness.kind).toBe("ready");
  });

  it("does not wait for unit data when the run has no start unit", () => {
    expect(limitReadiness(run([], undefined), { status: "loading" })).toEqual({
      kind: "ready",
      limit: { kind: "none", reason: "no-start-unit" },
    });
  });

  it("reports a placeholder start unit once the data is in", () => {
    expect(
      limitReadiness(run([], "update_your_damn_engine"), {
        status: "ready",
        units: CLAW,
      }),
    ).toEqual({
      kind: "ready",
      limit: { kind: "none", reason: "start-unit-not-in-data" },
    });
  });

  it("treats a loaded status with no units as a failure", () => {
    expect(limitReadiness(withStart, { status: "ready" })).toEqual({
      kind: "failed",
    });
  });
});

describe("noLimitMessage", () => {
  it("names the placeholder start unit and the game", () => {
    expect(
      noLimitMessage(
        "start-unit-not-in-data",
        "update_your_damn_engine",
        "Zero-K v1.14.8.0",
      ),
    ).toBe(
      "update_your_damn_engine, this run's start unit, is not one of the units in Zero-K v1.14.8.0, so coilbox cannot limit your units. Every unit is available.",
    );
  });

  it("says a run with no start unit has no limit", () => {
    expect(noLimitMessage("no-start-unit", undefined, "Zero-K v1.14.8.0")).toBe(
      "This run has no start unit, so coilbox cannot limit your units. Every unit is available.",
    );
  });

  it("says nothing can be built from a start unit that reaches nothing", () => {
    expect(
      noLimitMessage("reaches-nothing", "random_comm", "Complete Annihilation"),
    ).toBe(
      "Nothing can be built from random_comm, this run's start unit, so coilbox cannot limit your units. Every unit is available.",
    );
  });
});
