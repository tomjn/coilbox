import { describe, expect, it } from "vitest";

import type { BlueprintBuilding } from "@/blueprint/model";
import { checkMapFor, checkSpot, spotLayout, spotSentence } from "./mapCheck";

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
  /** A layout arrives in the middle of the map, which is the one spot on every
   *  map that is on it. */
  it("puts a layout nobody has placed in the middle", () => {
    expect(checkSpot(null, 4096, 8192)).toEqual({ x: 2048, z: 4096 });
  });

  it("keeps the spot an author picked", () => {
    expect(checkSpot({ x: 100, z: 200 }, 4096, 4096)).toEqual({
      x: 100,
      z: 200,
    });
  });

  /** A drag carries the layout by whatever the pointer did, which can be off
   *  the map. The engine clamps anything standing past the edge onto it, so the
   *  check would be answering about ground the layout is not on. */
  it("holds the spot on the map", () => {
    expect(checkSpot({ x: -400, z: 9000 }, 4096, 4096)).toEqual({
      x: 0,
      z: 4096,
    });
  });

  /** Before the map's extent has been read there is no middle to arrive at, and
   *  a spot of nothing is as good an answer as any. */
  it("answers nothing about a map with no extent yet", () => {
    expect(checkSpot(null, 0, 0)).toEqual({ x: 0, z: 0 });
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

const solar = (x: number, z: number): BlueprintBuilding => ({
  def: "armsolar",
  offset: { x, z },
  facing: 0,
});

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
