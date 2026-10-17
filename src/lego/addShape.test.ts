import { describe, expect, it } from "vitest";

import { addShape } from "./addShape";
import { type LegoProject, newProject } from "./model";
import type { LegoPartInfo, LoadedPack } from "./pack";
import { roundNumbers } from "./roundShape";
import { SHAPE_KINDS, type ShapeKind } from "./shapes";
import { wedgeNumbers } from "./wedgeShape";

const SWATCHES = ["green", "tan", "grey"].map((id) => ({
  id,
  uv: { min: [0, 0] as [number, number], max: [0.1, 0.1] as [number, number] },
  tile: 1.56,
}));

function pack(swatches = SWATCHES): Pick<LoadedPack, "manifest" | "byId"> {
  const parts = [
    { id: "g", colourway: "green" },
    { id: "t", colourway: "tan" },
  ] as LegoPartInfo[];
  return {
    manifest: { swatches } as LoadedPack["manifest"],
    byId: new Map(parts.map((part) => [part.id, part])),
  };
}

function unit(partIds: string[] = []): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "unit",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  return {
    ...base,
    pieces: [
      ...base.pieces,
      ...partIds.map((partId, i) => ({
        id: `p${i}`,
        name: `p${i}`,
        parentId: "root",
        partId,
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
      })),
    ],
  };
}

const kindOf = (id: string): ShapeKind => {
  const info = SHAPE_KINDS.find((candidate) => candidate.id === id);
  if (!info) throw new Error(`no ${id}`);
  return info;
};

function added(
  kind: string,
  project = unit(),
  swatches = SWATCHES,
  parentId = "root",
) {
  const next = addShape(
    project,
    kindOf(kind),
    pack(swatches),
    parentId,
    "new1",
  );
  return next?.pieces.find((piece) => piece.id === "new1");
}

describe("addShape", () => {
  it("adds a piece with the kind and its default numbers under the parent", () => {
    expect(added("cylinder")).toMatchObject({
      parentId: "root",
      partId: null,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      shape: { kind: "cylinder", size: [1, 1, 1] },
    });
  });

  it("copies the size and options, so editing the piece cannot change the default", () => {
    const piece = added("tube");
    expect(piece?.shape?.size).not.toBe(kindOf("tube").size);
    expect(piece?.shape?.options).not.toBe(kindOf("tube").options);
  });

  it("makes an upright cylinder, a tube with a wall and a pure wedge", () => {
    const tube = added("tube")?.shape;
    expect(tube && roundNumbers(tube)).toMatchObject({
      axis: 1,
      radius: 0.5,
      length: 1,
      wall: 0.25,
    });
    const wedge = added("wedge")?.shape;
    expect(wedge && wedgeNumbers(wedge)).toMatchObject({
      low: 0,
      flip: false,
    });
  });

  it("makes a cone that starts as a point", () => {
    const cone = added("cone")?.shape;
    expect(cone && roundNumbers(cone)).toMatchObject({
      axis: 1,
      radius: 0.5,
      length: 1,
      top: 0,
    });
  });

  it("makes a sphere whole and a dome half as tall, both of the sphere kind", () => {
    const ball = added("sphere")?.shape;
    const half = added("dome")?.shape;
    expect([ball?.kind, ball?.size, ball?.options?.keep]).toEqual([
      "sphere",
      [1, 1, 1],
      0,
    ]);
    expect([half?.kind, half?.size, half?.options?.keep]).toEqual([
      "sphere",
      [1, 0.5, 1],
      1,
    ]);
  });

  it("names a dome after its entry, not its kind", () => {
    expect(added("dome")?.name).toBe("dome");
  });

  it("takes the colourway most of the unit's parts use", () => {
    expect(added("cylinder", unit(["t", "g", "t"]))?.shape?.swatch).toBe("tan");
  });

  it("takes the first swatch when no part has one", () => {
    expect(added("cylinder")?.shape?.swatch).toBe("green");
  });

  it("adds nothing when the pack lists no swatches", () => {
    expect(
      addShape(unit(), kindOf("tube"), pack([]), "root", "new1"),
    ).toBeNull();
  });

  it("names pieces after the kind and keeps the names unique", () => {
    const once = addShape(unit(), kindOf("cylinder"), pack(), "root", "a");
    if (!once) throw new Error("no project");
    const twice = addShape(once, kindOf("cylinder"), pack(), "a", "b");
    expect(twice?.pieces.filter((p) => p.shape).map((p) => p.name)).toEqual([
      "cylinder",
      "cylinder2",
    ]);
  });

  it("turns a round shape under a wheel to spin about its axle", () => {
    const base = unit();
    const withWheel: LegoProject = {
      ...base,
      pieces: [
        ...base.pieces,
        {
          id: "w",
          name: "wheel",
          parentId: "root",
          partId: null,
          role: "wheel",
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      ],
    };
    expect(added("cylinder", withWheel, SWATCHES, "w")?.rotation).not.toEqual([
      0, 0, 0,
    ]);
    expect(added("cylinder", withWheel, SWATCHES, "root")?.rotation).toEqual([
      0, 0, 0,
    ]);
  });
});
