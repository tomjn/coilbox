import { describe, expect, it } from "vitest";

import type { LegoConnector } from "./connectors";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import type { LegoPartInfo, LoadedPack } from "./pack";
import { swapPart, variantsFirst } from "./swapPart";

type Vec3 = [number, number, number];

function part(
  id: string,
  min: Vec3,
  max: Vec3,
  extra: Partial<LegoPartInfo> = {},
): LegoPartInfo {
  return {
    id,
    packId: "lego",
    shapeId: id,
    name: id,
    category: "grey",
    colourway: "grey",
    shape: "block",
    material: "metal",
    tags: [],
    vFirst: 0,
    vCount: 0,
    iFirst: 0,
    iCount: 0,
    bbox: { min, max },
    uvBox: { min: [0, 0], max: [1, 1] },
    pivot: [0, 0, 0],
    sourceNames: [],
    aliasCount: 0,
    ...extra,
  };
}

function connector(id: string, position: Vec3, facing: Vec3): LegoConnector {
  return { id, position, facing, up: facing[1] === 0 ? [0, 1, 0] : [0, 0, 1] };
}

/**
 * A hull 4 long, a longer hull 6 long, a green copy of the hull, a leg 2 high
 * and a leg 4 high, and two parts that state connectors under their own names.
 */
function pack(): LoadedPack {
  const parts = [
    part("hull", [-1, -0.5, -2], [1, 0.5, 2], { shapeId: "hull" }),
    part("hull-green", [-1, -0.5, -2], [1, 0.5, 2], {
      shapeId: "hull",
      colourway: "green",
    }),
    part("hull-long", [-1, -0.5, -3], [1, 0.5, 3]),
    part("leg", [-0.25, -1, -0.25], [0.25, 1, 0.25]),
    part("leg-long", [-0.25, -2, -0.25], [0.25, 2, 0.25]),
    part("blank", [-1, -1, -1], [1, 1, 1], { connectors: [] }),
    part("socket-a", [-1, -1, -1], [1, 1, 1], {
      connectors: [connector("hinge", [1, 0, 0], [1, 0, 0])],
    }),
    part("socket-b", [-2, -1, -1], [2, 1, 1], {
      connectors: [connector("pin", [2, 0, 0], [1, 0, 0])],
    }),
  ];
  return {
    manifest: {} as LoadedPack["manifest"],
    library: { packs: [], atlases: [], dir: "", problems: [] },
    parts,
    byId: new Map(parts.map((p) => [p.id, p])),
    vertices: new Float32Array(),
    indices: new Uint16Array(),
  } as LoadedPack;
}

function unit(pieces: Partial<LegoPiece>[]): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "walker",
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
            parentId: "root",
            partId: "hull",
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
            name: piece.id,
            ...piece,
          }) as LegoPiece,
      ),
    ],
  };
}

function of(doc: LegoProject, id: string): LegoPiece {
  return doc.pieces.find((p) => p.id === id) as LegoPiece;
}

function round(values: number[]): number[] {
  return values.map((n) => Number(n.toFixed(6)) + 0);
}

describe("swapPart", () => {
  it("changes the colour and nothing else", () => {
    const doc = unit([
      {
        id: "hull",
        name: "body",
        role: "chassis",
        tags: ["a"],
        hidden: true,
        position: [1, 2, 3],
      },
    ]);
    const result = swapPart(doc, pack(), "hull", "hull-green");
    expect(result?.project.pieces).toEqual(
      doc.pieces.map((p) =>
        p.id === "hull" ? { ...p, partId: "hull-green" } : p,
      ),
    );
  });

  it("moves a joined child out to the face of a longer part", () => {
    const doc = unit([
      { id: "hull" },
      {
        id: "tail",
        parentId: "hull",
        partId: "leg",
        connection: { connector: "-y", to: "+z" },
      },
    ]);
    const result = swapPart(doc, pack(), "hull", "hull-long");
    // The face moves from z = 2 to z = 3, and the leg is 2 long, so its middle
    // stands 1 beyond the face.
    expect(round(of(result?.project as LegoProject, "tail").position)[2]).toBe(
      4,
    );
    expect(of(result?.project as LegoProject, "tail").connection).toEqual({
      connector: "-y",
      to: "+z",
    });
    expect(result?.broken).toEqual([]);
  });

  it("keeps the piece on its parent's connector when the parent is swapped", () => {
    const doc = unit([
      { id: "hull" },
      {
        id: "leg",
        parentId: "hull",
        partId: "leg",
        connection: { connector: "-y", to: "+y" },
      },
    ]);
    const before = of(doc, "leg");
    const result = swapPart(doc, pack(), "leg", "leg-long");
    const leg = of(result?.project as LegoProject, "leg");
    expect(leg.connection).toEqual(before.connection);
    // A leg 4 high stands with its middle 2 above the hull's top at 0.5.
    expect(round(leg.position)).toEqual([0, 2.5, 0]);
  });

  it("keeps a pivot on the same named place", () => {
    const doc = unit([
      { id: "leg", partId: "leg", pivot: [0, 1, 0], position: [0, 5, 0] },
    ]);
    const result = swapPart(doc, pack(), "leg", "leg-long");
    const leg = of(result?.project as LegoProject, "leg");
    expect(leg.pivot).toEqual([0, 2, 0]);
    expect(leg.position).toEqual([0, 5, 0]);
  });

  it("keeps a pivot that has no name at the same fraction of the box", () => {
    const doc = unit([{ id: "leg", partId: "leg", pivot: [0, 0.5, 0] }]);
    const result = swapPart(doc, pack(), "leg", "leg-long");
    expect(of(result?.project as LegoProject, "leg").pivot).toEqual([0, 1, 0]);
  });

  it("leaves a piece with no pivot without one", () => {
    const doc = unit([{ id: "leg", partId: "leg" }]);
    const result = swapPart(doc, pack(), "leg", "leg-long");
    expect(of(result?.project as LegoProject, "leg").pivot).toBeUndefined();
  });

  it("keeps anchors inside the new box and drops the rest", () => {
    const doc = unit([
      {
        id: "leg",
        partId: "leg-long",
        customAnchors: [
          { id: "a", name: "foot", position: [0, -1.5, 0] },
          { id: "b", name: "knee", position: [0, 0, 0] },
        ],
      },
    ]);
    const result = swapPart(doc, pack(), "leg", "leg");
    expect(
      of(result?.project as LegoProject, "leg").customAnchors?.map((a) => a.id),
    ).toEqual(["b"]);
    expect(result?.droppedAnchors).toEqual(["foot"]);
  });

  it("leaves a join whose connector is gone where it was, and says so", () => {
    const doc = unit([
      { id: "hull" },
      {
        id: "leg",
        parentId: "hull",
        partId: "leg",
        position: [0, 1.5, 0],
        connection: { connector: "-y", to: "+y" },
      },
    ]);
    const result = swapPart(doc, pack(), "leg", "blank");
    const leg = of(result?.project as LegoProject, "leg");
    expect(leg.position).toEqual([0, 1.5, 0]);
    expect(leg.connection).toEqual({ connector: "-y", to: "+y" });
    expect(result?.broken).toEqual(["leg"]);
  });

  it("joins by the connector that faces the same way when the id is gone", () => {
    const doc = unit([
      { id: "plate", partId: "socket-a" },
      {
        id: "arm",
        parentId: "plate",
        partId: "leg",
        connection: { connector: "-y", to: "hinge" },
      },
    ]);
    const result = swapPart(doc, pack(), "plate", "socket-b");
    const arm = of(result?.project as LegoProject, "arm");
    expect(arm.connection).toEqual({ connector: "-y", to: "pin" });
    // The pin is at x = 2 and the arm is 2 long, so its middle is at x = 3.
    expect(round(arm.position)[0]).toBe(3);
    expect(result?.broken).toEqual([]);
  });

  it("remaps the swapped piece's own connector by facing too", () => {
    const doc = unit([
      { id: "plate" },
      {
        id: "knob",
        parentId: "plate",
        partId: "socket-a",
        connection: { connector: "hinge", to: "+x" },
      },
    ]);
    const result = swapPart(doc, pack(), "knob", "socket-b");
    expect(of(result?.project as LegoProject, "knob").connection).toEqual({
      connector: "pin",
      to: "+x",
    });
    expect(result?.broken).toEqual([]);
  });

  it("does not report a join that was already broken", () => {
    const doc = unit([
      { id: "hull" },
      {
        id: "leg",
        parentId: "hull",
        partId: "leg",
        connection: { connector: "gone", to: "+y" },
      },
    ]);
    expect(swapPart(doc, pack(), "hull", "hull-long")?.broken).toEqual([]);
  });

  it("refuses what has no part to swap", () => {
    const doc = unit([
      { id: "empty", partId: null },
      { id: "scanned", partId: null, meshId: "m" },
      { id: "hull" },
    ]);
    expect(swapPart(doc, pack(), "empty", "leg")).toBeNull();
    expect(swapPart(doc, pack(), "scanned", "leg")).toBeNull();
    expect(swapPart(doc, pack(), "hull", "missing")).toBeNull();
    expect(swapPart(doc, pack(), "hull", "hull")).toBeNull();
    expect(swapPart(doc, pack(), "nobody", "leg")).toBeNull();
  });
});

describe("variantsFirst", () => {
  it("puts the other colours of a shape ahead of the rest, in order", () => {
    const p = pack();
    const current = p.byId.get("hull") as LegoPartInfo;
    const ids = variantsFirst(p, current, p.parts).map((x) => x.id);
    expect(ids.slice(0, 1)).toEqual(["hull-green"]);
    expect(ids).not.toContain("hull");
    expect(ids).toHaveLength(p.parts.length - 1);
  });
});
