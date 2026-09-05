import { describe, expect, it } from "vitest";

import type { Ground } from "@/blueprint/buildable";
import {
  BUILD_SQUARE,
  buildGridSnap,
  buildingFootprints,
} from "@/blueprint/footprint";
import type { BlueprintBuilding } from "@/blueprint/model";
import { layoutOrigin } from "@/lib/scenarioEditing/layoutPlacing";
import {
  checkMapFor,
  checkSpot,
  spotLayout,
  spotNudge,
  spotSentence,
} from "./mapCheck";
import { layoutPreview, nudgedPreview, previewChecks } from "./preview";

describe("checkMapFor", () => {
  const installed = [
    { name: "Red River Remake v1.2" },
    { name: "Bismuth Valley 1.4" },
  ];

  /** The layout already records the map it was drawn on, which is the one an
   *  author most likely wants to see it on again. */
  it("offers the map the layout was drawn on", () => {
    expect(checkMapFor("Bismuth Valley 1.4", installed)).toBe(
      "Bismuth Valley 1.4",
    );
  });

  /** A layout from somebody else names a map this machine may not have, and
   *  loading a map that is not there is the slowest way to say so. */
  it("offers nothing when that map is not installed", () => {
    expect(checkMapFor("Comet Catcher Remake", installed)).toBe("");
  });

  it("offers nothing for a layout that names no map", () => {
    expect(checkMapFor(undefined, installed)).toBe("");
    expect(checkMapFor("", installed)).toBe("");
  });

  /** Nothing is chosen for an author before the scan has answered, or the
   *  first thing they see is a map being read that they never picked. */
  it("offers nothing while the maps are still being scanned", () => {
    expect(checkMapFor("Bismuth Valley 1.4", [])).toBe("");
  });
});

describe("checkSpot", () => {
  // armsolar is 5x5, so it centres in the middle of a build square. armlab is
  // 6x6, so it centres on the line between two, which is the half square of
  // phase that makes a mixed layout worth testing (issue #1575).
  const gridUnits = [
    { name: "armsolar", footprintX: 5, footprintZ: 5 },
    { name: "armlab", footprintX: 6, footprintZ: 6 },
  ];
  const snap = buildGridSnap(gridUnits);

  /**
   * A layout of one odd footprint and one even one, whose offsets are not a
   * whole number of build squares apart.
   *
   * A shape drawn in the editor is not the only shape that reaches here. A
   * layout out of somebody else's scenario carries whatever offsets that base's
   * origin gave it, and an import read before the game's units arrived was
   * never snapped at all. Those are the layouts a raw point can pull apart.
   */
  const mixed: BlueprintBuilding[] = [
    { def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 },
    { def: "armlab", offset: { x: 84, z: 4 }, facing: 0 },
  ];

  /** Where each of the layout's buildings stands relative to its first, which
   *  is the shape the check is reporting on. */
  const shapeAt = (x: number) => {
    const origin = checkSpot({ x, z: 1000 }, 4096, 4096, mixed, snap);
    const [first, ...rest] = layoutPreview(
      spotLayout(mixed, origin),
      buildingFootprints(gridUnits),
      [],
    );
    return rest.map((mark) => ({
      x: mark.pos.x - first.pos.x,
      z: mark.pos.z - first.pos.z,
    }));
  };

  /** A layout arrives in the middle of the map, which is the one spot on every
   *  map that is on it. */
  it("puts a layout nobody has placed in the middle", () => {
    expect(checkSpot(null, 4096, 8192, [], undefined)).toEqual({
      x: 2048,
      z: 4096,
    });
  });

  it("keeps the spot an author picked", () => {
    expect(checkSpot({ x: 100, z: 200 }, 4096, 4096, [], undefined)).toEqual({
      x: 100,
      z: 200,
    });
  });

  /** A drag carries the layout by whatever the pointer did, which can be off
   *  the map. The engine clamps anything standing past the edge onto it, so the
   *  check would be answering about ground the layout is not on. */
  it("holds the spot on the map", () => {
    expect(checkSpot({ x: -400, z: 9000 }, 4096, 4096, [], undefined)).toEqual({
      x: 0,
      z: 4096,
    });
  });

  /** Before the map's extent has been read there is no middle to arrive at, and
   *  a spot of nothing is as good an answer as any. */
  it("answers nothing about a map with no extent yet", () => {
    expect(checkSpot(null, 0, 0, [], undefined)).toEqual({ x: 0, z: 0 });
  });

  /** Issue #1575. The whole of the fix: one route from a pointer to an origin,
   *  and it is the one the scenario editor places a base through. */
  it("stands the layout where the scenario editor would stand it", () => {
    expect(checkSpot({ x: 1003, z: 2005 }, 4096, 4096, mixed, snap)).toEqual(
      layoutOrigin({ x: 1003, z: 2005 }, mixed, snap),
    );
  });

  /**
   * Issue #1575. Every building is snapped on its own afterwards, so standing a
   * layout on the raw point leaves which lattice each one lands on to where the
   * pointer happened to fall. Move it a few elmos and one building jumps a whole
   * square away from its neighbour, and the check reports on a base the author
   * never drew.
   */
  it("stands a mixed-footprint layout in one shape wherever it is put", () => {
    const shapes = [1000, 1004, 1010, 1015].map(shapeAt);
    for (const shape of shapes) expect(shape).toEqual(shapes[0]);
  });

  /** Without a footprint there is no phase to work out, and a guess of one
   *  square would stand every even-footprint layout on the wrong half of the
   *  grid. So the spot is left where it is until the units are read. */
  it("leaves the spot alone while the game's units are unread", () => {
    expect(
      checkSpot({ x: 1003, z: 2005 }, 4096, 4096, mixed, undefined),
    ).toEqual({ x: 1003, z: 2005 });
  });
});

describe("spotSentence", () => {
  it("says where the layout is standing", () => {
    expect(spotSentence({ x: 1024, z: 2048 })).toBe("Standing at 1024, 2048.");
  });

  /** A spot comes off a pointer, so it is fractional far more often than not,
   *  and nobody reads a base's position to three decimal places. */
  it("says it in whole elmos", () => {
    expect(spotSentence({ x: 1023.7, z: 2047.2 })).toBe(
      "Standing at 1024, 2047.",
    );
  });
});

/** Balanced Annihilation's own numbers, so the shapes below really exist. */
const units = [
  { name: "armsolar", footprintX: 5, footprintZ: 5, maxSlope: 20 },
  { name: "armmex", footprintX: 3, footprintZ: 3, maxSlope: 40 },
];

const solar = (x: number, z: number): BlueprintBuilding => ({
  def: "armsolar",
  offset: { x, z },
  facing: 0,
});

/** Ground at one height everywhere, which every building stands on. */
const flat: Ground = {
  cornerAt: () => 100,
  slack: 0,
  minHeight: 0,
  maxHeight: 500,
  hasWater: true,
};

/** A cliff along x: everything east of 400 elmos is 200 elmos higher. */
const cliff: Ground = {
  cornerAt: (x) => (x * 8 >= 400 ? 300 : 100),
  slack: 0,
  minHeight: 0,
  maxHeight: 500,
  hasWater: true,
};

describe("spotLayout", () => {
  /** The offsets are what a layout is: a shape, said from its own middle. */
  it("stands every building at its offset from the spot", () => {
    expect(
      spotLayout([solar(0, 0), solar(96, -32)], { x: 1000, z: 2000 }),
    ).toEqual([
      { def: "armsolar", facing: 0, pos: { x: 1000, z: 2000 } },
      { def: "armsolar", facing: 0, pos: { x: 1096, z: 1968 } },
    ]);
  });

  it("has nothing to stand for a layout with nothing in it", () => {
    expect(spotLayout([], { x: 100, z: 100 })).toEqual([]);
  });
});

describe("spotNudge", () => {
  const layoutFor = (buildings: BlueprintBuilding[], at: number) =>
    spotLayout(buildings, { x: at, z: 100 });

  const offerFor = (
    buildings: BlueprintBuilding[],
    at: number,
    ground: Ground,
  ) => {
    const { footprintOf, standingOf } = previewChecks(units, ground);
    const layout = layoutFor(buildings, at);
    const marks = layoutPreview(layout, footprintOf, [], standingOf);
    return spotNudge(layout, marks, footprintOf, standingOf);
  };

  /** A layout the ground already takes has nothing to be offered: the author is
   *  looking at the answer they came for. */
  it("offers nothing where the layout already stands", () => {
    expect(offerFor([solar(0, 0)], 100, flat)).toBeNull();
  });

  /** The whole point of the offer: the spot is refused, another one nearby is
   *  not, and the author is hunting for it by hand. */
  it("offers the nearest spot the whole layout fits", () => {
    const buildings = [solar(0, 0)];
    const offer = offerFor(buildings, 400, cliff);
    expect(offer).not.toBeNull();
    expect(offer).not.toBe("nowhere");
    if (!offer || offer === "nowhere") return;
    // Whole build squares, because a shorter move lands the layout on the
    // squares it is already on.
    expect(offer.delta.x).toBe(offer.squares.x * BUILD_SQUARE);
    expect(offer.delta.z).toBe(offer.squares.z * BUILD_SQUARE);
    // And the offered spot really is one the ground takes, which is the whole
    // of what is being offered.
    const { footprintOf, standingOf } = previewChecks(units, cliff);
    const there = nudgedPreview(
      layoutFor(buildings, 400),
      offer,
      footprintOf,
      [],
      standingOf,
    );
    expect(there.map((mark) => mark.standing)).toEqual(["fine"]);
  });

  /** A layout whose own buildings are inside each other is refused wherever it
   *  is put, so the search runs out rather than finding a spot. */
  it("says nowhere for a layout no spot can fit", () => {
    expect(offerFor([solar(0, 0), solar(16, 0)], 100, flat)).toBe("nowhere");
  });
});
