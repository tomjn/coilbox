import { describe, expect, it } from "vitest";

import type { Ground } from "@/blueprint/buildable";
import {
  BUILD_SQUARE,
  footprintRect,
  snapToBuildGrid,
} from "@/blueprint/footprint";
import type { Placement } from "./placements";
import {
  draggedBuilding,
  layoutPreview,
  previewChecks,
  previewCount,
  previewSentence,
  previewTrouble,
  sameCount,
  samePlace,
  withoutBuilding,
} from "./preview";

/** Balanced Annihilation's own numbers, so the shapes below really exist. */
const units = [
  { name: "armsolar", footprintX: 5, footprintZ: 5, maxSlope: 20 },
  { name: "armlab", footprintX: 6, footprintZ: 6, maxSlope: 15 },
  { name: "armmex", footprintX: 3, footprintZ: 3, maxSlope: 40 },
];

/** Ground at one height everywhere, which every building stands on. */
const flat: Ground = {
  cornerAt: () => 100,
  slack: 0,
  minHeight: 0,
  maxHeight: 500,
};

/** A cliff along x: everything east of 400 elmos is 200 elmos higher. */
const cliff: Ground = {
  cornerAt: (x) => (x * 8 >= 400 ? 300 : 100),
  slack: 0,
  minHeight: 0,
  maxHeight: 500,
};

const solarAt = (x: number, z: number) => ({
  def: "armsolar",
  pos: { x, z },
  facing: 0 as const,
});

describe("layoutPreview", () => {
  it("stands each building where the engine would, not where it was asked", () => {
    const { footprintOf } = previewChecks(units, null);
    // A five square footprint centres in the middle of a build square, so a
    // point part way across one is pulled to that middle.
    const marks = layoutPreview([solarAt(100, 100)], footprintOf, []);
    expect(marks).toHaveLength(1);
    expect(marks[0].pos).toEqual({ x: 104, z: 104 });
    expect(marks[0].footprint).toEqual({ x: 5, z: 5 });
  });

  it("marks a building wanting ground something already standing wants", () => {
    const { footprintOf } = previewChecks(units, null);
    const standing = [
      { rect: footprintRect({ x: 104, z: 104 }, { x: 5, z: 5 }, 0) },
    ];
    const marks = layoutPreview(
      [solarAt(100, 100), solarAt(100 + 6 * BUILD_SQUARE, 100)],
      footprintOf,
      standing,
    );
    expect(marks[0].overlapping).toBe(true);
    expect(marks[1].overlapping).toBe(false);
  });

  it("marks two of its own buildings fighting over one piece of ground", () => {
    const { footprintOf } = previewChecks(units, null);
    const marks = layoutPreview(
      [solarAt(100, 100), solarAt(116, 100)],
      footprintOf,
      [],
    );
    expect(marks.map((mark) => mark.overlapping)).toEqual([true, true]);
  });

  it("says which nothing it has about the ground with no map to ask", () => {
    const { footprintOf, standingOf } = previewChecks(units, null);
    const marks = layoutPreview(
      [solarAt(100, 100)],
      footprintOf,
      [],
      standingOf,
    );
    expect(marks[0].standing).toBe("no-ground");
  });

  it("passes a building on flat ground and refuses one on a cliff", () => {
    const level = previewChecks(units, flat);
    const step = previewChecks(units, cliff);
    const at = solarAt(400, 100);
    expect(
      layoutPreview([at], level.footprintOf, [], level.standingOf)[0].standing,
    ).toBe("fine");
    expect(
      layoutPreview([at], step.footprintOf, [], step.standingOf)[0].standing,
    ).toBe("slope");
  });

  it("counts what is wrong and says it in words", () => {
    const { footprintOf } = previewChecks(units, null);
    const standing = [
      { rect: footprintRect({ x: 104, z: 104 }, { x: 5, z: 5 }, 0) },
    ];
    const clear = previewCount(
      layoutPreview([solarAt(1000, 1000)], footprintOf, standing),
    );
    expect(clear).toEqual({
      total: 1,
      clashes: 0,
      unstable: 0,
      unjudged: 1,
      absent: 0,
    });
    // Nothing asked about the ground here, so having room is all it may claim.
    expect(previewSentence(clear)).toBe(
      "1 building, and it has room here. It has not been checked against the ground.",
    );
    expect(previewTrouble(clear)).toBe(false);

    const fighting = previewCount(
      layoutPreview(
        [solarAt(100, 100), solarAt(1000, 1000)],
        footprintOf,
        standing,
      ),
    );
    expect(fighting.clashes).toBe(1);
    expect(previewSentence(fighting)).toBe(
      "1 of 2 wants ground another building has, in red. None of them has been checked against the ground.",
    );
    expect(previewTrouble(fighting)).toBe(true);
  });

  it("says both reasons the engine would refuse a building", () => {
    const both = { total: 12, clashes: 3, unstable: 2, unjudged: 0, absent: 0 };
    expect(previewSentence(both)).toBe(
      "3 of 12 want ground another building has, in red. 2 are on ground too steep for them, in amber.",
    );
    expect(
      previewSentence({
        total: 12,
        clashes: 0,
        unstable: 1,
        unjudged: 0,
        absent: 0,
      }),
    ).toBe("1 of 12 is on ground too steep for it, in amber.");
  });

  /**
   * Issue #1445. A layout carrying a unit this game has not got is worth saying
   * before the click as much as after it, because the click is the moment
   * somebody is choosing where to put somebody else's base.
   */
  it("counts the units this game has not got, and calls it trouble", () => {
    const some = {
      total: 12,
      clashes: 0,
      unstable: 0,
      unjudged: 0,
      absent: 2,
    };
    expect(previewSentence(some)).toBe(
      "2 of 12 are units this game has not got, in violet.",
    );
    expect(previewTrouble(some)).toBe(true);
  });

  /**
   * Issue #1491. A preview that says twelve buildings all have room, when three
   * of them were never checked against the ground, is the same false assurance
   * the map was giving. Said as a plain fact rather than in amber, because an
   * unknown is not a refusal.
   */
  it("says how many of them nothing judged", () => {
    expect(
      previewSentence({
        total: 12,
        clashes: 0,
        unstable: 0,
        unjudged: 3,
        absent: 0,
      }),
    ).toBe(
      "12 buildings, and they all have room here. 3 of them have not been checked against the ground.",
    );
    expect(
      previewTrouble({
        total: 12,
        clashes: 0,
        unstable: 0,
        unjudged: 3,
        absent: 0,
      }),
    ).toBe(false);
  });

  it("knows a frame that would draw the layout where it already is", () => {
    // What keeps a pointer move cheap: the origin is snapped, so most of the
    // pointer's travel lands the layout on the squares it is already on.
    const at = (x: number) =>
      [0, 96].map((offset) => ({
        def: "armsolar",
        pos: snapToBuildGrid({ x: x + offset, z: 100 }, { x: 5, z: 5 }, 0),
        facing: 0 as const,
      }));
    const near = at(100);
    const same = at(107);
    const along = at(140);
    expect(samePlace(near, same)).toBe(true);
    expect(samePlace(near, along)).toBe(false);
    expect(samePlace(near, near.slice(1))).toBe(false);
  });

  it("leaves a surface alone while the same thing is true", () => {
    const one = { total: 12, clashes: 1, unstable: 0, unjudged: 0, absent: 0 };
    expect(sameCount(one, { ...one })).toBe(true);
    expect(sameCount(one, { ...one, clashes: 2 })).toBe(false);
    // The moment the game's units arrive, the same layout stops being unjudged
    // and the sentence has to be redrawn.
    expect(sameCount(one, { ...one, unjudged: 12 })).toBe(false);
    expect(sameCount(one, null)).toBe(false);
    expect(sameCount(null, null)).toBe(true);
  });

  it("is cheap enough to run on every pointer move (issue #1464)", () => {
    // Thirty buildings against a map already holding two hundred, which is a
    // bigger mission than anybody builds, run the number of times a pointer
    // crosses build squares in a second of dragging across the map.
    const { footprintOf, standingOf } = previewChecks(units, flat);
    const layout = Array.from({ length: 30 }, (_, at) =>
      solarAt(1000 + at * 6 * BUILD_SQUARE, 1000),
    );
    const standing = Array.from({ length: 200 }, (_, at) => ({
      rect: footprintRect(
        { x: 200 + (at % 20) * 96, z: 200 + Math.floor(at / 20) * 96 },
        { x: 5, z: 5 },
        0,
      ),
    }));
    const started = performance.now();
    for (let pass = 0; pass < 120; pass++) {
      layoutPreview(layout, footprintOf, standing, standingOf);
    }
    const each = (performance.now() - started) / 120;
    expect(each).toBeLessThan(2);
  });
});

/**
 * Issue #1512. A building being dragged is a layout of one under the pointer,
 * so it is the same preview with the same marks, asked about one of the
 * document's own buildings instead of about one it has not got yet.
 */
describe("draggedBuilding", () => {
  const building = (over: Partial<Placement> = {}): Placement => ({
    key: "base:pf1#0",
    kind: "base",
    id: "pf1",
    index: 0,
    def: "armsolar",
    team: "p0",
    pos: { x: 504, z: 600 },
    facing: 0,
    ...over,
  });

  it("carries the building the drag picked up, as far as the drag has got", () => {
    const at = draggedBuilding([building()], "base:pf1#0", { x: 96, z: -32 });
    expect(at).toEqual({
      def: "armsolar",
      facing: 0,
      pos: { x: 600, z: 568 },
    });
  });

  /**
   * Issue #1517. What the author took hold of is the building on the map, which
   * stands on the square the grid drew rather than on the point its layout
   * names. The drop carries it from the same point, so a drag that has gone
   * nowhere shows the building where it already is.
   */
  it("shifts the square the grid drew, which is the building on the map", () => {
    const drawn = building({ pos: { x: 504, z: 600 } });
    const held = draggedBuilding([drawn], "base:pf1#0", { x: 0, z: 0 });
    expect(held?.pos).toEqual({ x: 504, z: 600 });
  });

  it("carries nothing for anything that has no footprint", () => {
    const mobile = building({ key: "actor:a1", kind: "actor", id: "a1" });
    const nowhere = { x: 0, z: 0 };
    expect(draggedBuilding([mobile], "actor:a1", nowhere)).toBe(null);
    expect(draggedBuilding([building()], "zone:z1", nowhere)).toBe(null);
  });
});

describe("withoutBuilding", () => {
  const mark = (key: string) =>
    layoutPreview(
      [solarAt(100, 100)],
      previewChecks(units, null).footprintOf,
      [],
    ).map((one) => ({ ...one, key }))[0];

  /** The building being dragged is drawn where it is going rather than where it
   *  came from, so the ground it came from is nobody's while the drag lasts. */
  it("drops the ground the building being dragged came from", () => {
    const marks = [mark("base:pf1#0"), mark("base:pf1#1")];
    expect(withoutBuilding(marks, "base:pf1#0").map((one) => one.key)).toEqual([
      "base:pf1#1",
    ]);
  });

  it("hands back the same list when nothing is being dragged", () => {
    const marks = [mark("base:pf1#0")];
    expect(withoutBuilding(marks, null)).toBe(marks);
  });
});
