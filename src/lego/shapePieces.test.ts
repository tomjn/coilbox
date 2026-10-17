/**
 * A generated shape (#3325) is a piece like any other: the bake, the checks
 * that read geometry, the connectors and every way a piece is copied see it.
 */

import { describe, expect, it } from "vitest";
import { parseClipboardPiece, serializeClipboardPiece } from "./clipboard";
import { duplicatePiece, insertCompound } from "./compounds";
import { boxConnectors, pieceConnectors, pieceOwnBox } from "./connectors";
import { mirrorCopy } from "./mirror";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import { moduleShareCode, readSharedModule } from "./moduleShare";
import { checkOverlap } from "./overlap";
import type { LoadedPack } from "./pack";
import { pivotChoices } from "./pivot";
import { bakedPieces, pieceBoxes } from "./s3oBuild";
import { type LegoShape, shapeBox, shapeMesh } from "./shapes";

type Vec3 = [number, number, number];

/** A pack with no parts: every piece below is a shape. */
function pack(): LoadedPack {
  return {
    manifest: {} as LoadedPack["manifest"],
    library: {
      packs: [],
      atlases: [{ tex1: "atlas.png", packId: "lego", folder: null }],
      dir: "",
      problems: [],
    },
    parts: [],
    byId: new Map(),
    vertices: new Float32Array(),
    indices: new Uint16Array(),
  };
}

function cylinder(size: Vec3): LegoShape {
  return { kind: "cylinder", size, swatch: "grey" };
}

function project(pieces: (Partial<LegoPiece> & { id: string })[]) {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "roller",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  return {
    ...base,
    pieces: [
      ...base.pieces,
      ...pieces.map((piece) => ({
        name: piece.id,
        parentId: "root",
        partId: null,
        position: [0, 0, 0] as Vec3,
        rotation: [0, 0, 0] as Vec3,
        scale: [1, 1, 1] as Vec3,
        ...piece,
      })),
    ],
  } satisfies LegoProject;
}

function counter() {
  let n = 0;
  return () => `new${n++}`;
}

describe("a shape in the bake", () => {
  it("bakes the shape's mesh, where the piece is", () => {
    const unit = project([
      { id: "wheel", shape: cylinder([2, 1, 2]), position: [5, 0, 0] },
    ]);
    const baked = bakedPieces(unit, pack(), null).pieces.get("wheel");
    expect(baked?.vertices).toHaveLength(
      shapeMesh(cylinder([2, 1, 2]))?.vCount ?? -1,
    );
    const box = pieceBoxes(unit, pack(), null, ["wheel"]).get("wheel");
    expect(box?.min[0]).toBeCloseTo(4, 6);
    expect(box?.max[0]).toBeCloseTo(6, 6);
    expect(box?.min[1]).toBeCloseTo(-0.5, 6);
    expect(box?.max[1]).toBeCloseTo(0.5, 6);
  });

  it("reverses the winding of a mirrored shape", () => {
    const plain = project([{ id: "wheel", shape: cylinder([2, 1, 2]) }]);
    const mirrored = project([
      { id: "wheel", shape: cylinder([2, 1, 2]), scale: [-1, 1, 1] },
    ]);
    const a = bakedPieces(plain, pack(), null).pieces.get("wheel")?.indices;
    const b = bakedPieces(mirrored, pack(), null).pieces.get("wheel")?.indices;
    expect(b?.slice(0, 3)).toEqual([a?.[0], a?.[2], a?.[1]]);
  });

  it("bakes nothing for a kind this build does not know", () => {
    const unit = project([
      {
        id: "odd",
        shape: { kind: "torus", size: [1, 1, 1], swatch: "grey" },
      },
    ]);
    expect(bakedPieces(unit, pack(), null).pieces.get("odd")?.vertices).toEqual(
      [],
    );
  });

  it("is a closed solid the overlap check can bury a piece in", () => {
    const unit = project([
      { id: "drum", shape: cylinder([4, 4, 4]) },
      { id: "core", shape: cylinder([1, 1, 1]) },
    ]);
    const result = checkOverlap(unit, pack(), null);
    expect(result.checked).toBe(2);
    expect(result.buried.map((b) => [b.id, b.holderId])).toEqual([
      ["core", "drum"],
    ]);
  });
});

describe("a shape's box", () => {
  it("gives the shape box connectors from its size", () => {
    const piece = project([{ id: "wheel", shape: cylinder([2, 1, 2]) }])
      .pieces[1];
    const box = shapeBox(cylinder([2, 1, 2]));
    expect(pieceOwnBox(pack(), piece)).toEqual(box);
    expect(pieceConnectors(pack(), piece)).toEqual(
      boxConnectors(box as NonNullable<typeof box>),
    );
  });

  it("offers pivots on the shape's faces", () => {
    const piece = project([{ id: "wheel", shape: cylinder([2, 1, 2]) }])
      .pieces[1];
    const bbox = pieceOwnBox(pack(), piece);
    const top = pivotChoices({ bbox: bbox as NonNullable<typeof bbox> }).find(
      (choice) => choice.id === "top",
    );
    expect(top?.position).toEqual([0, 0.5, 0]);
  });

  it("has no box or connectors for a kind this build does not know", () => {
    const piece = project([
      {
        id: "odd",
        shape: { kind: "torus", size: [1, 1, 1], swatch: "grey" },
      },
    ]).pieces[1];
    expect(pieceOwnBox(pack(), piece)).toBeUndefined();
    expect(pieceConnectors(pack(), piece)).toEqual([]);
  });
});

describe("copies of a shape keep it", () => {
  const shape = cylinder([2, 3, 2]);
  const unit = project([{ id: "barrel", shape }]);
  const shapesIn = (p: LegoProject) =>
    p.pieces.filter((piece) => piece.shape).map((piece) => piece.shape);

  it("survives copy and paste", () => {
    const parsed = parseClipboardPiece(
      serializeClipboardPiece(unit),
      new Set(),
    );
    expect(parsed.ok && shapesIn(parsed.piece.project)).toEqual([shape]);
  });

  it("survives duplicate", () => {
    const out = duplicatePiece(unit, "barrel", {
      now: "2026-10-17T00:00:00Z",
      newId: counter(),
    });
    expect(out && shapesIn(out.project)).toEqual([shape, shape]);
  });

  it("survives a mirrored copy", () => {
    const out = mirrorCopy(unit, "barrel", counter());
    expect(out && shapesIn(out.project)).toEqual([shape, shape]);
  });

  it("survives going in as a module", () => {
    const into = project([]);
    const out = insertCompound(into, unit, "root", counter(), true);
    expect(shapesIn(out.project)).toEqual([shape]);
  });

  it("survives a shared module code", () => {
    const made = moduleShareCode(unit);
    if (!made.ok) throw new Error(made.reason);
    const read = readSharedModule(made.code, new Set());
    expect(read.ok && shapesIn(read.project)).toEqual([shape]);
  });
});
