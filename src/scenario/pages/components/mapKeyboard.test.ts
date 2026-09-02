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
import { newScenario } from "../../create";
import type { Scenario } from "../../model";
import { addBase } from "./bases";
import { sceneContents } from "./contents";
import { addActor } from "./editing";
import { addGroup } from "./groups";
import {
  facingWords,
  MAP_KEY_HELP,
  type MapThings,
  movedWords,
  moveOnMap,
  nextEntry,
  placeInList,
  pointFrom,
  positionIn,
  removeOnMap,
  selectionWords,
  thingWords,
  turnedWords,
  turnOnMap,
} from "./mapKeyboard";
import { addZone } from "./zones";

const own = () => "own" as const;

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

describe("turning and deleting", () => {
  it("turns an actor a quarter turn clockwise through the engine's facings", () => {
    const doc = laidOut();
    const after = turnOnMap(doc, "actor:a1", 1, own);

    expect(after.actors[0].facing).toBe(1);
    expect(turnedWords(things(after), "actor:a1")).toBe("Facing east.");
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

    expect(movedWords(things(after), "actor:a1", "east", 16)).toBe(
      "Moved 16 east, now at x 116, z 200.",
    );
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
