import { describe, expect, it } from "vitest";

import { LEGO_SCHEMA_VERSION, type LegoPiece, type LegoProject } from "./model";
import { pieceRest } from "./pieceRest";

function piece(
  id: string,
  parentId: string | null,
  position: [number, number, number],
): LegoPiece {
  return {
    id,
    name: id,
    parentId,
    partId: null,
    position,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  };
}

function project(pieces: LegoPiece[]): LegoProject {
  return {
    schemaVersion: LEGO_SCHEMA_VERSION,
    id: "p1",
    name: "Test",
    unitName: "test",
    packId: "pack",
    packVersion: "1",
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    rootPieceId: "root",
    pieces,
  };
}

describe("pieceRest", () => {
  /** The runtime numbers pieces by their place in the array it was handed, so
   *  the two lists have to line up index for index. */
  it("names parents by their place in the list, in the list's own order", () => {
    const rest = pieceRest(
      project([
        piece("root", null, [0, 0, 0]),
        piece("torso", "root", [0, 10, 0]),
        piece("arm", "torso", [4, 2, 0]),
      ]),
    );

    expect(rest).toEqual([
      { parent: null, position: [0, 0, 0] },
      { parent: 0, position: [0, 10, 0] },
      { parent: 1, position: [4, 2, 0] },
    ]);
  });

  /** Reparenting moves a piece in the tree and leaves it where it was in the
   *  array, so a parent later in the list is ordinary rather than a fault. */
  it("finds a parent that comes after the piece", () => {
    const rest = pieceRest(
      project([
        piece("arm", "torso", [4, 2, 0]),
        piece("torso", null, [0, 10, 0]),
      ]),
    );

    expect(rest[0].parent).toBe(1);
  });

  /** The builder treats a piece whose parent is gone as a root, and so does
   *  this: the alternative is an index pointing at somebody else's piece. */
  it("treats a piece whose parent is missing as a root", () => {
    const rest = pieceRest(project([piece("arm", "gone", [4, 2, 0])]));

    expect(rest[0].parent).toBeNull();
  });
});
