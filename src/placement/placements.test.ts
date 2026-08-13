import { describe, expect, it } from "vitest";
import type { Participant } from "@/play/config";
import type { Scenario } from "@/scenario/model";
import { scenarioPlacements } from "@/scenario/pages/components/placements";
import {
  absentIn,
  baseFootprints,
  facingToYaw,
  overlappingIn,
  parsePlacementKey,
  placementKey,
  sceneUnchecked,
  teamColor,
  UNOWNED_COLOR,
  unjudgedIn,
  unstableIn,
  wrongDepthIn,
} from "./placements";

type Registries = Pick<Scenario, "actors" | "groups" | "bases" | "blueprints">;

const empty: Registries = {
  actors: [],
  groups: [],
  bases: [],
  blueprints: [],
};

describe("baseFootprints", () => {
  /** Balanced Annihilation's own numbers: a lab is 6 by 6, a solar collector 5
   *  by 5, and a pawn is a bot rather than a building. */
  const units = [
    { name: "armlab", footprintX: 6, footprintZ: 6 },
    { name: "armsolar", footprintX: 5, footprintZ: 5 },
    { name: "armpw", footprintX: 2, footprintZ: 2 },
  ];

  /** A base of two buildings, `apart` elmos between them on the x axis. */
  const base = (apart: number): Registries => ({
    ...empty,
    blueprints: [
      {
        id: "bp1",
        name: "The keep",
        buildings: [
          { def: "armlab", offset: { x: 0, z: 0 }, facing: 0 },
          { def: "armsolar", offset: { x: apart, z: 0 }, facing: 0 },
        ],
      },
    ],
    bases: [
      {
        id: "pf1",
        blueprint: "bp1",
        team: "p0",
        origin: { x: 1000, z: 1000 },
        buildings: [],
      },
    ],
  });

  it("leaves two buildings that fit side by side alone", () => {
    // A 6 and a 5 need half of each between their middles, which is 48 and 40.
    const marks = baseFootprints(scenarioPlacements(base(96)), units);
    expect(marks.map((m) => m.overlapping)).toEqual([false, false]);
    expect(marks[0].footprint).toEqual({ x: 6, z: 6 });
  });

  it("marks two that want the same ground", () => {
    const marks = baseFootprints(scenarioPlacements(base(64)), units);
    expect(marks.map((m) => m.overlapping)).toEqual([true, true]);
  });

  it("says nothing about actors and groups standing on a base", () => {
    const doc = base(96);
    const marks = baseFootprints(
      scenarioPlacements({
        ...doc,
        actors: [
          {
            id: "a1",
            unitDef: "armpw",
            team: "p0",
            pos: { x: 1000, z: 1000 },
            facing: 0,
          },
        ],
      }),
      units,
    );
    // The bot is standing in the lab's doorway, which is a bot's business.
    expect(marks).toHaveLength(2);
    expect(marks.every((m) => !m.overlapping)).toBe(true);
  });
});

/**
 * Issue #1445. The import knew this layout named a unit the game has not got
 * and said so, and then the layout was taken and the knowledge was thrown away.
 * Worked out from the placements instead, so it is true of a layout typed or
 * edited into that state as well as of an imported one.
 */
describe("absentIn", () => {
  const units = [
    { name: "armlab", footprintX: 6, footprintZ: 6, maxSlope: 10 },
  ];

  const doc: Registries = {
    ...empty,
    blueprints: [
      {
        id: "bp1",
        name: "Somebody else's keep",
        buildings: [
          { def: "armlab", offset: { x: 0, z: 0 }, facing: 0 },
          { def: "legsolar", offset: { x: 512, z: 0 }, facing: 0 },
          { def: "legwin", offset: { x: 1024, z: 0 }, facing: 0 },
        ],
      },
    ],
    bases: [
      {
        id: "pf1",
        blueprint: "bp1",
        team: "p0",
        origin: { x: 1000, z: 1000 },
        buildings: [],
      },
    ],
  };

  it("names the buildings whose units the game has not got", () => {
    const placements = scenarioPlacements(doc);
    const marks = baseFootprints(placements, units, null);
    expect(absentIn(placements, marks, "pf1")).toEqual([
      { index: 1, def: "legsolar" },
      { index: 2, def: "legwin" },
    ]);
  });

  /** The loading case. Before the units are read nothing is missing, it is only
   *  unread, and accusing the lot would be a wall of warnings that clears
   *  itself. */
  it("accuses nothing before the game's units have been read", () => {
    const placements = scenarioPlacements(doc);
    const marks = baseFootprints(placements, [], null);
    expect(absentIn(placements, marks, "pf1")).toEqual([]);
  });

  it("says nothing about a base that is not the one asked for", () => {
    const placements = scenarioPlacements(doc);
    const marks = baseFootprints(placements, units, null);
    expect(absentIn(placements, marks, "other")).toEqual([]);
  });
});

describe("unjudgedIn", () => {
  /** A lab with a slope, a solar collector whose entry has none, and a bot the
   *  game has, so the three reasons can be told apart in one base. */
  const units = [
    { name: "armlab", footprintX: 6, footprintZ: 6, maxSlope: 10 },
    { name: "armsolar", footprintX: 5, footprintZ: 5 },
  ];

  const doc: Registries = {
    ...empty,
    blueprints: [
      {
        id: "bp1",
        name: "The keep",
        buildings: [
          { def: "armlab", offset: { x: 0, z: 0 }, facing: 0 },
          { def: "armsolar", offset: { x: 512, z: 0 }, facing: 0 },
        ],
      },
    ],
    bases: [
      {
        id: "pf1",
        blueprint: "bp1",
        team: "p0",
        origin: { x: 1000, z: 1000 },
        buildings: [],
      },
    ],
  };

  /** Level ground read exactly, so nothing here is refused for a slope and the
   *  only thing left to report is what could not be judged. */
  const flat = {
    cornerAt: () => 0,
    slack: 0,
    minHeight: 0,
    maxHeight: 0,
    hasWater: true,
  };

  it("blames the map when there is no ground to check against", () => {
    const placements = scenarioPlacements(doc);
    const marks = baseFootprints(placements, units, null);
    expect(unjudgedIn(placements, marks, "pf1")).toEqual({
      noGround: [0],
      noUnits: [],
      noSlope: [1],
    });
  });

  it("blames the dataset for a def whose entry has no slope", () => {
    const placements = scenarioPlacements(doc);
    const marks = baseFootprints(placements, units, flat);
    expect(unjudgedIn(placements, marks, "pf1")).toEqual({
      noGround: [],
      noUnits: [],
      noSlope: [1],
    });
  });

  /** The loading case. Every building is unjudged for one reason, and it is not
   *  the reason that would have an author reinstalling their game. */
  it("blames the read still in flight before the units are read", () => {
    const placements = scenarioPlacements(doc);
    const marks = baseFootprints(placements, [], flat);
    expect(unjudgedIn(placements, marks, "pf1")).toEqual({
      noGround: [],
      noUnits: [0, 1],
      noSlope: [],
    });
  });

  it("says nothing about a base that is not the one asked for", () => {
    const placements = scenarioPlacements(doc);
    const marks = baseFootprints(placements, units, null);
    expect(unjudgedIn(placements, marks, "other")).toEqual({
      noGround: [],
      noUnits: [],
      noSlope: [],
    });
  });
});

/**
 * Issue #1496. The two reasons that are true of the whole surface at once, asked
 * about the surface rather than about one base.
 */
describe("sceneUnchecked", () => {
  const units = [
    { name: "armlab", footprintX: 6, footprintZ: 6, maxSlope: 10 },
    { name: "armsolar", footprintX: 5, footprintZ: 5, maxSlope: 12 },
  ];

  const doc: Registries = {
    ...empty,
    blueprints: [
      {
        id: "bp1",
        name: "The keep",
        buildings: [
          { def: "armlab", offset: { x: 0, z: 0 }, facing: 0 },
          { def: "armsolar", offset: { x: 512, z: 0 }, facing: 0 },
        ],
      },
    ],
    bases: [
      {
        id: "pf1",
        blueprint: "bp1",
        team: "p0",
        origin: { x: 1000, z: 1000 },
        buildings: [],
      },
    ],
  };

  const flat = {
    cornerAt: () => 0,
    slack: 0,
    minHeight: 0,
    maxHeight: 0,
    hasWater: true,
  };

  it("says nothing when the buildings have been judged", () => {
    const marks = baseFootprints(scenarioPlacements(doc), units, flat);
    expect(sceneUnchecked(marks)).toBeNull();
  });

  it("says nothing about a surface with nothing on it", () => {
    expect(sceneUnchecked([])).toBeNull();
  });

  it("blames the map when its heights could not be read", () => {
    const marks = baseFootprints(scenarioPlacements(doc), units, null);
    expect(sceneUnchecked(marks)).toBe("no-ground");
  });

  it("blames the read still in flight before the units are read", () => {
    const marks = baseFootprints(scenarioPlacements(doc), [], null);
    expect(sceneUnchecked(marks)).toBe("no-units");
  });

  /** A def the game has not got is judged: it is a refusal rather than a
   *  silence, so a layout of them alongside one unread height is still a
   *  surface where the map is what nothing could be checked against. */
  it("looks past a building that has its own answer", () => {
    const marks = baseFootprints(
      scenarioPlacements(doc),
      [{ name: "armlab", footprintX: 6, footprintZ: 6, maxSlope: 10 }],
      null,
    );
    expect(sceneUnchecked(marks)).toBe("no-ground");
  });

  /** The whole point of saying it once: one building with a verdict means the
   *  check ran, and the dashed squares beside it are per building news. */
  it("says nothing once one building has been checked", () => {
    const marks = baseFootprints(scenarioPlacements(doc), units, flat);
    expect(
      sceneUnchecked([...marks, { ...marks[0], standing: "no-slope" }]),
    ).toBeNull();
  });
});

describe("overlappingIn", () => {
  const units = [
    { name: "armlab", footprintX: 6, footprintZ: 6 },
    { name: "armsolar", footprintX: 5, footprintZ: 5 },
  ];
  const doc: Registries = {
    ...empty,
    blueprints: [
      {
        id: "bp1",
        name: "The keep",
        buildings: [
          { def: "armlab", offset: { x: 0, z: 0 }, facing: 0 },
          { def: "armsolar", offset: { x: 512, z: 0 }, facing: 0 },
          { def: "armsolar", offset: { x: 32, z: 0 }, facing: 0 },
        ],
      },
    ],
    bases: [
      {
        id: "pf1",
        blueprint: "bp1",
        team: "p0",
        origin: { x: 1000, z: 1000 },
        buildings: [],
      },
    ],
  };

  it("names the buildings by their place in the base", () => {
    const placements = scenarioPlacements(doc);
    const marks = baseFootprints(placements, units);
    expect(overlappingIn(placements, marks, "pf1")).toEqual([0, 2]);
  });

  it("says nothing about a base that is not the one asked for", () => {
    const placements = scenarioPlacements(doc);
    const marks = baseFootprints(placements, units);
    expect(overlappingIn(placements, marks, "other")).toEqual([]);
  });
});

/** Issue #1459: the depth half of the engine's terrain check, named the way the
 *  slope half is so a panel can list both. */
describe("wrongDepthIn", () => {
  const units = [
    // A land building, which is what a `maxWaterDepth` of 0 means.
    { name: "armsolar", footprintX: 2, footprintZ: 2, maxSlope: 10 },
    { name: "armshipyard", footprintX: 2, footprintZ: 2, maxSlope: 10 },
  ];
  const doc: Registries = {
    ...empty,
    blueprints: [
      {
        id: "bp1",
        name: "The harbour",
        buildings: [
          { def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 },
          { def: "armshipyard", offset: { x: 256, z: 0 }, facing: 0 },
        ],
      },
    ],
    bases: [
      {
        id: "pf1",
        blueprint: "bp1",
        team: "p0",
        origin: { x: 1000, z: 1000 },
        buildings: [],
      },
    ],
  };
  /** Dry land, level and read exactly. */
  const dry = {
    cornerAt: () => 20,
    slack: 0,
    minHeight: -100,
    maxHeight: 100,
    hasWater: true,
  };

  it("names the building the water is wrong for", () => {
    const placements = scenarioPlacements(doc);
    const marks = baseFootprints(
      placements,
      [
        { ...units[0], maxWaterDepth: 0 },
        { ...units[1], minWaterDepth: 10, maxWaterDepth: 1000 },
      ],
      dry,
    );
    // The yard needs 10 elmos of water and is standing 20 above it. The solar
    // collector is exactly where it belongs.
    expect(wrongDepthIn(placements, marks, "pf1")).toEqual([1]);
    expect(unstableIn(placements, marks, "pf1")).toEqual([]);
  });

  it("says nothing about a base whose defs declare no water", () => {
    const placements = scenarioPlacements(doc);
    const marks = baseFootprints(placements, units, dry);
    expect(wrongDepthIn(placements, marks, "pf1")).toEqual([]);
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

describe("placementKey", () => {
  it("agrees with the keys scenarioPlacements writes", () => {
    expect(placementKey("actor", "a1")).toBe("actor:a1");
    expect(placementKey("group", "g1", 2)).toBe("group:g1#2");
    expect(placementKey("base", "pf1", 0)).toBe("base:pf1#0");
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
