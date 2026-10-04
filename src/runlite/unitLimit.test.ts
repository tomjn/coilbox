import { describe, expect, it } from "vitest";
import type { UnitDatasetEntry } from "../content/bindings";
import { buildBuildGraph, buildEdgeMap } from "../content/buildTree";
import { morphEdgeMap } from "../content/morphGraph";
import type { RogueliteRun } from "./model";
import {
  limitHold,
  limitReadiness,
  noLimitMessage,
  noLimitReason,
  setupLimitWarning,
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
  const morphs = morphEdgeMap(CLAW);

  it("limits a run to what it has unlocked, from a start unit that reaches a roster", () => {
    const limit = unitLimitFor(
      run(["claw_commander", "claw_light_plant"], "claw_commander"),
      edges,
      morphs,
    );
    expect(limit.kind).toBe("limited");
    if (limit.kind !== "limited") return;
    expect(limit.disabled.sort()).toEqual([
      "claw_avenger",
      "claw_knife",
      "claw_tombstone",
      "claw_totem",
      "claw_totem_laser",
    ]);
  });

  it("gives no limit for a placeholder start unit, and says why", () => {
    expect(
      unitLimitFor(run([], "update_your_damn_engine"), edges, morphs),
    ).toEqual({
      kind: "none",
      reason: "start-unit-not-in-data",
    });
  });

  it("gives no limit for a start unit that reaches nothing, and says why", () => {
    expect(unitLimitFor(run([], "claw_light_drone"), edges, morphs)).toEqual({
      kind: "none",
      reason: "reaches-nothing",
    });
  });

  it("leaves a form the start unit morphs into alone, since its source is unlocked", () => {
    // `claw_u1commander` builds what `claw_commander` does but nothing builds
    // it, so no reward can offer it. It stays available because the unit that
    // morphs into it is unlocked.
    const limit = unitLimitFor(
      run(["claw_commander"], "claw_commander"),
      edges,
      morphs,
    );
    if (limit.kind !== "limited") throw new Error("expected a limit");
    expect(limit.disabled).not.toContain("claw_u1commander");
  });

  it("disables a form that only a locked unit morphs into, and nothing else new", () => {
    const limit = unitLimitFor(
      run(["claw_commander"], "claw_commander"),
      edges,
      morphs,
    );
    if (limit.kind !== "limited") throw new Error("expected a limit");
    expect(limit.disabled.sort()).toEqual([
      "claw_avenger",
      "claw_knife",
      "claw_light_plant",
      "claw_tombstone",
      "claw_totem",
      "claw_totem_laser",
    ]);
  });

  it("frees a form once the unit that morphs into it is unlocked", () => {
    const limit = unitLimitFor(
      run(["claw_commander", "claw_tombstone"], "claw_commander"),
      edges,
      morphs,
    );
    if (limit.kind !== "limited") throw new Error("expected a limit");
    expect(limit.disabled).not.toContain("claw_avenger");
    expect(limit.disabled).toContain("claw_totem_laser");
  });

  it("frees a form that two units morph into when either is unlocked", () => {
    const two = [...CLAW, unit("claw_totem_hybrid", [], ["claw_avenger"])];
    const twoEdges = buildEdgeMap([
      ...two.slice(0, 1),
      unit(
        "claw_commander",
        [...CLAW_BUILDS, "claw_totem_hybrid"],
        ["claw_u1commander"],
      ),
      ...two.slice(1),
    ]);
    const twoMorphs = morphEdgeMap(two);
    const limit = unitLimitFor(
      run(["claw_commander", "claw_totem_hybrid"], "claw_commander"),
      twoEdges,
      twoMorphs,
    );
    if (limit.kind !== "limited") throw new Error("expected a limit");
    expect(limit.disabled).not.toContain("claw_avenger");
  });

  it("keeps a chain of forms, and what a form builds, open from an unlocked unit", () => {
    // `fedcommander_up1` builds a unit the base commander does not. A reward
    // cannot offer that unit, so it opens up with the form that builds it.
    const fed = [
      unit("fedcommander", ["fed_solar"], ["fedcommander_up1"]),
      unit(
        "fedcommander_up1",
        ["fed_solar", "fed_beam_tower"],
        ["fedcommander_up2"],
      ),
      unit("fedcommander_up2", ["fed_solar", "fed_beam_tower"]),
      unit("fed_solar"),
      unit("fed_beam_tower"),
    ];
    const fedLimit = (unlocked: string[]) =>
      unitLimitFor(
        run(unlocked, "fedcommander"),
        buildEdgeMap(fed),
        morphEdgeMap(fed),
      );
    const open = fedLimit(["fedcommander", "fed_solar"]);
    if (open.kind !== "limited") throw new Error("expected a limit");
    expect(open.disabled).toEqual([]);
  });

  it("locks a whole chain of forms behind a locked unit", () => {
    const chain = [...CLAW, unit("claw_totem_laser2")].map((u) =>
      u.name === "claw_totem_laser"
        ? unit("claw_totem_laser", [], ["claw_totem_laser2"])
        : u,
    );
    const chainEdges = buildEdgeMap(chain);
    const chainMorphs = morphEdgeMap(chain);
    const locked = unitLimitFor(
      run(["claw_commander"], "claw_commander"),
      chainEdges,
      chainMorphs,
    );
    if (locked.kind !== "limited") throw new Error("expected a limit");
    expect(locked.disabled).toContain("claw_totem_laser");
    expect(locked.disabled).toContain("claw_totem_laser2");
    const open = unitLimitFor(
      run(["claw_commander", "claw_totem"], "claw_commander"),
      chainEdges,
      chainMorphs,
    );
    if (open.kind !== "limited") throw new Error("expected a limit");
    expect(open.disabled).not.toContain("claw_totem_laser");
    expect(open.disabled).not.toContain("claw_totem_laser2");
  });

  it("disables nothing once every unit the start unit builds is unlocked", () => {
    const limit = unitLimitFor(
      run(
        [
          "claw_commander",
          "claw_light_plant",
          "claw_knife",
          "claw_totem",
          "claw_tombstone",
        ],
        "claw_commander",
      ),
      edges,
      morphs,
    );
    expect(limit).toEqual({ kind: "limited", disabled: [] });
  });

  it("never disables a unit the start unit builds because of a morph", () => {
    // The morph rule only adds forms nothing builds, so it cannot take away
    // anything the start unit builds directly.
    const withMorph = unitLimitFor(
      run(["claw_commander"], "claw_commander"),
      edges,
      morphs,
    );
    const withoutMorph = unitLimitFor(
      run(["claw_commander"], "claw_commander"),
      edges,
      new Map(),
    );
    if (withMorph.kind !== "limited" || withoutMorph.kind !== "limited") {
      throw new Error("expected a limit");
    }
    for (const built of CLAW_BUILDS) {
      expect(withMorph.disabled.includes(built)).toBe(
        withoutMorph.disabled.includes(built),
      );
    }
  });

  it("never disables a unit that no route reaches", () => {
    const limit = unitLimitFor(
      run(["claw_commander"], "claw_commander"),
      edges,
      morphs,
    );
    if (limit.kind !== "limited") throw new Error("expected a limit");
    expect(limit.disabled).not.toContain("claw_light_drone");
  });

  it("covers every unit the unlock rewards can offer", () => {
    // Rewards are drawn from the build graph, so a reward the run offers is
    // always one the limit understands. Forms nothing builds are locked as
    // well, and open up with the unit that morphs into them.
    const offered = buildBuildGraph("claw_commander", edges).order;
    const limit = unitLimitFor(run([], "claw_commander"), edges, morphs);
    if (limit.kind !== "limited") throw new Error("expected a limit");
    // The start unit counts as available, so its own form is never locked.
    const forms = ["claw_totem_laser", "claw_avenger"];
    expect(limit.disabled.sort()).toEqual([...offered, ...forms].sort());
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

describe("limitHold", () => {
  it("shows the launch button as busy while the unit data loads", () => {
    expect(limitHold({ kind: "loading" })).toEqual({
      label: "Loading unit data…",
      busy: true,
      error: undefined,
    });
  });

  it("says the battle will not launch when the unit data failed", () => {
    const hold = limitHold({ kind: "failed" });
    expect(hold?.busy).toBe(false);
    expect(hold?.label).toBe("Cannot launch without unit data");
    expect(hold?.error).toBe(
      "Coilbox could not read this game's unit data, so it cannot work out your unit limit. The battle will not launch until it can.",
    );
  });

  it("holds nothing back once the limit is known", () => {
    expect(
      limitHold({
        kind: "ready",
        limit: { kind: "none", reason: "no-start-unit" },
      }),
    ).toBeNull();
  });
});

describe("setupLimitWarning", () => {
  const side = { gameName: "Zero-K v1.14.8.0", sideName: "Robots" };
  const tail =
    "so coilbox cannot limit your units. Rewards will offer perks only and every unit will be available from the first battle.";

  it("warns about Zero-K's placeholder start unit", () => {
    expect(
      setupLimitWarning({
        ...side,
        startUnit: "update_your_damn_engine",
        status: "ready",
        units: CLAW,
      }),
    ).toBe(
      `The start unit for Robots, update_your_damn_engine, is not one of the units in Zero-K v1.14.8.0, ${tail}`,
    );
  });

  it("warns about a side with no start unit", () => {
    expect(setupLimitWarning({ ...side, status: "ready", units: CLAW })).toBe(
      `Robots has no start unit in Zero-K v1.14.8.0, ${tail}`,
    );
  });

  it("warns about a start unit that builds nothing", () => {
    expect(
      setupLimitWarning({
        ...side,
        startUnit: "claw_light_drone",
        status: "ready",
        units: CLAW,
      }),
    ).toBe(
      `Nothing can be built from claw_light_drone, the start unit for Robots, ${tail}`,
    );
  });

  it("warns when the unit data could not be read", () => {
    expect(
      setupLimitWarning({
        ...side,
        startUnit: "claw_commander",
        status: "error",
      }),
    ).toBe(
      "Coilbox could not read this game's unit data, so it cannot limit your units. Rewards will offer perks only and every unit will be available from the first battle.",
    );
  });

  it("says nothing while the unit data loads", () => {
    expect(
      setupLimitWarning({
        ...side,
        startUnit: "claw_commander",
        status: "loading",
      }),
    ).toBeNull();
  });

  it("says nothing for a start unit that reaches a roster", () => {
    expect(
      setupLimitWarning({
        ...side,
        startUnit: "claw_commander",
        status: "ready",
        units: CLAW,
      }),
    ).toBeNull();
  });
});
