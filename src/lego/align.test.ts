import { describe, expect, it } from "vitest";

import {
  alignOffsets,
  boxesOrOrigins,
  distributeOffsets,
  moveByOffsets,
} from "./align";
import { applyGroupTransform } from "./groupTransform";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import type { LegoPartInfo, LoadedPack } from "./pack";
import { worldMatrix } from "./reparent";
import { type PieceBox, pieceBoxes } from "./s3oBuild";

/** One triangle: a metre along x, two up y, a metre along z. */
function pack(): LoadedPack {
  const part: LegoPartInfo = {
    id: "tri",
    packId: "lego",
    shapeId: "tri",
    name: "tri",
    category: "grey",
    colourway: "grey",
    shape: "tri",
    material: "metal",
    tags: [],
    vFirst: 0,
    vCount: 3,
    iFirst: 0,
    iCount: 3,
    bbox: { min: [0, 0, 0], max: [1, 2, 1] },
    uvBox: { min: [0, 0], max: [1, 1] },
    pivot: [0, 0, 0],
    sourceNames: [],
    aliasCount: 0,
  };
  const vertices = new Float32Array([
    0, 0, 0, 0, 1, 0, 0, 0, 1, 2, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1,
  ]);
  return {
    manifest: {} as LoadedPack["manifest"],
    library: { packs: [], atlases: [], dir: "", problems: [] },
    parts: [part],
    byId: new Map([["tri", part]]),
    vertices,
    indices: new Uint16Array([0, 1, 2]),
  };
}

function piece(
  id: string,
  parentId: string,
  position: [number, number, number],
  extra: Partial<LegoPiece> = {},
): LegoPiece {
  return {
    id,
    name: id,
    parentId,
    partId: "tri",
    position,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...extra,
  };
}

function build(pieces: LegoPiece[]): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "probe",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  return { ...base, pieces: [...base.pieces, ...pieces] };
}

function boxesOf(project: LegoProject, ids: string[]) {
  return pieceBoxes(project, pack(), null, ids);
}

function worldAt(project: LegoProject, id: string): number[] {
  const m = worldMatrix(project, id).elements;
  return [m[12], m[13], m[14]];
}

function box(min: number[], max: number[]): PieceBox {
  return { min: min as PieceBox["min"], max: max as PieceBox["max"] };
}

describe("pieceBoxes", () => {
  it("measures a piece with everything under it, in the unit's space", () => {
    const project = build([
      piece("hull", "root", [0, 1, 0]),
      piece("gun", "hull", [3, 0, 0]),
    ]);
    const boxes = boxesOf(project, ["hull", "gun"]);
    expect(boxes.get("hull")).toEqual(box([0, 1, 0], [4, 3, 1]));
    expect(boxes.get("gun")).toEqual(box([3, 1, 0], [4, 3, 1]));
  });

  it("leaves out a piece with no geometry anywhere under it", () => {
    const project = build([
      piece("flare", "root", [5, 0, 0], { partId: null }),
    ]);
    expect(boxesOf(project, ["flare"]).has("flare")).toBe(false);
  });

  it("measures a mirrored piece by where its points are", () => {
    const project = build([
      piece("m", "root", [0, 0, 0], { scale: [1, -1, 1] }),
    ]);
    expect(boxesOf(project, ["m"]).get("m")).toEqual(
      box([0, -2, 0], [1, 0, 1]),
    );
  });
});

describe("boxesOrOrigins", () => {
  it("uses the origin for a piece with no box", () => {
    const out = boxesOrOrigins(new Map(), new Map([["a", [1, 2, 3]]]), ["a"]);
    expect(out.get("a")).toEqual(box([1, 2, 3], [1, 2, 3]));
  });
});

describe("alignOffsets", () => {
  const boxes = new Map([
    ["a", box([0, 0, 0], [2, 1, 1])],
    ["b", box([5, 0, 0], [6, 4, 1])],
  ]);

  it("lines up the lowest edges", () => {
    const o = alignOffsets(boxes, "x", "low");
    expect(o.get("a")).toEqual([0, 0, 0]);
    expect(o.get("b")).toEqual([-5, 0, 0]);
  });

  it("lines up the highest edges", () => {
    const o = alignOffsets(boxes, "y", "high");
    expect(o.get("a")).toEqual([0, 3, 0]);
    expect(o.get("b")).toEqual([0, 0, 0]);
  });

  it("lines up the middles on the middle of the whole selection", () => {
    const o = alignOffsets(boxes, "x", "middle");
    // The set spans 0 to 6, so its middle is 3. a is centred on 1, b on 5.5.
    expect(o.get("a")).toEqual([2, 0, 0]);
    expect(o.get("b")).toEqual([-2.5, 0, 0]);
  });
});

describe("distributeOffsets", () => {
  it("makes the gaps between faces equal and keeps the ends", () => {
    const boxes = new Map([
      ["a", box([0, 0, 0], [1, 1, 1])],
      ["long", box([1, 0, 0], [5, 1, 1])],
      ["short", box([6, 0, 0], [7, 1, 1])],
      ["z", box([10, 0, 0], [11, 1, 1])],
    ]);
    const o = distributeOffsets(boxes, "x");
    // Sizes 1 + 4 + 1 + 1 = 7 in a span of 11, so three gaps of 4/3.
    expect(o.has("a")).toBe(false);
    expect(o.has("z")).toBe(false);
    const gap = 4 / 3;
    expect(o.get("long")?.[0]).toBeCloseTo(1 + gap - 1);
    expect(o.get("short")?.[0]).toBeCloseTo(1 + gap + 4 + gap - 6);
  });

  it("does nothing for fewer than three", () => {
    const boxes = new Map([
      ["a", box([0, 0, 0], [1, 1, 1])],
      ["b", box([4, 0, 0], [5, 1, 1])],
    ]);
    expect(distributeOffsets(boxes, "x").size).toBe(0);
  });

  it("orders by position and not by selection order", () => {
    const boxes = new Map([
      ["far", box([10, 0, 0], [11, 1, 1])],
      ["mid", box([1, 0, 0], [2, 1, 1])],
      ["near", box([0, 0, 0], [1, 1, 1])],
    ]);
    const o = distributeOffsets(boxes, "x");
    expect(o.get("mid")?.[0]).toBeCloseTo(4);
  });
});

describe("applied to a document", () => {
  it("moves a piece with its children and not its siblings", () => {
    const project = build([
      piece("a", "root", [0, 0, 0]),
      piece("b", "root", [0, 5, 0]),
      piece("bChild", "b", [0, 1, 0]),
      piece("bystander", "root", [9, 9, 9]),
    ]);
    const boxes = boxesOf(project, ["a", "b"]);
    const changes = moveByOffsets(project, alignOffsets(boxes, "y", "low"));
    const after = applyGroupTransform(project, changes);
    expect(worldAt(after, "b")).toEqual([0, 0, 0]);
    expect(worldAt(after, "bChild")).toEqual([0, 1, 0]);
    expect(worldAt(after, "bystander")).toEqual([9, 9, 9]);
    expect(changes.has("a")).toBe(false);
  });

  it("works through a turned parent", () => {
    const project = build([
      piece("arm", "root", [0, 0, 0], { rotation: [0, Math.PI / 2, 0] }),
      piece("hand", "arm", [4, 0, 0]),
      piece("foot", "root", [0, 3, 0]),
    ]);
    const boxes = boxesOf(project, ["hand", "foot"]);
    const after = applyGroupTransform(
      project,
      moveByOffsets(project, alignOffsets(boxes, "y", "low")),
    );
    const out = boxesOf(after, ["hand", "foot"]);
    expect(out.get("foot")?.min[1]).toBeCloseTo(out.get("hand")?.min[1] ?? NaN);
  });
});
