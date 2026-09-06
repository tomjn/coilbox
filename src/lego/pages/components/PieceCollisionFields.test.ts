/**
 * Which piece, if any, the viewport's collision handles land on (issue #2549).
 *
 * `CollisionPanel.dom.test.tsx` covers the panel that reads and writes a
 * volume once the handles are somewhere. This is the routing in front of
 * that: given the canvas selection, does a drag size the unit's own volume or
 * a piece's box underneath it. `pickedCollisionPiece` already had no test of
 * its own, so both live here rather than only the new one.
 */

import { describe, expect, it } from "vitest";

import type { LegoPiece, LegoProject } from "../../model";
import { newProject } from "../../model";
import {
  collisionHandlePieceId,
  pickedCollisionPiece,
} from "./PieceCollisionFields";

/** A root with one real child piece, the shape every fresh unit in the
 *  builder has: an empty root and a part hanging off it. */
function unit(): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "base",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-08-21T00:00:00Z",
  });
  const hull: LegoPiece = {
    id: "hull",
    name: "hull",
    parentId: "base",
    partId: "tri",
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  };
  return { ...base, pieces: [...base.pieces, hull] };
}

describe("collisionHandlePieceId", () => {
  it("leaves the handles on the unit's volume when nothing is selected", () => {
    expect(collisionHandlePieceId(unit(), null)).toBeNull();
  });

  /**
   * The one that matters. Opening a document selects the root
   * (`reduceDocument`'s "open" case), so every freshly opened or created unit
   * has the root selected before anyone has clicked anything. Without this,
   * the handles would land on the root's own one-elmo box instead of the
   * unit's volume the panel describes, and a drag would size a box the top
   * fields never read.
   */
  it("leaves the handles on the unit's volume when the root is selected", () => {
    const project = unit();
    expect(collisionHandlePieceId(project, project.rootPieceId)).toBeNull();
  });

  it("moves the handles onto a real piece's box once one is selected", () => {
    expect(collisionHandlePieceId(unit(), "hull")).toBe("hull");
  });
});

describe("pickedCollisionPiece", () => {
  it("picks the selected piece", () => {
    expect(pickedCollisionPiece(unit(), "hull")).toBe("hull");
  });

  it("opens on the first piece when nothing is selected", () => {
    expect(pickedCollisionPiece(unit(), null)).toBe("base");
  });
});
