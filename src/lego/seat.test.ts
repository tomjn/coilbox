import { describe, expect, it } from "vitest";

import { resolveConnections } from "./connectors";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import type { LegoPartInfo, LoadedPack } from "./pack";
import { worldMatrix } from "./reparent";
import { dragPiece, freeMoved, type Seat } from "./seat";

type Vec3 = [number, number, number];

function part(id: string, min: Vec3, max: Vec3): LegoPartInfo {
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
  };
}

function pack(): LoadedPack {
  const parts = [
    part("hull", [-1, -0.5, -2], [1, 0.5, 2]),
    part("leg", [-0.25, -1, -0.25], [0.25, 1, 0.25]),
  ];
  return {
    manifest: {} as LoadedPack["manifest"],
    library: { packs: [], atlases: [], dir: "", problems: [] },
    parts,
    byId: new Map(parts.map((p) => [p.id, p])),
    vertices: new Float32Array(),
    indices: new Uint16Array(),
  } as unknown as LoadedPack;
}

function project(pieces: Partial<LegoPiece>[]): LegoProject {
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
      ...pieces.map((piece) => ({
        id: "x",
        name: piece.id ?? "x",
        parentId: "root",
        partId: null,
        position: [0, 0, 0] as Vec3,
        rotation: [0, 0, 0] as Vec3,
        scale: [1, 1, 1] as Vec3,
        ...piece,
      })),
    ],
  };
}

function pieceOf(doc: LegoProject, id: string): LegoPiece {
  return doc.pieces.find((piece) => piece.id === id) as LegoPiece;
}

const SEAT: Seat = { parentId: "hull", connector: "-y", to: "+y" };

/** A leg dropped with its bottom on the hull's top, and a second hull beside. */
const scene = () =>
  project([
    { id: "hull", partId: "hull" },
    { id: "other", partId: "hull", position: [5, 0, 0] },
    { id: "leg", partId: "leg", position: [0, 1.5, 0] },
  ]);

const dropped = (position: Vec3, rotation: Vec3 = [0, 0, 0]) => ({
  position,
  rotation,
  scale: [1, 1, 1] as Vec3,
});

function worldOf(doc: LegoProject, id: string): number[] {
  return worldMatrix(doc, id)
    .toArray()
    .map((n) => Number(n.toFixed(6)) + 0);
}

describe("dragPiece with a seat", () => {
  it("hangs the piece off the one it seated against, without moving it", () => {
    const before = scene();
    const doc = dragPiece(before, pack(), "leg", dropped([0, 1.5, 0]), SEAT);

    expect(pieceOf(doc, "leg").parentId).toBe("hull");
    expect(pieceOf(doc, "leg").connection).toEqual({
      connector: "-y",
      to: "+y",
    });
    expect(worldOf(doc, "leg")).toEqual(worldOf(before, "leg"));
  });

  it("leaves the piece where it was dropped once the join is resolved", () => {
    const doc = dragPiece(scene(), pack(), "leg", dropped([0, 1.5, 0]), SEAT);

    expect(resolveConnections(doc, pack()).project).toBe(doc);
  });

  it("keeps the turn it was dropped with as a twist", () => {
    const quarter = Math.PI / 2;
    const turned = dropped([0, 1.5, 0], [0, quarter, 0]);
    const doc = dragPiece(scene(), pack(), "leg", turned, SEAT);

    expect(pieceOf(doc, "leg").connection?.twist).toBeCloseTo(quarter);
    const free = dragPiece(scene(), pack(), "leg", turned, null);
    const resolved = resolveConnections(doc, pack()).project;
    expect(worldOf(resolved, "leg")).toEqual(worldOf(free, "leg"));
  });

  it("replaces a join to a different parent", () => {
    const joined = dragPiece(
      scene(),
      pack(),
      "leg",
      dropped([0, 1.5, 0]),
      SEAT,
    );
    const doc = dragPiece(joined, pack(), "leg", dropped([5, 1.5, 0]), {
      parentId: "other",
      connector: "-y",
      to: "+y",
    });

    expect(pieceOf(doc, "leg").parentId).toBe("other");
    expect(pieceOf(doc, "leg").connection).toEqual({
      connector: "-y",
      to: "+y",
    });
    expect(worldOf(doc, "leg").slice(12, 15)).toEqual([5, 1.5, 0]);
  });

  it("leaves a piece free when the parent cannot carry it", () => {
    const doc = dragPiece(scene(), pack(), "leg", dropped([0, 1.5, 0]), {
      parentId: "leg",
      connector: "-y",
      to: "+y",
    });

    expect(pieceOf(doc, "leg").connection).toBeUndefined();
    expect(pieceOf(doc, "leg").parentId).toBe("root");
  });
});

describe("dragPiece without a seat", () => {
  const joined = () =>
    dragPiece(scene(), pack(), "leg", dropped([0, 1.5, 0]), SEAT);

  it("frees a joined piece that was moved, where it was dropped", () => {
    const doc = dragPiece(joined(), pack(), "leg", dropped([0, 3, 0]), null);

    expect(pieceOf(doc, "leg").connection).toBeUndefined();
    expect(pieceOf(doc, "leg").position).toEqual([0, 3, 0]);
    expect(pieceOf(doc, "leg").parentId).toBe("hull");
    expect(resolveConnections(doc, pack()).project).toBe(doc);
  });

  it("frees a joined piece that was turned", () => {
    const doc = dragPiece(
      joined(),
      pack(),
      "leg",
      dropped([0, 1.5, 0], [0, 0.3, 0]),
      null,
    );

    expect(pieceOf(doc, "leg").connection).toBeUndefined();
  });

  it("keeps the join of a piece that only changed size", () => {
    const doc = dragPiece(
      joined(),
      pack(),
      "leg",
      { ...dropped([0, 1.5, 0]), scale: [2, 2, 2] },
      null,
    );

    expect(pieceOf(doc, "leg").connection).toBeDefined();
    expect(pieceOf(doc, "leg").scale).toEqual([2, 2, 2]);
  });

  it("keeps the join of a piece that did not move", () => {
    const start = joined();
    const piece = pieceOf(start, "leg");
    const doc = dragPiece(
      start,
      pack(),
      "leg",
      dropped(piece.position, piece.rotation),
      null,
    );

    expect(pieceOf(doc, "leg").connection).toBeDefined();
  });
});

describe("dragPiece with a slide", () => {
  const joined = () =>
    dragPiece(scene(), pack(), "leg", dropped([0, 1.5, 0]), SEAT);

  it("keeps the join and saves the new offset", () => {
    const doc = dragPiece(
      joined(),
      pack(),
      "leg",
      dropped([0.5, 1.5, 0.25]),
      null,
      [0.5, 0.25],
    );

    expect(pieceOf(doc, "leg").connection).toEqual({
      connector: "-y",
      to: "+y",
      offset: [0.5, 0.25],
    });
    expect(pieceOf(doc, "leg").position).toEqual([0.5, 1.5, 0.25]);
    expect(resolveConnections(doc, pack()).project).toBe(doc);
  });

  it("keeps a twist the join already had", () => {
    const start = joined();
    const twisted = {
      ...start,
      pieces: start.pieces.map((p) =>
        p.id === "leg" && p.connection
          ? { ...p, connection: { ...p.connection, twist: 0.5 } }
          : p,
      ),
    };
    const doc = dragPiece(
      twisted,
      pack(),
      "leg",
      dropped([0.5, 1.5, 0]),
      null,
      [0.5, 0],
    );

    expect(pieceOf(doc, "leg").connection?.twist).toBe(0.5);
  });

  it("is ignored for a drag that seats against another piece", () => {
    const doc = dragPiece(
      joined(),
      pack(),
      "leg",
      dropped([5, 1.5, 0]),
      { parentId: "other", connector: "-y", to: "+y" },
      [9, 9],
    );

    expect(pieceOf(doc, "leg").connection?.offset).toBeUndefined();
  });
});

describe("freeMoved", () => {
  it("frees only the joined pieces a group drag moved", () => {
    const start = dragPiece(scene(), pack(), "leg", dropped([0, 1.5, 0]), SEAT);
    const moved = {
      ...start,
      pieces: start.pieces.map((p) =>
        p.id === "leg" ? { ...p, position: [0, 9, 0] as Vec3 } : p,
      ),
    };

    expect(pieceOf(freeMoved(start, moved), "leg").connection).toBeUndefined();
    expect(freeMoved(start, start)).toBe(start);
  });
});
