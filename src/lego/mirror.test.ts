import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { canMirror, mirrorCopy, mirrorPiece, mirrorRole } from "./mirror";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import { worldMatrix } from "./reparent";

function project(pieces: Partial<LegoPiece>[]): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-07-29T00:00:00Z",
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

function round(values: number[]): number[] {
  return values.map((n) => Number(n.toFixed(6)));
}

/** Where a piece's own origin lands in the unit. */
function worldOrigin(doc: LegoProject, pieceId: string): number[] {
  const point = new THREE.Vector3().applyMatrix4(worldMatrix(doc, pieceId));
  return round([point.x, point.y, point.z]);
}

/** Where a point in a piece's own space lands in the unit. */
function worldPoint(
  doc: LegoProject,
  pieceId: string,
  local: [number, number, number],
): number[] {
  const point = new THREE.Vector3(...local).applyMatrix4(
    worldMatrix(doc, pieceId),
  );
  return round([point.x, point.y, point.z]);
}

function pieceOf(doc: LegoProject, id: string): LegoPiece {
  return doc.pieces.find((piece) => piece.id === id) as LegoPiece;
}

describe("canMirror", () => {
  const doc = project([
    { id: "leg", parentId: "root" },
    { id: "foot", parentId: "leg" },
  ]);

  it("allows any piece hanging off something", () => {
    expect(canMirror(doc, "leg")).toBe(true);
    expect(canMirror(doc, "foot")).toBe(true);
  });

  it("refuses the root, which is the frame the centre line is measured in", () => {
    expect(canMirror(doc, "root")).toBe(false);
  });

  it("refuses a piece that is not there", () => {
    expect(canMirror(doc, "ghost")).toBe(false);
  });

  it("returns the document untouched when the piece cannot be mirrored", () => {
    expect(mirrorPiece(doc, "root")).toBe(doc);
    expect(mirrorPiece(doc, "ghost")).toBe(doc);
  });
});

describe("mirrorPiece", () => {
  it("sends a piece to the other side of the centre line", () => {
    const doc = project([{ id: "leg", parentId: "root", position: [3, 1, 2] }]);

    const mirrored = mirrorPiece(doc, "leg");

    expect(worldOrigin(mirrored, "leg")).toEqual([-3, 1, 2]);
  });

  it("carries the whole subtree over without touching its transforms", () => {
    const doc = project([
      { id: "thigh", parentId: "root", position: [2, 4, 0] },
      { id: "shin", parentId: "thigh", position: [1, -2, 0] },
      { id: "foot", parentId: "shin", position: [0, -2, 1] },
    ]);

    const mirrored = mirrorPiece(doc, "thigh");

    expect(worldOrigin(mirrored, "shin")).toEqual([-3, 2, 0]);
    expect(worldOrigin(mirrored, "foot")).toEqual([-3, 0, 1]);
    // Only the piece that was mirrored changed. Everything under it is already
    // positioned against it, so it comes along untouched.
    expect(pieceOf(mirrored, "shin")).toEqual(pieceOf(doc, "shin"));
    expect(pieceOf(mirrored, "foot")).toEqual(pieceOf(doc, "foot"));
  });

  it("mirrors the piece's own geometry, not only where it sits", () => {
    const doc = project([{ id: "fin", parentId: "root", position: [4, 0, 0] }]);

    const mirrored = mirrorPiece(doc, "fin");

    // A point one metre out along the piece's +x now points the other way.
    expect(worldPoint(doc, "fin", [1, 0, 0])).toEqual([5, 0, 0]);
    expect(worldPoint(mirrored, "fin", [1, 0, 0])).toEqual([-5, 0, 0]);
  });

  it("turns the transform inside out, which is what reverses winding", () => {
    const doc = project([{ id: "fin", parentId: "root", position: [4, 0, 0] }]);

    const mirrored = mirrorPiece(doc, "fin");

    expect(worldMatrix(doc, "fin").determinant()).toBeGreaterThan(0);
    expect(worldMatrix(mirrored, "fin").determinant()).toBeLessThan(0);
  });

  it("reflects a rotation rather than keeping it", () => {
    const doc = project([
      { id: "arm", parentId: "root", position: [2, 0, 0] },
      { id: "hand", parentId: "arm", position: [0, 0, 3] },
    ]);
    // A quarter turn about y sends the child's +z offset to +x.
    const turned = {
      ...doc,
      pieces: doc.pieces.map((piece) =>
        piece.id === "arm"
          ? {
              ...piece,
              rotation: [0, Math.PI / 2, 0] as [number, number, number],
            }
          : piece,
      ),
    };

    expect(worldOrigin(turned, "hand")).toEqual([5, 0, 0]);
    expect(worldOrigin(mirrorPiece(turned, "arm"), "hand")).toEqual([-5, 0, 0]);
  });

  it("leaves a piece already on the centre line where it is", () => {
    const doc = project([
      { id: "hull", parentId: "root", position: [0, 2, 0] },
    ]);

    const mirrored = mirrorPiece(doc, "hull");

    expect(worldOrigin(mirrored, "hull")).toEqual([0, 2, 0]);
    // It still turns inside out, which is the whole of what a mirror does to
    // something straddling the plane.
    expect(worldPoint(mirrored, "hull", [1, 0, 0])).toEqual([-1, 2, 0]);
  });

  it("mirrors about the root's own plane, not the world's", () => {
    const doc = project([{ id: "leg", parentId: "root", position: [1, 0, 0] }]);
    // Sitting the unit down, or sliding it sideways, moves the root. The centre
    // line goes with it.
    const moved = {
      ...doc,
      pieces: doc.pieces.map((piece) =>
        piece.id === "root"
          ? { ...piece, position: [10, 0, 0] as [number, number, number] }
          : piece,
      ),
    };

    expect(worldOrigin(mirrorPiece(moved, "leg"), "leg")).toEqual([9, 0, 0]);
  });

  it("comes back to where it started when mirrored twice", () => {
    const doc = project([
      {
        id: "leg",
        parentId: "root",
        position: [3, 1, 2],
        rotation: [0.2, 0.3, 0.4],
        scale: [1, 2, 3],
      },
    ]);

    const back = mirrorPiece(mirrorPiece(doc, "leg"), "leg");
    const before = pieceOf(doc, "leg");
    const after = pieceOf(back, "leg");

    expect(round(after.position)).toEqual(round(before.position));
    expect(round(after.scale)).toEqual(round(before.scale));
    expect(worldOrigin(back, "leg")).toEqual(worldOrigin(doc, "leg"));
    expect(worldMatrix(back, "leg").determinant()).toBeGreaterThan(0);
  });

  it("moves every role in the subtree to the other side", () => {
    const doc = project([
      { id: "thigh", parentId: "root", role: "leg.l1.thigh" },
      { id: "shin", parentId: "thigh", role: "leg.l1.shin" },
      { id: "flare", parentId: "shin", role: "flare" },
      { id: "other", parentId: "root", role: "leg.l2.thigh" },
    ]);

    const mirrored = mirrorPiece(doc, "thigh");

    expect(pieceOf(mirrored, "thigh").role).toBe("leg.r1.thigh");
    expect(pieceOf(mirrored, "shin").role).toBe("leg.r1.shin");
    expect(pieceOf(mirrored, "flare").role).toBe("flare");
    // Outside the subtree, so untouched.
    expect(pieceOf(mirrored, "other").role).toBe("leg.l2.thigh");
  });
});

describe("mirrorCopy", () => {
  /** Ids in order, so a test can name the pieces the copy created. */
  function counter(): () => string {
    let n = 0;
    return () => `new${n++}`;
  }

  const doc = project([
    {
      id: "thigh",
      name: "thigh",
      parentId: "root",
      position: [2, 3, 0],
      rotation: [0, 0, 0.3],
      role: "leg.l1.thigh",
    },
    {
      id: "foot",
      name: "foot",
      parentId: "thigh",
      position: [0.8, -1.5, 0.6],
    },
  ]);

  it("puts the copy where a mirror would, not at the parent's origin", () => {
    const copy = mirrorCopy(doc, "thigh", counter());

    expect(copy).not.toBeNull();
    const mirrored = copy?.project as LegoProject;
    // Lifting a subtree drops its root's transform, so this is the part that
    // has to be put back before the reflection means anything.
    expect(worldOrigin(mirrored, copy?.pieceId as string)).toEqual([-2, 3, 0]);
    expect(worldOrigin(mirrored, "thigh")).toEqual([2, 3, 0]);
  });

  it("brings the subtree with it, reflected", () => {
    const copy = mirrorCopy(doc, "thigh", counter()) as {
      project: LegoProject;
      pieceId: string;
    };
    const foot = copy.project.pieces.find((piece) => piece.name === "foot2");

    expect(worldOrigin(copy.project, foot?.id as string)).toEqual(
      worldOrigin(doc, "foot").map((n, axis) => (axis === 0 ? -n : n)),
    );
  });

  it("leaves the original alone", () => {
    const copy = mirrorCopy(doc, "thigh", counter()) as {
      project: LegoProject;
      pieceId: string;
    };

    expect(pieceOf(copy.project, "thigh")).toEqual(pieceOf(doc, "thigh"));
    expect(pieceOf(copy.project, "foot")).toEqual(pieceOf(doc, "foot"));
  });

  it("names and hangs the copy the way duplicate already does", () => {
    const copy = mirrorCopy(doc, "thigh", counter()) as {
      project: LegoProject;
      pieceId: string;
    };
    const added = pieceOf(copy.project, copy.pieceId);

    expect(added.name).toBe("thigh2");
    expect(added.parentId).toBe("root");
    expect(added.role).toBe("leg.r1.thigh");
    expect(copy.project.pieces).toHaveLength(doc.pieces.length + 2);
  });

  it("refuses a piece that cannot be mirrored", () => {
    expect(mirrorCopy(doc, "root", counter())).toBeNull();
    expect(mirrorCopy(doc, "ghost", counter())).toBeNull();
  });
});

describe("mirrorRole", () => {
  it("swaps the side of a leg role", () => {
    expect(mirrorRole("leg.l1.thigh")).toBe("leg.r1.thigh");
    expect(mirrorRole("leg.r2.foot")).toBe("leg.l2.foot");
  });

  it("leaves a sideless role alone", () => {
    expect(mirrorRole("turret")).toBe("turret");
    expect(mirrorRole("buildarm.arm")).toBe("buildarm.arm");
    expect(mirrorRole("")).toBe("");
  });
});
