import { describe, expect, it } from "vitest";
import { buildGridSnap } from "@/blueprint/footprint";
import { newScenario } from "../../create";
import type { Scenario } from "../../model";
import {
  addActor,
  canTurn,
  clampToMap,
  dragKeys,
  editActor,
  isClick,
  MIN_ACTOR_HP,
  movePlacement,
  normaliseActorState,
  parsePlacementKey,
  pointerNdc,
  pointerTargets,
  pressGesture,
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

describe("isClick", () => {
  it("counts a still pointer as a click", () => {
    expect(isClick({ x: 10, y: 10 }, { x: 12, y: 8 })).toBe(true);
  });

  it("counts a travelled pointer as a drag", () => {
    expect(isClick({ x: 10, y: 10 }, { x: 40, y: 10 })).toBe(false);
    expect(isClick({ x: 10, y: 10 }, { x: 10, y: 40 })).toBe(false);
  });
});

describe("pointerTargets", () => {
  /** A zone's sheet is the one thing a press cannot pick up. */
  const grabbable = (key: string) =>
    !key.startsWith("zone:") || key.includes("@");

  it("finds nothing under a pointer on bare ground", () => {
    expect(pointerTargets([], grabbable)).toEqual({ select: null, grab: null });
  });

  it("selects and grabs the nearest thing when it can be picked up", () => {
    expect(pointerTargets(["actor:a1", "zone:z1"], grabbable)).toEqual({
      select: "actor:a1",
      grab: "actor:a1",
    });
  });

  it("grabs a handle through the sheet lying over it", () => {
    // A zone's move handle sits at the middle of its own sheet, and other
    // zones' sheets drape over it, so the sheet is the nearer hit. Without
    // this the handle could not be grabbed at all.
    expect(
      pointerTargets(["zone:z1", "zone:z2@move", "zone:z2"], grabbable),
    ).toEqual({ select: "zone:z1", grab: "zone:z2@move" });
  });

  it("has nothing to grab where there are only sheets", () => {
    // Panning past a zone that fills the view (#910), and drawing a zone
    // inside another (#837), are both this.
    expect(pointerTargets(["zone:z1", "zone:z2"], grabbable)).toEqual({
      select: "zone:z1",
      grab: null,
    });
  });
});

describe("pressGesture", () => {
  it("picks up what the press can grab", () => {
    expect(pressGesture({ grab: "actor:a1", draws: false })).toBe("grab");
    // Even in a mode that draws: a unit is a thing, not the ground under it.
    expect(pressGesture({ grab: "actor:a1", draws: true })).toBe("grab");
  });

  it("leaves the rest to the camera, or to the mode that draws", () => {
    expect(pressGesture({ grab: null, draws: false })).toBe("camera");
    expect(pressGesture({ grab: null, draws: true })).toBe("draw");
  });
});

describe("pointerNdc", () => {
  const rect = { left: 20, top: 40, width: 200, height: 100 };

  it("puts the centre at the origin", () => {
    const at = pointerNdc({ x: 120, y: 90 }, rect);
    expect(at.x).toBeCloseTo(0);
    expect(at.y).toBeCloseTo(0);
  });

  it("puts the top left at -1, 1", () => {
    expect(pointerNdc({ x: 20, y: 40 }, rect)).toEqual({ x: -1, y: 1 });
  });

  it("survives a canvas with no size", () => {
    expect(
      pointerNdc({ x: 5, y: 5 }, { left: 0, top: 0, width: 0, height: 0 }),
    ).toEqual({ x: 0, y: 0 });
  });
});

describe("clampToMap", () => {
  it("holds a point inside the map", () => {
    expect(clampToMap({ x: -50, z: 9000 }, 4096, 4096)).toEqual({
      x: 0,
      z: 4096,
    });
  });

  it("leaves a point on the map alone", () => {
    expect(clampToMap({ x: 10, z: 20 }, 4096, 4096)).toEqual({ x: 10, z: 20 });
  });
});

describe("parsePlacementKey", () => {
  it("reads the three key shapes", () => {
    expect(parsePlacementKey("actor:a1")).toEqual({
      kind: "actor",
      id: "a1",
      index: 0,
    });
    expect(parsePlacementKey("group:g1#3")).toEqual({
      kind: "group",
      id: "g1",
      index: 3,
    });
    expect(parsePlacementKey("base:b1#0")).toEqual({
      kind: "base",
      id: "b1",
      index: 0,
    });
  });

  it("rejects anything else", () => {
    expect(parsePlacementKey("zone:z1")).toBeNull();
    expect(parsePlacementKey("group:g1")).toBeNull();
    expect(parsePlacementKey("group:g1#x")).toBeNull();
    expect(parsePlacementKey("actor:")).toBeNull();
    expect(parsePlacementKey("")).toBeNull();
  });
});

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

  it("puts a dragged building where the engine would build it", () => {
    // Dropped at 2034, which is nowhere the engine would put a 5 by 5. The axis
    // that was not dragged moves too, because the layout it came from was never
    // on the grid in the first place.
    const next = movePlacement(document(), "base:b1#0", { x: 34, z: 0 }, snap);
    expect(next.blueprints[0].buildings[0].offset).toEqual({ x: 40, z: 8 });
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
    expect(none.blueprints).toEqual([]);
  });

  it("hands back the same document when the key names nothing", () => {
    const before = document();
    expect(removePlacement(before, "actor:gone")).toBe(before);
    expect(removePlacement(before, "group:g1#9")).toBe(before);
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
