import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { LegoConnector } from "./connectors";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import type { LoadedPack } from "./pack";
import { worldMatrix } from "./reparent";
import {
  faceSizes,
  landSize,
  lowestSize,
  MIN_SHAPE_SIZE,
  resizeShapeFace,
  shapeReadout,
} from "./resizeShape";
import { shapeConnectors } from "./shapeConnectors";
import { type LegoShape, shapeKinds } from "./shapes";

type Vec3 = [number, number, number];

const PACK = {
  manifest: { unit: 0.25 },
  parts: [],
  byId: new Map(),
} as unknown as LoadedPack;

function shapeOf(kind: string, options?: Record<string, number>): LegoShape {
  return { kind, size: [4, 6, 4], swatch: "grey", options };
}

function unit(pieces: Partial<LegoPiece>[]): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "u",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  return {
    ...base,
    pieces: [
      ...base.pieces,
      ...pieces.map(
        (piece) =>
          ({
            name: piece.id,
            parentId: "root",
            partId: null,
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
            ...piece,
          }) as LegoPiece,
      ),
    ],
  };
}

function piece(project: LegoProject, id: string): LegoPiece {
  return project.pieces.find((p) => p.id === id) as LegoPiece;
}

/** Where a point of the shape's own space is in the world. */
function world(project: LegoProject, id: string, point: Vec3): THREE.Vector3 {
  const p = piece(project, id);
  const pivot = p.pivot ?? [0, 0, 0];
  return new THREE.Vector3(
    point[0] - pivot[0],
    point[1] - pivot[1],
    point[2] - pivot[2],
  ).applyMatrix4(worldMatrix(project, id));
}

/** The middle of the face on `axis`, at the box the shape is drawn in. */
function faceMiddle(shape: LegoShape, axis: number, sign: number): Vec3 {
  const point: Vec3 = [0, 0, 0];
  point[axis] = (sign * faceSizes(shape)[axis]) / 2;
  return point;
}

function near(a: THREE.Vector3, b: THREE.Vector3) {
  expect(a.distanceTo(b)).toBeLessThan(1e-9);
}

describe("resizeShapeFace", () => {
  for (const kind of shapeKinds()) {
    describe(kind, () => {
      for (const axis of [0, 1, 2] as const) {
        for (const sign of [1, -1] as const) {
          it(`keeps the opposite face still dragging ${sign > 0 ? "+" : "-"}${"xyz"[axis]}, turned`, () => {
            const shape = shapeOf(kind);
            const project = unit([
              {
                id: "a",
                shape,
                position: [1, 2, 3],
                rotation: [0.3, 0.5, 0.2],
              },
            ]);
            const result = resizeShapeFace(project, PACK, "a", axis, sign, 5);
            expect(result).not.toBeNull();
            const after = piece(result?.project as LegoProject, "a");
            expect(after.shape?.size.length).toBe(3);
            expect(after.scale).toEqual([1, 1, 1]);
            near(
              world(project, "a", faceMiddle(shape, axis, -sign)),
              world(
                result?.project as LegoProject,
                "a",
                faceMiddle(after.shape as LegoShape, axis, -sign),
              ),
            );
            expect(faceSizes(after.shape as LegoShape)[axis]).toBe(5);
          });
        }
      }
    });
  }

  it("moves the position by half the change", () => {
    const project = unit([{ id: "a", shape: shapeOf("wedge") }]);
    const high = resizeShapeFace(project, PACK, "a", 2, 1, 6);
    expect(piece(high?.project as LegoProject, "a").position).toEqual([
      0, 0, 1,
    ]);
    const low = resizeShapeFace(project, PACK, "a", 2, -1, 6);
    expect(piece(low?.project as LegoProject, "a").position).toEqual([
      0, 0, -1,
    ]);
  });

  it("changes the size and never the scale", () => {
    const project = unit([{ id: "a", shape: shapeOf("sphere") }]);
    const out = piece(
      resizeShapeFace(project, PACK, "a", 0, 1, 8)?.project as LegoProject,
      "a",
    );
    expect(out.shape?.size).toEqual([8, 6, 4]);
    expect(out.scale).toEqual([1, 1, 1]);
  });

  it("sizes both cross axes of a round shape together", () => {
    const project = unit([{ id: "a", shape: shapeOf("cylinder") }]);
    const out = resizeShapeFace(project, PACK, "a", 0, 1, 2)
      ?.project as LegoProject;
    expect(piece(out, "a").shape?.size).toEqual([2, 6, 2]);
    // Only the dragged axis shifts: the other cross axis is symmetric.
    expect(piece(out, "a").position).toEqual([-1, 0, 0]);
  });

  it("sizes only the length when the axis along the cylinder is dragged", () => {
    const project = unit([{ id: "a", shape: shapeOf("cylinder") }]);
    const out = resizeShapeFace(project, PACK, "a", 1, 1, 8)
      ?.project as LegoProject;
    expect(piece(out, "a").shape?.size).toEqual([4, 8, 4]);
  });

  it("follows the cylinder's own axis option", () => {
    const shape: LegoShape = {
      ...shapeOf("cylinder"),
      options: { axis: 0, sides: 12 },
    };
    const project = unit([{ id: "a", shape }]);
    const out = resizeShapeFace(project, PACK, "a", 0, 1, 7)
      ?.project as LegoProject;
    expect(piece(out, "a").shape?.size).toEqual([7, 4, 4]);
  });

  it("keeps unjoined children where they are in the world", () => {
    const project = unit([
      {
        id: "a",
        shape: shapeOf("wedge"),
        position: [1, 2, 3],
        rotation: [0.3, 0.5, 0.2],
      },
      {
        id: "kid",
        parentId: "a",
        shape: shapeOf("sphere"),
        position: [1, 2, 0],
      },
    ]);
    const before = world(project, "kid", [0, 0, 0]);
    const out = resizeShapeFace(project, PACK, "a", 1, 1, 9)
      ?.project as LegoProject;
    near(world(out, "kid", [0, 0, 0]), before);
    expect(piece(out, "kid").position).not.toEqual([1, 2, 0]);
  });

  it("lets a joined child follow its connection instead", () => {
    const project = unit([
      { id: "a", shape: { ...shapeOf("wedge") } },
      {
        id: "kid",
        parentId: "a",
        shape: { kind: "sphere", size: [2, 2, 2], swatch: "grey" },
        position: [0, 4, 0],
        connection: { connector: "-y", to: "+y" },
      },
    ]);
    const out = resizeShapeFace(project, PACK, "a", 1, 1, 8)
      ?.project as LegoProject;
    // The child sits on the middle of the wedge's slope, which is where the
    // wedge's "+y" connector now is.
    expect(piece(out, "a").position).toEqual([0, 1, 0]);
    const slope = shapeConnectors(piece(out, "a").shape as LegoShape).find(
      (c) => c.id === "+y",
    ) as LegoConnector;
    near(world(out, "kid", [0, -1, 0]), world(out, "a", slope.position));
  });

  it("keeps a joined piece on its join rather than the opposite face", () => {
    const project = unit([
      {
        id: "a",
        shape: { kind: "sphere", size: [4, 4, 4], swatch: "grey" },
      },
      {
        id: "kid",
        parentId: "a",
        shape: shapeOf("wedge"),
        position: [0, 2, 0],
        connection: { connector: "-y", to: "+y" },
      },
    ]);
    const out = resizeShapeFace(project, PACK, "kid", 1, 1, 10);
    expect(out).not.toBeNull();
    // Still on the sphere's top at y 2, so its bottom face has not moved.
    near(
      world(out?.project as LegoProject, "kid", [0, -5, 0]),
      new THREE.Vector3(0, 2, 0),
    );
  });

  it("slides custom anchors with the fixed face", () => {
    const project = unit([
      {
        id: "a",
        shape: shapeOf("wedge"),
        customAnchors: [{ name: "n", position: [0, 3, 0] }],
      } as Partial<LegoPiece>,
    ]);
    // The low face is dragged out, so the high face stays and the anchor with it.
    const out = resizeShapeFace(project, PACK, "a", 1, -1, 8)
      ?.project as LegoProject;
    expect(piece(out, "a").customAnchors?.[0].position).toEqual([0, 3 + 1, 0]);
  });

  it("is null for a size the shape already is", () => {
    const project = unit([{ id: "a", shape: shapeOf("wedge") }]);
    expect(resizeShapeFace(project, PACK, "a", 1, 1, 6)).toBeNull();
  });

  it("is null for a piece that is not a shape", () => {
    const project = unit([{ id: "a", partId: "x" }]);
    expect(resizeShapeFace(project, PACK, "a", 1, 1, 6)).toBeNull();
  });

  it("stops at the wall limit of a tube", () => {
    // Radius 2 with a hole of 1.5 is a wall of 0.5.
    const shape = shapeOf("tube", { inner: 1.5, axis: 1, sides: 12 });
    const project = unit([{ id: "a", shape }]);
    const out = resizeShapeFace(project, PACK, "a", 0, 1, 0.1)
      ?.project as LegoProject;
    const size = piece(out, "a").shape?.size as Vec3;
    expect(size[0]).toBeCloseTo(1 + MIN_SHAPE_SIZE);
    expect(size[0]).toBe(size[2]);
  });
});

describe("landSize", () => {
  const wedge = shapeOf("wedge", { low: 2, flip: 0 });

  it("lands on whole part units", () => {
    expect(landSize(wedge, 0, 1.3, 0.25)).toBe(1.25);
    expect(landSize(wedge, 0, 1.4, 0.25)).toBe(1.5);
  });

  it("lands where the pointer is when the step is off", () => {
    expect(landSize(wedge, 0, 1.3, null)).toBe(1.3);
  });

  it("never goes below one step, nor to zero or less", () => {
    expect(landSize(wedge, 0, 0, 0.25)).toBe(0.25);
    expect(landSize(wedge, 0, -4, 0.25)).toBe(0.25);
    expect(landSize(wedge, 0, 0, null)).toBe(MIN_SHAPE_SIZE);
    expect(landSize(wedge, 0, -4, null)).toBe(MIN_SHAPE_SIZE);
  });

  it("keeps a wedge as tall as its low end", () => {
    expect(lowestSize(wedge, 1)).toEqual({ value: 2, exclusive: false });
    expect(landSize(wedge, 1, 0.5, 0.25)).toBe(2);
    expect(landSize(wedge, 1, 0.5, null)).toBe(2);
  });

  it("keeps a tube's radius above its wall", () => {
    const tube = shapeOf("tube", { inner: 1.5, axis: 1, sides: 12 });
    expect(lowestSize(tube, 0)).toEqual({ value: 1, exclusive: true });
    // 1 itself is a wall as thick as the radius, so the next step up.
    expect(landSize(tube, 0, 0.2, 0.25)).toBe(1.25);
    expect(landSize(tube, 2, 0.2, null)).toBeCloseTo(1 + MIN_SHAPE_SIZE);
    // The length has no wall limit.
    expect(landSize(tube, 1, 0.2, 0.25)).toBe(0.25);
  });

  it("keeps a cone's bottom wider than its top", () => {
    const cone = shapeOf("cone", { top: 0.75, axis: 1, sides: 12 });
    expect(landSize(cone, 0, 0.5, 0.25)).toBe(1.75);
  });
});

describe("shapeReadout", () => {
  it("gives elmos and part units", () => {
    expect(shapeReadout(1.5, 0.25)).toBe("1.5 elmos, 6 units");
  });
});
