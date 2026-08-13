import { describe, expect, it } from "vitest";
import { buildGridSnap } from "@/blueprint/footprint";
import { dragKeys } from "@/placement/placements";
import { draggedBuilding } from "@/placement/preview";
import { newScenario } from "../../create";
import type { Scenario } from "../../model";
import {
  addActor,
  canTurn,
  editActor,
  MIN_ACTOR_HP,
  movePlacement,
  normaliseActorState,
  removePlacement,
  setActorState,
  turnFacing,
  turnPlacement,
} from "./editing";
import { scenarioPlacements } from "./placements";

/** A document with one of each shape, so the three move and delete rules can be
 *  told apart. */
function document(): Scenario {
  return {
    ...newScenario("test"),
    actors: [
      {
        id: "a1",
        unitDef: "armpw",
        team: "p0",
        pos: { x: 100, z: 200 },
        facing: 0,
      },
    ],
    groups: [
      {
        id: "g1",
        team: "p1",
        units: [
          { def: "armpw", count: 2 },
          { def: "armrock", count: 1 },
        ],
        pos: { x: 1000, z: 1000 },
        orders: [],
        dormant: false,
      },
    ],
    blueprints: [
      {
        id: "bp1",
        name: "The keep",
        buildings: [
          { def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 },
          { def: "armllt", offset: { x: 64, z: 0 }, facing: 1 },
        ],
      },
    ],
    bases: [
      {
        id: "b1",
        blueprint: "bp1",
        team: "p1",
        origin: { x: 2000, z: 2000 },
        buildings: [],
      },
    ],
  };
}

describe("dragKeys", () => {
  const placements = scenarioPlacements(document());

  it("drags an actor on its own", () => {
    expect(dragKeys(placements, "actor:a1")).toEqual(["actor:a1"]);
  });

  it("drags a whole group when one of its units is picked up", () => {
    expect(dragKeys(placements, "group:g1#1")).toEqual([
      "group:g1#0",
      "group:g1#1",
      "group:g1#2",
    ]);
  });

  it("drags one building of a base", () => {
    expect(dragKeys(placements, "base:b1#1")).toEqual(["base:b1#1"]);
  });

  it("has nothing to drag for a key that is not drawn", () => {
    expect(dragKeys(placements, "actor:gone")).toEqual([]);
  });
});

describe("movePlacement", () => {
  it("moves an actor and rounds it to whole elmos", () => {
    const next = movePlacement(document(), "actor:a1", { x: 10.4, z: -20.6 });
    expect(next.actors[0].pos).toEqual({ x: 110, z: 179 });
  });

  it("moves the whole group when one of its units is dragged", () => {
    const next = movePlacement(document(), "group:g1#2", { x: 100, z: 0 });
    expect(next.groups[0].pos).toEqual({ x: 1100, z: 1000 });
  });

  it("moves one base building in its layout, leaving the origin alone", () => {
    const next = movePlacement(document(), "base:b1#1", { x: 0, z: 64 });
    expect(next.bases[0].origin).toEqual({ x: 2000, z: 2000 });
    expect(next.blueprints[0].buildings.map((b) => b.offset)).toEqual([
      { x: 0, z: 0 },
      { x: 64, z: 64 },
    ]);
  });

  it("hands back the same document when the key names nothing", () => {
    const before = document();
    expect(movePlacement(before, "actor:gone", { x: 1, z: 1 })).toBe(before);
    expect(movePlacement(before, "base:b1#7", { x: 1, z: 1 })).toBe(before);
    expect(movePlacement(before, "nonsense", { x: 1, z: 1 })).toBe(before);
  });
});

describe("moving a building onto the build grid", () => {
  /** Balanced Annihilation's own footprints: a solar collector is 5 by 5 and a
   *  fusion plant 5 by 4, so one is odd on both axes and the other on one. */
  const snap = buildGridSnap([
    { name: "armsolar", footprintX: 5, footprintZ: 5 },
    { name: "armllt", footprintX: 2, footprintZ: 2 },
    { name: "armfus", footprintX: 5, footprintZ: 4 },
  ]);

  /** One base with one fusion plant on its origin, which is the rectangle worth
   *  turning: its two axes snap by different rules. */
  function withFusion(): Scenario {
    const doc = document();
    return {
      ...doc,
      blueprints: [
        {
          id: "bp1",
          name: "The keep",
          buildings: [{ def: "armfus", offset: { x: 0, z: 0 }, facing: 0 }],
        },
      ],
    };
  }

  /** A layout coilbox did not author: the solar collector's own point is 15
   *  elmos from the square the engine will stand it on. */
  function offGrid(): Scenario {
    const doc = document();
    return {
      ...doc,
      blueprints: [
        {
          ...doc.blueprints[0],
          buildings: [
            { def: "armsolar", offset: { x: 15, z: 0 }, facing: 0 },
            { def: "armllt", offset: { x: 64, z: 0 }, facing: 1 },
          ],
        },
      ],
    };
  }

  it("puts a dragged building where the engine would build it", () => {
    // Dropped at 2034, which is nowhere the engine would put a 5 by 5. The axis
    // that was not dragged has its number written down where the building was
    // already drawn, which moves the offset without moving the building.
    const next = movePlacement(document(), "base:b1#0", { x: 34, z: 0 }, snap);
    expect(next.blueprints[0].buildings[0].offset).toEqual({ x: 40, z: 8 });
  });

  /**
   * Issue #1517. A drag carries the building the author is looking at, which
   * stands where the engine will build it rather than on the point its layout
   * names. Measuring from the named point put a two elmo drag a whole build
   * square away on any layout the grid had moved.
   */
  it("drags from where the building is drawn, not from the point named", () => {
    // The layout names 2015 and the engine stands a 5 by 5 at 2008, so two
    // elmos is a building that has not left the square it was drawn on.
    const next = movePlacement(offGrid(), "base:b1#0", { x: 2, z: 0 }, snap);
    expect(next.blueprints[0].buildings[0].offset).toEqual({ x: 8, z: 8 });
  });

  /** The whole point of the preview a drag draws (#1512): what it showed is
   *  where the building lands, on a layout the grid moved as much as on one it
   *  did not. */
  it("lands the building on the square the drag preview drew", () => {
    for (const delta of [
      { x: 2, z: 0 },
      { x: 34, z: -9 },
      { x: -30, z: 7 },
      { x: 0, z: 0 },
    ]) {
      const doc = offGrid();
      const held = draggedBuilding(
        scenarioPlacements(doc, snap),
        "base:b1#0",
        delta,
      );
      if (!held) throw new Error("the drag carried nothing");
      const dropped = scenarioPlacements(
        movePlacement(doc, "base:b1#0", delta, snap),
        snap,
      ).find((one) => one.key === "base:b1#0");
      expect(dropped?.pos).toEqual(snap(held.pos, held.def, held.facing));
    }
  });

  it("snaps an even footprint to the other grid", () => {
    // The same drop point, on a 2 by 2 rather than a 5 by 5: an even footprint
    // centres where four build squares meet, an odd one in the middle of one.
    const next = movePlacement(document(), "base:b1#1", { x: -30, z: 0 }, snap);
    expect(next.blueprints[0].buildings[1].offset).toEqual({ x: 32, z: 0 });
  });

  it("leaves the drop where it landed when no footprints are known", () => {
    const next = movePlacement(document(), "base:b1#0", { x: 34, z: 0 });
    expect(next.blueprints[0].buildings[0].offset).toEqual({ x: 34, z: 0 });
  });

  it("re-snaps a turned building, because its sides have swapped", () => {
    const next = turnPlacement(withFusion(), "base:b1#0", 1, snap);
    expect(next.blueprints[0].buildings[0].facing).toBe(1);
    expect(next.blueprints[0].buildings[0].offset).toEqual({ x: 0, z: 8 });
  });

  it("only turns when no footprints are known", () => {
    const next = turnPlacement(withFusion(), "base:b1#0", 1);
    expect(next.blueprints[0].buildings[0].offset).toEqual({ x: 0, z: 0 });
  });
});

describe("turning", () => {
  it("wraps a facing both ways", () => {
    expect(turnFacing(3, 1)).toBe(0);
    expect(turnFacing(0, -1)).toBe(3);
    expect(turnFacing(1, 4)).toBe(1);
  });

  it("turns an actor and a base building", () => {
    expect(turnPlacement(document(), "actor:a1").actors[0].facing).toBe(1);
    expect(
      turnPlacement(document(), "base:b1#1").blueprints[0].buildings[1].facing,
    ).toBe(2);
  });

  it("leaves a group alone, because it has no facing", () => {
    const before = document();
    expect(turnPlacement(before, "group:g1#0")).toBe(before);
    expect(canTurn("group:g1#0")).toBe(false);
    expect(canTurn("actor:a1")).toBe(true);
    expect(canTurn("base:b1#0")).toBe(true);
  });
});

describe("removePlacement", () => {
  it("removes an actor", () => {
    expect(removePlacement(document(), "actor:a1").actors).toEqual([]);
  });

  it("takes one off the count of the group unit that was picked", () => {
    const next = removePlacement(document(), "group:g1#0");
    expect(next.groups[0].units).toEqual([
      { def: "armpw", count: 1 },
      { def: "armrock", count: 1 },
    ]);
  });

  it("drops the entry when its last unit goes", () => {
    const next = removePlacement(document(), "group:g1#2");
    expect(next.groups[0].units).toEqual([{ def: "armpw", count: 2 }]);
  });

  it("drops the group when its last unit goes", () => {
    let doc = document();
    for (const key of ["group:g1#2", "group:g1#1", "group:g1#0"]) {
      doc = removePlacement(doc, key);
    }
    expect(doc.groups).toEqual([]);
  });

  it("removes one base building, and the base with its last", () => {
    const one = removePlacement(document(), "base:b1#0");
    expect(one.blueprints[0].buildings.map((b) => b.def)).toEqual(["armllt"]);
    const none = removePlacement(one, "base:b1#0");
    expect(none.bases).toEqual([]);
    // The layout stays behind, listed as one nothing places (#1424).
    expect(none.blueprints.map((b) => b.id)).toEqual(["bp1"]);
  });

  it("hands back the same document when the key names nothing", () => {
    const before = document();
    expect(removePlacement(before, "actor:gone")).toBe(before);
    expect(removePlacement(before, "group:g1#9")).toBe(before);
  });
});

describe("dragging a building of a base that shares its layout", () => {
  /** The document's one layout placed twice. */
  function shared(): Scenario {
    const doc = document();
    return {
      ...doc,
      bases: [
        ...doc.bases,
        {
          id: "b2",
          blueprint: "bp1",
          team: "p0",
          origin: { x: 5000, z: 5000 },
          buildings: [],
        },
      ],
    };
  }

  const layoutOf = (scenario: Scenario, id: string) =>
    scenario.blueprints.find(
      (b) => b.id === scenario.bases.find((p) => p.id === id)?.blueprint,
    );

  it("moves the building in a copy, leaving the other base where it stood", () => {
    const next = movePlacement(shared(), "base:b1#1", { x: 0, z: 64 });
    expect(next.blueprints).toHaveLength(2);
    expect(layoutOf(next, "b1")?.buildings[1].offset).toEqual({ x: 64, z: 64 });
    expect(layoutOf(next, "b2")?.buildings[1].offset).toEqual({ x: 64, z: 0 });
  });

  it("moves it in both when the author asked to edit the shared layout", () => {
    const next = movePlacement(
      shared(),
      "base:b1#1",
      { x: 0, z: 64 },
      undefined,
      "shared",
    );
    expect(next.blueprints).toHaveLength(1);
    expect(layoutOf(next, "b2")?.buildings[1].offset).toEqual({ x: 64, z: 64 });
  });

  it("turns a building in a copy", () => {
    const next = turnPlacement(shared(), "base:b1#1");
    expect(layoutOf(next, "b1")?.buildings[1].facing).toBe(2);
    expect(layoutOf(next, "b2")?.buildings[1].facing).toBe(1);
  });

  it("deletes a building from a copy", () => {
    const next = removePlacement(shared(), "base:b1#0");
    expect(layoutOf(next, "b1")?.buildings.map((b) => b.def)).toEqual([
      "armllt",
    ]);
    expect(layoutOf(next, "b2")?.buildings.map((b) => b.def)).toEqual([
      "armsolar",
      "armllt",
    ]);
  });

  it("hands the same document back when the key names no building", () => {
    const before = shared();
    expect(movePlacement(before, "base:b1#7", { x: 1, z: 1 })).toBe(before);
    expect(before.blueprints).toHaveLength(1);
  });
});

describe("addActor", () => {
  it("appends a rounded actor without touching the rest", () => {
    const before = document();
    const next = addActor(before, "a2", {
      unitDef: "armrock",
      team: "p0",
      pos: { x: 10.6, z: 20.2 },
      facing: 2,
    });
    expect(next.actors).toHaveLength(2);
    expect(next.actors[1]).toEqual({
      id: "a2",
      unitDef: "armrock",
      team: "p0",
      pos: { x: 11, z: 20 },
      facing: 2,
    });
    expect(before.actors).toHaveLength(1);
  });
});

describe("editActor", () => {
  it("changes the fields it is given and leaves the rest", () => {
    const before = document();
    const next = editActor(before, "a1", { team: "p1", facing: 3 });
    expect(next.actors[0]).toEqual({
      ...before.actors[0],
      team: "p1",
      facing: 3,
    });
    expect(before.actors[0].team).toBe("p0");
  });

  it("hands back the same document for an id it does not have", () => {
    const before = document();
    expect(editActor(before, "nope", { team: "p1" })).toBe(before);
  });
});

describe("normaliseActorState", () => {
  it("drops everything the game would do anyway", () => {
    expect(
      normaliseActorState({
        hp: 1,
        invulnerable: false,
        unselectable: false,
        name: "   ",
      }),
    ).toBeUndefined();
  });

  it("keeps what was actually overridden", () => {
    expect(
      normaliseActorState({
        hp: 0.5,
        invulnerable: true,
        unselectable: true,
        name: "  Jarmen Kell  ",
      }),
    ).toEqual({
      hp: 0.5,
      invulnerable: true,
      unselectable: true,
      name: "Jarmen Kell",
    });
  });

  it("holds health above nothing, so the unit lives to be nearly dead", () => {
    expect(normaliseActorState({ hp: 0 })).toEqual({ hp: MIN_ACTOR_HP });
    expect(normaliseActorState({ hp: -3 })).toEqual({ hp: MIN_ACTOR_HP });
  });

  it("ignores a health that is not a number or is above full", () => {
    expect(normaliseActorState({ hp: Number.NaN })).toBeUndefined();
    expect(normaliseActorState({ hp: 2 })).toBeUndefined();
  });
});

describe("setActorState", () => {
  it("writes the overrides that survive normalising", () => {
    const next = setActorState(document(), "a1", { hp: 0.25, name: "Boss" });
    expect(next.actors[0].state).toEqual({ hp: 0.25, name: "Boss" });
  });

  it("takes the state off an actor with nothing left to say", () => {
    const withState = setActorState(document(), "a1", { invulnerable: true });
    const cleared = setActorState(withState, "a1", { invulnerable: false });
    expect(cleared.actors[0].state).toBeUndefined();
  });
});
