import { describe, expect, it } from "vitest";
import { buildGridSnap } from "@/blueprint/footprint";
import { baseFootprints } from "@/placement/placements";
import type { Scenario } from "../../model";
import { groupFormationOffset, scenarioPlacements } from "./placements";

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

  /** A layout nothing in coilbox placed: the origin is off the build grid, so
   *  every building of it is somewhere the engine would not stand one. */
  const offGrid: Registries = {
    ...empty,
    blueprints: [
      {
        id: "bp1",
        name: "The keep",
        buildings: [
          { def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 },
          { def: "armfus", offset: { x: 96, z: 0 }, facing: 1 },
        ],
      },
    ],
    bases: [
      {
        id: "pf1",
        blueprint: "bp1",
        team: "p0",
        origin: { x: 507, z: 603 },
        buildings: [],
      },
    ],
  };

  const gridUnits = [
    { name: "armsolar", footprintX: 5, footprintZ: 5 },
    { name: "armfus", footprintX: 5, footprintZ: 4 },
  ];

  it("draws a base's buildings where the engine will stand them", () => {
    const snap = buildGridSnap(gridUnits);
    const out = scenarioPlacements(offGrid, snap);
    expect(out.map((p) => p.pos)).toEqual([
      // 507 and 603 are both inside a build square, and a 5 by 5 stands in the
      // middle of one, so both axes move to the nearest middle.
      { x: 504, z: 600 },
      // Turned a quarter, so the 5 by 4 stands on 4 by 5: the x axis is even
      // and centres on the corner between two squares instead.
      { x: 608, z: 600 },
    ]);
  });

  it("draws the model and its footprint square in the same place", () => {
    const snap = buildGridSnap(gridUnits);
    const out = scenarioPlacements(offGrid, snap);
    const marks = baseFootprints(out, gridUnits);
    expect(marks.map((m) => m.pos)).toEqual(out.map((p) => p.pos));
  });

  it("leaves the document alone", () => {
    const before = structuredClone(offGrid);
    scenarioPlacements(offGrid, buildGridSnap(gridUnits));
    expect(offGrid).toEqual(before);
  });

  it("draws on the document's own point when the game is not read yet", () => {
    const out = scenarioPlacements(offGrid);
    expect(out.map((p) => p.pos)).toEqual([
      { x: 507, z: 603 },
      { x: 603, z: 603 },
    ]);
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
