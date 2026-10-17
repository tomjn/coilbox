/**
 * Typing a transform onto a joined piece, or turning it, edits the join or
 * frees the piece. It is never undone by the join (issue #4281).
 */

import { describe, expect, it } from "vitest";

import { resolveConnections } from "./connectors";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import type { LegoPartInfo, LoadedPack } from "./pack";
import { worldMatrix } from "./reparent";
import { dragPiece, type Seat, typedJoinedTransform } from "./seat";

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
  } as LegoPartInfo;
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

/** A leg standing on the hull's top face, joined by its bottom. */
const joined = () =>
  dragPiece(
    project([
      { id: "hull", partId: "hull" },
      { id: "leg", partId: "leg", position: [0, 1.5, 0] },
    ]),
    pack(),
    "leg",
    { position: [0, 1.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    SEAT,
  );

const QUARTER = Math.PI / 2;

function worldOf(doc: LegoProject, id: string): number[] {
  return worldMatrix(doc, id)
    .toArray()
    .map((n) => Number(n.toFixed(6)) + 0);
}

describe("typing a position onto a joined piece", () => {
  it("edits the offset when the value stays on the face", () => {
    const { project: out, detached } = typedJoinedTransform(
      joined(),
      pack(),
      "leg",
      { position: [0.5, 1.5, 0] },
    );

    const leg = pieceOf(out, "leg");
    expect(detached).toBeNull();
    expect(leg.connection?.offset?.[0]).toBeCloseTo(0.5);
    expect(leg.connection?.offset?.[1]).toBeCloseTo(0);
    expect(leg.position[0]).toBeCloseTo(0.5);
    expect(resolveConnections(out, pack()).project).toBe(out);
  });

  it("frees the piece where it was put when the value leaves the face", () => {
    const { project: out, detached } = typedJoinedTransform(
      joined(),
      pack(),
      "leg",
      { position: [0, 3, 0] },
    );

    const leg = pieceOf(out, "leg");
    expect(leg.connection).toBeUndefined();
    expect(leg.position).toEqual([0, 3, 0]);
    expect(detached).toBe("Detached: moved off its face.");
    expect(resolveConnections(out, pack()).project).toBe(out);
  });
});

describe("turning a joined piece", () => {
  it("makes a turn about the face normal the twist, typed or dragged", () => {
    const turn: Vec3 = [0, QUARTER, 0];
    const free = dragPiece(
      joined(),
      pack(),
      "leg",
      { position: [0, 1.5, 0], rotation: turn, scale: [1, 1, 1] },
      null,
    );
    const typed = typedJoinedTransform(joined(), pack(), "leg", {
      rotation: turn,
    });

    for (const out of [free, typed.project]) {
      const leg = pieceOf(out, "leg");
      expect(Math.abs(leg.connection?.twist ?? 0)).toBeCloseTo(QUARTER);
      expect(leg.rotation[1]).toBeCloseTo(QUARTER);
      expect(resolveConnections(out, pack()).project).toBe(out);
    }
    expect(typed.detached).toBeNull();
  });

  it("frees the piece for any other turn, typed or dragged", () => {
    const turn: Vec3 = [QUARTER, 0, 0];
    const dragged = dragPiece(
      joined(),
      pack(),
      "leg",
      { position: [0, 1.5, 0], rotation: turn, scale: [1, 1, 1] },
      null,
    );
    const typed = typedJoinedTransform(joined(), pack(), "leg", {
      rotation: turn,
    });

    for (const out of [dragged, typed.project]) {
      expect(pieceOf(out, "leg").connection).toBeUndefined();
      expect(pieceOf(out, "leg").rotation).toEqual(turn);
      expect(resolveConnections(out, pack()).project).toBe(out);
    }
    expect(typed.detached).toBe("Detached: turned off its face.");
    // Same place as a free piece turned that way.
    expect(worldOf(typed.project, "leg")).toEqual(worldOf(dragged, "leg"));
  });
});

describe("typing a scale onto a joined piece", () => {
  it("keeps the scale and the join", () => {
    const { project: out, detached } = typedJoinedTransform(
      joined(),
      pack(),
      "leg",
      { scale: [1, 2, 1] },
    );

    const leg = pieceOf(out, "leg");
    expect(detached).toBeNull();
    expect(leg.connection).toBeDefined();
    expect(leg.scale).toEqual([1, 2, 1]);
    // The join moves the longer leg's connector, as every builder edit does.
    const placed = pieceOf(resolveConnections(out, pack()).project, "leg");
    expect(placed.scale).toEqual([1, 2, 1]);
    expect(placed.position[1]).toBeCloseTo(0.5 + 2);
  });
});
