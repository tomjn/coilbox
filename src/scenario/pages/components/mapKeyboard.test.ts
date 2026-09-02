/**
 * What the map's keys do to the document, and what they say about it (issue
 * #2269).
 *
 * The sentences are tested beside the edits on purpose. An author who cannot see
 * the 3D view has nothing but the speech, so a sentence that has drifted from
 * the edit is not a cosmetic fault: it is the interface reporting a move that did
 * not happen.
 */

import { describe, expect, it } from "vitest";
import {
  type FootprintMark,
  footprintMarks,
  ONE_SQUARE,
  type Standing,
} from "@/blueprint/footprint";
import { newScenario } from "../../create";
import type { Scenario } from "../../model";
import { addBase } from "./bases";
import { sceneContents } from "./contents";
import { addActor } from "./editing";
import { addGroup, pathKey } from "./groups";
import {
  buildTrouble,
  facingWords,
  MAP_KEY_HELP,
  type MapThings,
  mapProblemsWords,
  mapSteps,
  movedWords,
  moveOnMap,
  nextEntry,
  nextStep,
  placeInList,
  pointFrom,
  positionIn,
  removeOnMap,
  resizedWords,
  resizeLimitWords,
  resizeModeWords,
  resizeOnMap,
  selectionWords,
  thingWords,
  turnedWords,
  turnOnMap,
} from "./mapKeyboard";
import type { PathSource } from "./orderPaths";
import { addZone, MIN_ZONE_ELMOS } from "./zones";

const own = () => "own" as const;

/** A single-building footprint mark with the verdict a test wants, built the
 *  way `baseFootprints` builds a real one rather than hand-assembled, so a
 *  test never drifts from the shape the real marks have. */
function markFor(
  key: string,
  standing: Standing,
  overlapping = false,
): FootprintMark {
  const [mark] = footprintMarks(
    [{ key, def: "armsolar", pos: { x: 0, z: 0 }, facing: 0 }],
    () => ONE_SQUARE,
    () => standing,
  );
  return { ...mark, overlapping };
}

/** A mission with one of each thing the map can hold, so the cycle has
 *  something to walk and every branch has something to name. */
function laidOut(): Scenario {
  let doc = newScenario("Keys");
  doc = addActor(doc, "a1", {
    unitDef: "armcom",
    team: "player",
    pos: { x: 100, z: 200 },
    facing: 0,
  });
  doc = addGroup(doc, "g1", {
    team: "enemy",
    units: [{ def: "armpw", count: 3 }],
    pos: { x: 500, z: 600 },
    orders: [],
    dormant: false,
  });
  doc = addBase(doc, "b1", "bp1", {
    team: "enemy",
    origin: { x: 1000, z: 1000 },
    buildings: [
      { id: "u1", def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 },
      { id: "u2", def: "armlab", offset: { x: 64, z: 0 }, facing: 1 },
    ],
  });
  doc = addZone(doc, {
    id: "z1",
    name: "Landing site",
    shape: "circle",
    center: { x: 2000, z: 2000 },
    radius: 300,
  });
  return doc;
}

/** `laidOut`, with the group given a two-point move order, and the
 *  `PathSource` that describes it, for the tests that reach a path's points
 *  from the keyboard (issue #2314). */
function withGroupPath(): { doc: Scenario; paths: PathSource[] } {
  const doc = laidOut();
  const withOrders: Scenario = {
    ...doc,
    groups: [
      {
        ...doc.groups[0],
        orders: [
          {
            kind: "move",
            waypoints: [
              { x: 550, z: 600 },
              { x: 700, z: 650 },
            ],
          },
        ],
      },
    ],
  };
  return {
    doc: withOrders,
    paths: [
      { id: "g1", label: "Group 1", orders: withOrders.groups[0].orders },
    ],
  };
}

/** The document as the keys read it. The drawn units only ever name things
 *  here, so a plain list of what the document holds is enough. */
function things(scenario: Scenario): MapThings {
  return {
    scenario,
    entries: sceneContents(scenario),
    placements: [
      {
        key: "actor:a1",
        kind: "actor",
        id: "a1",
        index: 0,
        def: "armcom",
        team: "player",
        pos: { x: 100, z: 200 },
        facing: 0,
      },
      {
        key: "group:g1#0",
        kind: "group",
        id: "g1",
        index: 0,
        def: "armpw",
        team: "enemy",
        pos: { x: 500, z: 600 },
        facing: 0,
      },
      {
        key: "base:b1#1",
        kind: "base",
        id: "b1",
        index: 1,
        def: "armlab",
        team: "enemy",
        pos: { x: 1064, z: 1000 },
        facing: 1,
      },
    ],
    paths: [],
  };
}

describe("moving what a key names", () => {
  it("moves an actor by the delta, in whole elmos", () => {
    const doc = laidOut();
    const after = moveOnMap(doc, "actor:a1", { x: 16, z: -16 }, undefined, own);

    expect(positionIn(things(after), "actor:a1")).toEqual({ x: 116, z: 184 });
  });

  it("moves the whole group when one of its units is named, because a group is one point", () => {
    const doc = laidOut();
    const after = moveOnMap(
      doc,
      "group:g1#2",
      { x: 0, z: 160 },
      undefined,
      own,
    );

    expect(after.groups[0].pos).toEqual({ x: 500, z: 760 });
  });

  it("moves one of a base's buildings and leaves the rest of the base alone", () => {
    const doc = laidOut();
    const after = moveOnMap(doc, "base:b1#1", { x: 16, z: 0 }, undefined, own);

    expect(positionIn(things(after), "base:b1#0")).toEqual({
      x: 1000,
      z: 1000,
    });
    expect(positionIn(things(after), "base:b1#1")).toEqual({
      x: 1080,
      z: 1000,
    });
  });

  it("moves a zone", () => {
    const doc = laidOut();
    const after = moveOnMap(doc, "zone:z1", { x: -100, z: 0 }, undefined, own);

    expect(positionIn(things(after), "zone:z1")).toEqual({ x: 1900, z: 2000 });
  });

  it("hands the same document back when the key names nothing", () => {
    const doc = laidOut();

    expect(moveOnMap(doc, "actor:gone", { x: 16, z: 0 }, undefined, own)).toBe(
      doc,
    );
  });
});

describe("resizing a zone (issue #2313)", () => {
  it("grows a circle's radius on north or east", () => {
    const doc = laidOut();
    expect(resizeOnMap(doc, "zone:z1", "north", 50).zones[0]).toMatchObject({
      radius: 350,
    });
    expect(resizeOnMap(doc, "zone:z1", "east", 50).zones[0]).toMatchObject({
      radius: 350,
    });
  });

  it("shrinks it on south or west", () => {
    const doc = laidOut();
    expect(resizeOnMap(doc, "zone:z1", "south", 50).zones[0]).toMatchObject({
      radius: 250,
    });
  });

  it("says what changed, the size read back from the document", () => {
    const doc = laidOut();
    const after = resizeOnMap(doc, "zone:z1", "north", 50);

    expect(resizedWords(things(after), "zone:z1", "north", 50)).toBe(
      "Grew 50, now radius 350 elmos.",
    );
  });

  it("says shrank on south or west", () => {
    const doc = laidOut();
    const after = resizeOnMap(doc, "zone:z1", "south", 50);

    expect(resizedWords(things(after), "zone:z1", "south", 50)).toBe(
      "Shrank 50, now radius 250 elmos.",
    );
  });

  it("says nothing resized when the key names no zone still on the map", () => {
    expect(resizedWords(things(laidOut()), "zone:gone", "north", 50)).toBe(
      "Nothing resized.",
    );
    expect(resizedWords(things(laidOut()), "actor:a1", "north", 50)).toBe(
      "Nothing resized.",
    );
  });

  it("holds a shrink to the minimum and says so rather than lying about a change", () => {
    const atFloor: Scenario = {
      ...laidOut(),
      zones: [
        {
          id: "z1",
          name: "Landing site",
          shape: "circle",
          center: { x: 2000, z: 2000 },
          radius: MIN_ZONE_ELMOS,
        },
      ],
    };

    expect(resizeOnMap(atFloor, "zone:z1", "south", 50)).toBe(atFloor);
    expect(resizeLimitWords(things(atFloor), "zone:z1")).toBe(
      `Already as small as a zone gets, radius ${MIN_ZONE_ELMOS} elmos.`,
    );
  });
});

describe("switching resize mode on and off", () => {
  it("announces the current size when switched on", () => {
    expect(resizeModeWords(things(laidOut()), "zone:z1", true)).toBe(
      "Resize mode, radius 300 elmos. Arrows change its size instead of its position: " +
        "north and east make it bigger, south and west make it smaller. Press S again for move.",
    );
  });

  it("announces plainly when switched off", () => {
    expect(resizeModeWords(things(laidOut()), "zone:z1", false)).toBe(
      "Move mode. Arrows move it again.",
    );
  });

  it("says nothing selected when the zone named is gone", () => {
    expect(resizeModeWords(things(laidOut()), "zone:gone", true)).toBe(
      "Nothing selected.",
    );
  });
});

describe("turning and deleting", () => {
  it("turns an actor a quarter turn clockwise through the engine's facings", () => {
    const doc = laidOut();
    const after = turnOnMap(doc, "actor:a1", 1, own);

    expect(after.actors[0].facing).toBe(1);
    expect(turnedWords(things(after), "actor:a1", [])).toBe("Facing east.");
  });

  it("turns back on a negative step", () => {
    const doc = laidOut();

    expect(turnOnMap(doc, "actor:a1", -1, own).actors[0].facing).toBe(3);
  });

  it("leaves a group alone, because its units all face south", () => {
    const doc = laidOut();

    expect(turnOnMap(doc, "group:g1#0", 1, own)).toBe(doc);
  });

  it("deletes an actor, a base's building and a zone", () => {
    const doc = laidOut();

    expect(removeOnMap(doc, "actor:a1", own).actors).toHaveLength(0);
    expect(removeOnMap(doc, "zone:z1", own).zones).toHaveLength(0);
    expect(
      removeOnMap(doc, "base:b1#1", own).blueprints[0].buildings,
    ).toHaveLength(1);
  });

  it("takes one unit off a group's count rather than the whole group", () => {
    const doc = laidOut();

    expect(removeOnMap(doc, "group:g1#0", own).groups[0].units[0].count).toBe(
      2,
    );
  });
});

describe("stepping through the contents", () => {
  it("starts at the first thing when nothing is selected", () => {
    const entries = sceneContents(laidOut());

    expect(nextEntry(entries, null, 1)?.kind).toBe("actor");
  });

  it("starts at the last thing going backwards", () => {
    const entries = sceneContents(laidOut());

    expect(nextEntry(entries, null, -1)?.kind).toBe("zone");
  });

  it("walks actors, groups, bases and zones in that order and wraps round", () => {
    const entries = sceneContents(laidOut());
    const kinds: string[] = [];
    let at = nextEntry(entries, null, 1);
    for (let i = 0; i < 5; i++) {
      if (!at) break;
      kinds.push(at.kind);
      at = nextEntry(entries, at.key, 1);
    }

    expect(kinds).toEqual(["actor", "group", "base", "zone", "actor"]);
  });

  it("steps on from the entry a base's third building belongs to, not to its fourth", () => {
    const entries = sceneContents(laidOut());

    expect(nextEntry(entries, "base:b1#1", 1)?.kind).toBe("zone");
  });

  it("has nothing to step to on an empty map", () => {
    expect(nextEntry([], null, 1)).toBeNull();
  });

  it("says how far through the list the selection is", () => {
    const entries = sceneContents(laidOut());

    expect(placeInList(entries, "group:g1#0")).toBe(" 2 of 4.");
  });
});

describe("weaving a path's points into the ring (issue #2314)", () => {
  it("puts a group's points right after the group", () => {
    const { doc, paths } = withGroupPath();
    const entries = sceneContents(doc);

    expect(mapSteps(entries, paths).map((step) => step.key)).toEqual([
      "actor:a1",
      "group:g1#0",
      pathKey("g1", 0, 0),
      pathKey("g1", 0, 1),
      "base:b1#0",
      "zone:z1",
    ]);
  });

  it("carries a trigger's held orders after everything else, since they own no entry of their own", () => {
    const doc = laidOut();
    const entries = sceneContents(doc);
    const held: PathSource = {
      id: "step:0:actions:0:orders",
      label: "A trigger",
      orders: [{ kind: "move", waypoints: [{ x: 10, z: 10 }] }],
    };

    const steps = mapSteps(entries, [held]);

    expect(steps.at(-1)?.key).toBe(pathKey(held.id, 0, 0));
    expect(steps).toHaveLength(entries.length + 1);
  });

  it("steps from a selected group onto its first point, then its next, then off it", () => {
    const { doc, paths } = withGroupPath();
    const entries = sceneContents(doc);
    const steps = mapSteps(entries, paths);

    const first = nextStep(steps, entries, "group:g1#0", 1);
    expect(first?.key).toBe(pathKey("g1", 0, 0));

    const second = nextStep(steps, entries, first?.key ?? null, 1);
    expect(second?.key).toBe(pathKey("g1", 0, 1));

    const after = nextStep(steps, entries, second?.key ?? null, 1);
    expect(after?.key).toBe("base:b1#0");
  });

  it("steps backwards from a path's first point onto the group it belongs to", () => {
    const { doc, paths } = withGroupPath();
    const entries = sceneContents(doc);
    const steps = mapSteps(entries, paths);

    expect(nextStep(steps, entries, pathKey("g1", 0, 0), -1)?.key).toBe(
      "group:g1#0",
    );
  });

  it("still finds a base's third building's neighbour once paths are woven in, the same rule nextEntry follows", () => {
    const entries = sceneContents(laidOut());
    const steps = mapSteps(entries, []);

    expect(nextStep(steps, entries, "base:b1#1", 1)?.key).toBe("zone:z1");
  });

  it("has nothing to step to on an empty map", () => {
    expect(nextStep([], [], null, 1)).toBeNull();
  });
});

describe("what is said", () => {
  it("names a placement by its entry, its place inside it and its unit", () => {
    const doc = laidOut();

    expect(thingWords(things(doc), "base:b1#1")).toContain(
      "building 2, armlab",
    );
  });

  it("says what is selected, which way it faces and where it stands", () => {
    const doc = laidOut();

    expect(selectionWords(things(doc), "actor:a1")).toBe(
      "actor, armcom, facing south, at x 100, z 200.",
    );
  });

  // An actor with no display name is listed under its own unit type, so the
  // entry's name and the def are the same string.
  it("does not say an unnamed actor's unit type twice", () => {
    const doc = laidOut();

    expect(thingWords(things(doc), "actor:a1")).toBe("actor, armcom");
  });

  it("names one of a group's units by the group as well as by the unit", () => {
    const doc = laidOut();

    expect(thingWords(things(doc), "group:g1#0")).toBe(
      "Group 1, unit 1, armpw",
    );
  });

  it("names a path's point by which one of how many, and where it stands (issue #2314)", () => {
    const { doc, paths } = withGroupPath();
    const withPath: MapThings = { ...things(doc), paths };

    expect(selectionWords(withPath, pathKey("g1", 0, 1))).toBe(
      "Group 1, point 2 of 2, at x 700, z 650.",
    );
  });

  it("names a zone by the name a trigger points at it by", () => {
    const doc = laidOut();

    expect(selectionWords(things(doc), "zone:z1")).toBe(
      "zone Landing site, at x 2000, z 2000.",
    );
  });

  it("says nothing is selected when nothing is", () => {
    expect(selectionWords(things(laidOut()), null)).toBe("Nothing selected.");
  });

  it("reports the position the document ended up with rather than the one asked for", () => {
    const doc = laidOut();
    const after = moveOnMap(doc, "actor:a1", { x: 16, z: 0 }, undefined, own);

    expect(movedWords(things(after), "actor:a1", "east", 16, [])).toBe(
      "Moved 16 east, now at x 116, z 200.",
    );
  });

  describe("whether the thing that moved can be built where it stands (issue #2315)", () => {
    it("says nothing extra when the mark is fine", () => {
      const doc = laidOut();
      const after = moveOnMap(
        doc,
        "base:b1#0",
        { x: 16, z: 0 },
        undefined,
        own,
      );
      const marks = [markFor("base:b1#0", "fine")];

      expect(movedWords(things(after), "base:b1#0", "east", 16, marks)).toBe(
        "Moved 16 east, now at x 1016, z 1000.",
      );
    });

    it("names an overlap, in the colour its square is drawn", () => {
      const doc = laidOut();
      const after = moveOnMap(
        doc,
        "base:b1#0",
        { x: 16, z: 0 },
        undefined,
        own,
      );
      const marks = [markFor("base:b1#0", "fine", true)];

      expect(movedWords(things(after), "base:b1#0", "east", 16, marks)).toBe(
        "Moved 16 east, now at x 1016, z 1000. Cannot be built here: overlapping another building, in red.",
      );
    });

    it("names ground too steep", () => {
      const marks = [markFor("base:b1#0", "slope")];

      expect(turnedWords(things(laidOut()), "base:b1#0", marks)).toBe(
        "Facing south. Cannot be built here: on ground too steep for it, in amber.",
      );
    });

    it("names water too deep and water not deep enough, both in cyan", () => {
      expect(
        buildTrouble([markFor("base:b1#0", "too-deep")], "base:b1#0"),
      ).toBe(" Cannot be built here: in water too deep for it, in cyan.");
      expect(
        buildTrouble([markFor("base:b1#0", "too-shallow")], "base:b1#0"),
      ).toBe(" Cannot be built here: not in deep enough water, in cyan.");
    });

    it("names both an overlap and a slope when a mark carries both", () => {
      const marks = [markFor("base:b1#0", "slope", true)];

      expect(buildTrouble(marks, "base:b1#0")).toBe(
        " Cannot be built here: overlapping another building, in red, on ground too steep for it, in amber.",
      );
    });

    it("stays silent for a mark nothing has judged yet, so an unread map is not noise on every press", () => {
      expect(
        buildTrouble([markFor("base:b1#0", "no-ground")], "base:b1#0"),
      ).toBe("");
      expect(
        buildTrouble([markFor("base:b1#0", "no-slope")], "base:b1#0"),
      ).toBe("");
    });

    it("stays silent for anything with no footprint: an actor, a group, a zone", () => {
      expect(buildTrouble([], "actor:a1")).toBe("");
      expect(buildTrouble([], "zone:z1")).toBe("");
    });
  });

  it("uses the engine's own facing order", () => {
    expect([0, 1, 2, 3].map((f) => facingWords(f as 0 | 1 | 2 | 3))).toEqual([
      "south",
      "east",
      "north",
      "west",
    ]);
  });

  it("names every key an author has to know", () => {
    for (const key of [
      "Full stop",
      "Arrow keys",
      "Shift",
      "Alt",
      "R",
      "Delete",
      "Enter",
      "Escape",
    ])
      expect(MAP_KEY_HELP).toContain(key);
  });

  it("names the resize key too (issue #2313)", () => {
    expect(MAP_KEY_HELP).toContain("S toggles resize");
  });

  it("says a path's points are on the ring too (issue #2314)", () => {
    expect(MAP_KEY_HELP).toContain("a path's points");
  });

  it("names the problems key too (issue #2315)", () => {
    expect(MAP_KEY_HELP).toContain("P reads how many");
  });
});

describe("what is wrong with the whole map, on demand (issue #2315)", () => {
  it("says nothing is built yet on an empty map", () => {
    expect(mapProblemsWords([])).toBe("Nothing built yet.");
  });

  it("says every building has room when nothing is in trouble", () => {
    const marks = [markFor("base:b1#0", "fine"), markFor("base:b1#1", "fine")];

    expect(mapProblemsWords(marks)).toBe(
      "2 buildings, and every one of them can be built where it stands.",
    );
  });

  it("says one building has room, singular", () => {
    expect(mapProblemsWords([markFor("base:b1#0", "fine")])).toBe(
      "1 building, and it can be built where it stands.",
    );
  });

  it("tallies overlaps, slopes and both kinds of water problem across the map", () => {
    const marks = [
      markFor("base:b1#0", "fine", true),
      markFor("base:b1#1", "slope"),
      markFor("base:b2#0", "too-deep"),
      markFor("base:b2#1", "too-shallow"),
      markFor("base:b3#0", "fine"),
    ];

    expect(mapProblemsWords(marks)).toBe(
      "4 of 5 cannot be built where they stand: 1 overlapping another building, " +
        "1 on ground too steep for it, 1 in water too deep for it, " +
        "1 without enough water under it.",
    );
  });

  it("drops the 'of N' when everything on the map is in trouble", () => {
    const marks = [markFor("base:b1#0", "slope")];

    expect(mapProblemsWords(marks)).toBe(
      "1 cannot be built where it stands: 1 on ground too steep for it.",
    );
  });

  it("adds what the ground has not judged rather than staying silent about it", () => {
    const marks = [
      markFor("base:b1#0", "no-ground"),
      markFor("base:b1#1", "fine"),
    ];

    expect(mapProblemsWords(marks)).toBe(
      "2 buildings, and every one of them can be built where it stands. " +
        "1 of them has not been checked against the ground.",
    );
  });
});

describe("answering a point by typing it", () => {
  it("takes two numbers as a point on the map", () => {
    expect(pointFrom("1024", "2048", 8192, 8192)).toEqual({
      x: 1024,
      z: 2048,
    });
  });

  it("rounds to whole elmos, which is what a scenario stores", () => {
    expect(pointFrom("1024.6", "2047.4", 8192, 8192)).toEqual({
      x: 1025,
      z: 2047,
    });
  });

  it("refuses a point off the map, which is a point no mission can use", () => {
    expect(pointFrom("9000", "100", 8192, 8192)).toBeNull();
    expect(pointFrom("100", "-1", 8192, 8192)).toBeNull();
  });

  it("refuses a half-filled or unreadable pair", () => {
    expect(pointFrom("", "100", 8192, 8192)).toBeNull();
    expect(pointFrom("100", "  ", 8192, 8192)).toBeNull();
    expect(pointFrom("over there", "100", 8192, 8192)).toBeNull();
  });
});
