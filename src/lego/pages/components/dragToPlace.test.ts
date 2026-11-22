import { describe, expect, it } from "vitest";

import {
  chooseDropTarget,
  DRAG_TRAVEL,
  groundSpot,
  startsDrag,
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
  const ground: [number, number, number] = [1, 0, 2];

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
      position: ground,
    });
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
