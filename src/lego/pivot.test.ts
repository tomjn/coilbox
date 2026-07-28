import { describe, expect, it } from "vitest";

import { type LegoPiece, type LegoProject, newProject } from "./model";
import type { LegoPartInfo } from "./pack";
import { currentPivot, pivotChoices, setPivot } from "./pivot";
import { worldMatrix } from "./reparent";

/** A part two metres tall, centred on its own middle as the pack leaves them. */
const PART = {
  bbox: { min: [-1, -2, -1], max: [1, 2, 1] },
} as LegoPartInfo;

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
        partId: "part",
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
        ...piece,
      })),
    ],
  };
}

/**
 * Where a piece's geometry sits in the unit.
 *
 * The origin moves, so the geometry is what has to stay put: its world
 * position is the piece's own transform applied to a point offset by the pivot.
 */
function geometryAt(doc: LegoProject, pieceId: string): number[] {
  const piece = doc.pieces.find((p) => p.id === pieceId) as LegoPiece;
  const pivot = piece.pivot ?? [0, 0, 0];
  const matrix = worldMatrix(doc, pieceId).elements;
  // Apply the world matrix to (-pivot), which is where the part's own middle
  // now lies relative to the piece origin.
  const v = [-pivot[0], -pivot[1], -pivot[2]];
  return [0, 1, 2].map((axis) =>
    Number(
      (
        matrix[axis] * v[0] +
        matrix[4 + axis] * v[1] +
        matrix[8 + axis] * v[2] +
        matrix[12 + axis]
      ).toFixed(5),
    ),
  );
}

describe("pivotChoices", () => {
  it("offers the middle and each face of the part", () => {
    const choices = pivotChoices(PART);

    expect(choices.map((choice) => choice.id)).toEqual([
      "middle",
      "top",
      "bottom",
      "left",
      "right",
      "back",
      "front",
    ]);
    expect(choices.find((c) => c.id === "top")?.position).toEqual([0, 2, 0]);
    expect(choices.find((c) => c.id === "bottom")?.position).toEqual([
      0, -2, 0,
    ]);
  });
});

describe("currentPivot", () => {
  it("reads an unset pivot as the middle, which is where parts start", () => {
    expect(currentPivot(PART, undefined)).toBe("middle");
  });

  it("names the face a pivot sits on", () => {
    expect(currentPivot(PART, [0, 2, 0])).toBe("top");
  });

  it("is null for a pivot that is not one of the offered points", () => {
    expect(currentPivot(PART, [0.3, 0.7, 0])).toBeNull();
  });
});

describe("setPivot", () => {
  it("leaves the geometry exactly where it was", () => {
    const doc = project([{ id: "thigh", position: [3, 5, 0] }]);

    const moved = setPivot(doc, "thigh", [0, 2, 0]);

    expect(geometryAt(moved, "thigh")).toEqual(geometryAt(doc, "thigh"));
  });

  it("moves the origin itself, which is what the piece turns about", () => {
    const doc = project([{ id: "thigh", position: [0, 0, 0] }]);

    const moved = setPivot(doc, "thigh", [0, 2, 0]);
    const thigh = moved.pieces.find((piece) => piece.id === "thigh");

    // The origin rises to the top of the part, so the part now hangs below it.
    expect(thigh?.position).toEqual([0, 2, 0]);
    expect(thigh?.pivot).toEqual([0, 2, 0]);
  });

  it("leaves children where they were", () => {
    const doc = project([
      { id: "thigh", position: [0, 0, 0] },
      { id: "shin", parentId: "thigh", position: [0, -3, 0] },
    ]);

    const moved = setPivot(doc, "thigh", [0, 2, 0]);

    expect(geometryAt(moved, "shin")).toEqual(geometryAt(doc, "shin"));
  });

  it("takes the piece's own rotation into account", () => {
    const doc = project([
      // A quarter turn about z sends the part's +y onto world -x.
      { id: "arm", rotation: [0, 0, Math.PI / 2] },
    ]);

    const moved = setPivot(doc, "arm", [0, 2, 0]);
    const arm = moved.pieces.find((piece) => piece.id === "arm");

    expect(arm?.position.map((n) => Number(n.toFixed(5)))).toEqual([-2, 0, 0]);
    expect(geometryAt(moved, "arm")).toEqual(geometryAt(doc, "arm"));
  });

  it("takes the piece's own scale into account", () => {
    const doc = project([{ id: "arm", scale: [1, 3, 1] }]);

    const moved = setPivot(doc, "arm", [0, 2, 0]);
    const arm = moved.pieces.find((piece) => piece.id === "arm");

    expect(arm?.position).toEqual([0, 6, 0]);
  });

  it("does nothing when the pivot is already there", () => {
    const doc = project([{ id: "arm", pivot: [0, 2, 0] }]);

    expect(setPivot(doc, "arm", [0, 2, 0])).toBe(doc);
  });

  it("ignores a piece that is not there", () => {
    const doc = project([]);

    expect(setPivot(doc, "ghost", [0, 1, 0])).toBe(doc);
  });
});
