import { describe, expect, it } from "vitest";

import { newProject } from "../../model";
import {
  chooseDropTarget,
  DRAG_TRAVEL,
  groundParentId,
  groundSpot,
  placingAfterDrag,
  startsDrag,
  surfaceSpot,
} from "./dragToPlace";

describe("startsDrag", () => {
  const from = { x: 100, y: 100 };

  it("is a click while the pointer stays within the travel", () => {
    expect(startsDrag(from, from)).toBe(false);
    expect(startsDrag(from, { x: 100 + DRAG_TRAVEL, y: 100 })).toBe(false);
  });

  it("is a drag once the pointer is past the travel in any direction", () => {
    expect(startsDrag(from, { x: 100 + DRAG_TRAVEL + 1, y: 100 })).toBe(true);
    expect(startsDrag(from, { x: 100, y: 100 - DRAG_TRAVEL - 1 })).toBe(true);
  });

  it("measures the straight line, not each axis", () => {
    expect(startsDrag(from, { x: 103, y: 103 })).toBe(true);
    expect(startsDrag(from, { x: 102, y: 102 })).toBe(false);
  });
});

describe("chooseDropTarget", () => {
  const face = { parentId: "a", to: "top" };
  const ground = {
    parentId: "root",
    position: [1, 0, 2] as [number, number, number],
  };

  it("takes the face under the pointer", () => {
    expect(chooseDropTarget({ hitPiece: true, face, ground })).toEqual({
      kind: "face",
      target: face,
    });
  });

  it("does not fall through to the ground behind a piece with no face", () => {
    expect(chooseDropTarget({ hitPiece: true, face: null, ground })).toBeNull();
  });

  it("takes the ground where nothing is hit", () => {
    expect(chooseDropTarget({ hitPiece: false, face: null, ground })).toEqual({
      kind: "ground",
      ...ground,
    });
  });

  it("takes the point under the pointer for a shape, which needs no face", () => {
    expect(
      chooseDropTarget({
        hitPiece: true,
        face: null,
        ground: null,
        surface: { parentId: "a", position: [0, 1, 0] },
      }),
    ).toEqual({ kind: "surface", parentId: "a", position: [0, 1, 0] });
  });

  it("is nothing without a ground to land on", () => {
    expect(
      chooseDropTarget({ hitPiece: false, face: null, ground: null }),
    ).toBeNull();
  });
});

describe("groundSpot", () => {
  it("snaps the ground axes to the step and lifts the part onto the ground", () => {
    expect(groundSpot([1.4, 0, -2.6], 0.5, 0.25)).toEqual([1.5, 0.25, -2.5]);
  });

  it("leaves the pointer's place alone with snapping off", () => {
    expect(groundSpot([1.4, 0, -2.6], null, 0.25)).toEqual([1.4, 0.25, -2.6]);
  });

  it("keeps the ground's own height rather than snapping it", () => {
    expect(groundSpot([1, 0.3, 1], 1, 0)).toEqual([1, 0.3, 1]);
  });
});

describe("groundParentId", () => {
  const unit = {
    ...newProject({
      id: "u",
      rootPieceId: "root",
      name: "unit",
      packId: "lego",
      packVersion: "1",
      now: "2026-10-17T00:00:00Z",
    }),
  };
  const withHull = {
    ...unit,
    pieces: [
      ...unit.pieces,
      {
        id: "hull",
        name: "hull",
        parentId: "root",
        partId: "hull",
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
      },
    ],
  };

  it("is the selected piece when one is selected", () => {
    expect(groundParentId(withHull, "hull")).toBe("hull");
  });

  it("is the root with nothing selected", () => {
    expect(groundParentId(withHull, null)).toBe("root");
  });

  it("is the root when the selection is not in the unit", () => {
    expect(groundParentId(withHull, "gone")).toBe("root");
  });
});

describe("surfaceSpot", () => {
  it("rests a shape on a top face, half its height above the point", () => {
    expect(surfaceSpot([1, 2, 3], [0, 1, 0], [1, 0.5, 1])).toEqual([
      1, 2.25, 3,
    ]);
  });

  it("rests it against a side by half its width", () => {
    expect(surfaceSpot([0, 1, 0], [0, 0, -1], [2, 1, 4])).toEqual([0, 1, -2]);
  });

  it("measures a slanted face by its reach along the normal", () => {
    const [x, y] = surfaceSpot([0, 0, 0], [1, 1, 0], [2, 2, 2]);
    // Reach is sqrt(2) along the normal, which is 1 along each axis.
    expect(x).toBeCloseTo(1);
    expect(y).toBeCloseTo(x);
  });

  it("stays on the point for a normal with no direction", () => {
    expect(surfaceSpot([1, 1, 1], [0, 0, 0], [1, 1, 1])).toEqual([1, 1, 1]);
  });
});

describe("placingAfterDrag", () => {
  const before = { part: "beam" };

  it("restores the click mode that was active when nothing was placed", () => {
    expect(placingAfterDrag(before, false)).toBe(before);
  });

  it("stays off when nothing was active", () => {
    expect(placingAfterDrag(null, false)).toBeNull();
  });

  it("ends placing once a drop placed something", () => {
    expect(placingAfterDrag(before, true)).toBeNull();
  });
});
