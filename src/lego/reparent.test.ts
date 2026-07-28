import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { type LegoPiece, type LegoProject, newProject } from "./model";
import { canReparent, reparentPiece, worldMatrix } from "./reparent";

function project(pieces: Partial<LegoPiece>[]): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-07-28T00:00:00Z",
  });
  return {
    ...base,
    pieces: [
      ...base.pieces,
      ...pieces.map((piece, i) => ({
        id: `piece${i}`,
        name: `piece${i}`,
        parentId: "root",
        partId: null,
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
        ...piece,
      })),
    ],
  };
}

/** Where a piece's own origin lands in the unit, which is what must not move. */
function worldOrigin(doc: LegoProject, pieceId: string): number[] {
  const point = new THREE.Vector3().applyMatrix4(worldMatrix(doc, pieceId));
  return [point.x, point.y, point.z].map((n) => Number(n.toFixed(6)));
}

describe("worldMatrix", () => {
  it("applies every ancestor's transform", () => {
    const doc = project([
      { id: "arm", parentId: "root", position: [2, 0, 0] },
      { id: "hand", parentId: "arm", position: [1, 0, 0] },
    ]);

    expect(worldOrigin(doc, "hand")).toEqual([3, 0, 0]);
  });

  it("turns a child by its parent's rotation", () => {
    const doc = project([
      { id: "arm", parentId: "root", rotation: [0, Math.PI / 2, 0] },
      { id: "hand", parentId: "arm", position: [1, 0, 0] },
    ]);

    // A quarter turn about y sends the child's +x offset to -z.
    expect(worldOrigin(doc, "hand")).toEqual([0, 0, -1]);
  });

  it("survives a document whose parents form a loop", () => {
    const doc = project([
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" },
    ]);

    expect(() => worldMatrix(doc, "a")).not.toThrow();
  });
});

describe("canReparent", () => {
  const doc = project([
    { id: "arm", parentId: "root" },
    { id: "hand", parentId: "arm" },
    { id: "leg", parentId: "root" },
  ]);

  it("allows a move to another branch", () => {
    expect(canReparent(doc, "hand", "leg")).toBe(true);
  });

  it("refuses a piece as its own parent, or its descendant's child", () => {
    expect(canReparent(doc, "arm", "arm")).toBe(false);
    expect(canReparent(doc, "arm", "hand")).toBe(false);
  });

  it("refuses to move the root, or anything that is not there", () => {
    expect(canReparent(doc, "root", "arm")).toBe(false);
    expect(canReparent(doc, "ghost", "arm")).toBe(false);
    expect(canReparent(doc, "arm", "ghost")).toBe(false);
  });
});

describe("reparentPiece", () => {
  it("leaves the piece where it was in the unit", () => {
    const doc = project([
      { id: "arm", parentId: "root", position: [2, 0, 0] },
      { id: "hand", parentId: "arm", position: [1, 0, 0] },
      { id: "leg", parentId: "root", position: [0, 3, 0] },
    ]);

    const moved = reparentPiece(doc, "hand", "leg");

    expect(worldOrigin(moved, "hand")).toEqual(worldOrigin(doc, "hand"));
    expect(worldOrigin(moved, "hand")).toEqual([3, 0, 0]);
  });

  it("undoes the new parent's rotation and scale", () => {
    const doc = project([
      {
        id: "turret",
        parentId: "root",
        rotation: [0, Math.PI / 2, 0],
        scale: [2, 2, 2],
      },
      { id: "gun", parentId: "root", position: [0, 0, 4] },
    ]);

    const moved = reparentPiece(doc, "gun", "turret");
    const gun = moved.pieces.find((piece) => piece.id === "gun");

    expect(worldOrigin(moved, "gun")).toEqual([0, 0, 4]);
    // Half the size, because the parent doubles it. The offset moves onto the
    // parent's own axes: a quarter turn about y puts its -x along world +z.
    expect(gun?.scale.map((n) => Number(n.toFixed(6)))).toEqual([
      0.5, 0.5, 0.5,
    ]);
    expect(gun?.position.map((n) => Number(n.toFixed(6)))).toEqual([-2, 0, 0]);
  });

  it("records the new parent", () => {
    const doc = project([
      { id: "arm", parentId: "root" },
      { id: "leg", parentId: "root" },
    ]);

    const moved = reparentPiece(doc, "arm", "leg");

    expect(moved.pieces.find((piece) => piece.id === "arm")?.parentId).toBe(
      "leg",
    );
  });

  it("returns the document untouched when the move is not allowed", () => {
    const doc = project([
      { id: "arm", parentId: "root" },
      { id: "hand", parentId: "arm" },
    ]);

    expect(reparentPiece(doc, "arm", "hand")).toBe(doc);
  });
});
