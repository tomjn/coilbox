import { describe, expect, it } from "vitest";
import type { Participant } from "@/play/config";
import type { Scenario } from "../../model";
import {
  facingToYaw,
  groupFormationOffset,
  placementKey,
  scenarioPlacements,
  teamColor,
  UNOWNED_COLOR,
} from "./placements";

type Registries = Pick<Scenario, "actors" | "groups" | "bases" | "blueprints">;

const empty: Registries = {
  actors: [],
  groups: [],
  bases: [],
  blueprints: [],
};

describe("scenarioPlacements", () => {
  it("draws an actor where the document puts it", () => {
    const out = scenarioPlacements({
      ...empty,
      actors: [
        {
          id: "a1",
          unitDef: "armcom",
          team: "p0",
          pos: { x: 512, z: 1024 },
          facing: 2,
        },
      ],
    });
    expect(out).toEqual([
      {
        key: "actor:a1",
        kind: "actor",
        id: "a1",
        index: 0,
        def: "armcom",
        team: "p0",
        pos: { x: 512, z: 1024 },
        facing: 2,
      },
    ]);
  });

  it("expands a group's counts one unit per model", () => {
    const out = scenarioPlacements({
      ...empty,
      groups: [
        {
          id: "g1",
          team: "p1",
          units: [
            { def: "armpw", count: 3 },
            { def: "armflash", count: 1 },
          ],
          pos: { x: 1000, z: 1000 },
          orders: [],
          dormant: false,
        },
      ],
    });
    expect(out).toHaveLength(4);
    expect(out.map((p) => p.def)).toEqual([
      "armpw",
      "armpw",
      "armpw",
      "armflash",
    ]);
    expect(out.map((p) => p.key)).toEqual([
      "group:g1#0",
      "group:g1#1",
      "group:g1#2",
      "group:g1#3",
    ]);
    // Every unit belongs to the group and faces the engine's zero.
    expect(out.every((p) => p.id === "g1" && p.facing === 0)).toBe(true);
  });

  it("centres a group's formation on the group's position", () => {
    const out = scenarioPlacements({
      ...empty,
      groups: [
        {
          id: "g1",
          team: "p1",
          units: [{ def: "armpw", count: 4 }],
          pos: { x: 2000, z: 3000 },
          orders: [],
          dormant: false,
        },
      ],
    });
    const meanX = out.reduce((s, p) => s + p.pos.x, 0) / out.length;
    const meanZ = out.reduce((s, p) => s + p.pos.z, 0) / out.length;
    expect(meanX).toBeCloseTo(2000);
    expect(meanZ).toBeCloseTo(3000);
  });

  it("offsets a base's buildings from its origin", () => {
    const out = scenarioPlacements({
      ...empty,
      blueprints: [
        {
          id: "bp1",
          name: "The keep",
          buildings: [
            { def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 },
            { def: "armlab", offset: { x: -64, z: 128 }, facing: 3 },
          ],
        },
      ],
      bases: [
        {
          id: "pf1",
          blueprint: "bp1",
          team: "p0",
          origin: { x: 500, z: 600 },
          buildings: [],
        },
      ],
    });
    expect(out.map((p) => p.pos)).toEqual([
      { x: 500, z: 600 },
      { x: 436, z: 728 },
    ]);
    expect(out[1]).toMatchObject({
      key: "base:pf1#1",
      kind: "base",
      index: 1,
      facing: 3,
    });
  });

  /** A placement whose blueprint is gone draws nothing rather than throwing.
   *  The parser refuses to load one, so this is the in-memory half-edit only. */
  it("draws nothing for a base whose layout is missing", () => {
    const out = scenarioPlacements({
      ...empty,
      bases: [
        {
          id: "pf1",
          blueprint: "gone",
          team: "p0",
          origin: { x: 500, z: 600 },
          buildings: [],
        },
      ],
    });
    expect(out).toEqual([]);
  });

  it("gives every unit in a mixed document a unique key", () => {
    const out = scenarioPlacements({
      actors: [
        {
          id: "shared",
          unitDef: "armcom",
          team: "p0",
          pos: { x: 0, z: 0 },
          facing: 0,
        },
      ],
      groups: [
        {
          id: "shared",
          team: "p0",
          units: [{ def: "armpw", count: 2 }],
          pos: { x: 0, z: 0 },
          orders: [],
          dormant: false,
        },
      ],
      blueprints: [
        {
          id: "bp1",
          name: "The keep",
          buildings: [{ def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 }],
        },
      ],
      bases: [
        {
          id: "shared",
          blueprint: "bp1",
          team: "p0",
          origin: { x: 0, z: 0 },
          buildings: [],
        },
      ],
    });
    expect(new Set(out.map((p) => p.key)).size).toBe(out.length);
  });

  it("draws nothing for an empty document", () => {
    expect(scenarioPlacements(empty)).toEqual([]);
  });
});

describe("placementKey", () => {
  it("agrees with the keys scenarioPlacements writes", () => {
    expect(placementKey("actor", "a1")).toBe("actor:a1");
    expect(placementKey("group", "g1", 2)).toBe("group:g1#2");
    expect(placementKey("base", "pf1", 0)).toBe("base:pf1#0");
  });
});

describe("groupFormationOffset", () => {
  it("puts a single unit on the group's own point", () => {
    expect(groupFormationOffset(0, 1)).toEqual({ x: 0, z: 0 });
  });

  it("spaces a row out by the spacing", () => {
    const a = groupFormationOffset(0, 4, 100);
    const b = groupFormationOffset(1, 4, 100);
    expect(b.x - a.x).toBeCloseTo(100);
    expect(b.z).toBeCloseTo(a.z);
  });

  it("wraps onto a new row at the grid's width", () => {
    const first = groupFormationOffset(0, 4, 100);
    const wrapped = groupFormationOffset(2, 4, 100);
    expect(wrapped.x).toBeCloseTo(first.x);
    expect(wrapped.z - first.z).toBeCloseTo(100);
  });

  it("never puts two units of a group in the same place", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 17; i++) {
      const { x, z } = groupFormationOffset(i, 17);
      seen.add(`${x},${z}`);
    }
    expect(seen.size).toBe(17);
  });
});

describe("facingToYaw", () => {
  it("leaves the engine's south facing unrotated", () => {
    expect(facingToYaw(0)).toBe(0);
  });

  it("turns a quarter per facing, the way three rotates +z toward +x", () => {
    expect(facingToYaw(1)).toBeCloseTo(Math.PI / 2);
    expect(facingToYaw(2)).toBeCloseTo(Math.PI);
    expect(facingToYaw(3)).toBeCloseTo((3 * Math.PI) / 2);
  });
});

describe("teamColor", () => {
  const participants = [
    { id: "p0", color: [1, 0, 0] },
    { id: "p1", color: [0, 0, 1] },
  ] as Participant[];

  it("takes the participant's own colour", () => {
    expect(teamColor(participants, "p1")).toEqual([0, 0, 1]);
  });

  it("falls back to grey for a team the setup no longer has", () => {
    expect(teamColor(participants, "gone")).toBe(UNOWNED_COLOR);
  });
});
