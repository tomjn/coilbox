/**
 * Builder tools that read a piece's place must agree with `joinedWorld`: a
 * joined piece does not take its parent's scale (#3292, #4292).
 */

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { selectionAsCompound } from "./compounds";
import { disconnectPiece } from "./connectors";
import { groupTransform } from "./groupTransform";
import { joinedWorld } from "./joinedWorld";
import { mirrorCopy, mirrorPiece } from "./mirror";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import type { LegoPartInfo, LoadedPack } from "./pack";
import { reparentPiece, worldMatrix } from "./reparent";
import { dragPiece, type Seat } from "./seat";

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

function round(m: THREE.Matrix4): number[] {
  return m.toArray().map((n) => Number(n.toFixed(5)) + 0);
}

function localOf(piece: LegoPiece): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...piece.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...piece.rotation)),
    new THREE.Vector3(...piece.scale),
  );
}

/** Where the scene draws a joined `id` under its parent: `joinedWorld`, not `worldMatrix`. */
function drawn(doc: LegoProject, id: string): THREE.Matrix4 {
  const piece = pieceOf(doc, id);
  return joinedWorld(
    worldMatrix(doc, piece.parentId as string),
    localOf(piece),
  );
}

/** A hull scaled to 2 on x, with a leg joined to it and turned a little. */
function scaledHull(extra: Partial<LegoPiece> = {}): LegoProject {
  return project([
    { id: "hull", partId: "hull", scale: [2, 1, 1], rotation: [0, 0.4, 0] },
    {
      id: "leg",
      partId: "leg",
      parentId: "hull",
      position: [0.5, 1.5, 0.25],
      rotation: [0, 0, 0],
      connection: { connector: "-y", to: "+y" },
      ...extra,
    },
  ]);
}

describe("worldMatrix for a joined piece", () => {
  it("is what joinedWorld draws", () => {
    const doc = scaledHull({ rotation: [0, 0.3, 0.2] });
    const expected = joinedWorld(
      worldMatrix(doc, "hull"),
      localOf(pieceOf(doc, "leg")),
    );
    expect(round(drawn(doc, "leg"))).toEqual(round(expected));
  });

  it("still multiplies the scale into a piece that is not joined", () => {
    const doc = scaledHull({ connection: undefined });
    const expected = worldMatrix(doc, "hull")
      .clone()
      .multiply(localOf(pieceOf(doc, "leg")));
    expect(round(worldMatrix(doc, "leg"))).toEqual(round(expected));
  });
});

describe("tools that read a joined piece under a scaled parent", () => {
  it("disconnectPiece keeps the size and place", () => {
    const doc = scaledHull();
    const out = disconnectPiece(doc, "leg");
    expect(pieceOf(out, "leg").connection).toBeUndefined();
    expect(round(worldMatrix(out, "leg"))).toEqual(round(drawn(doc, "leg")));
  });

  it("disconnectPiece leaves a join under an unscaled parent as it was", () => {
    const doc = project([
      { id: "hull", partId: "hull" },
      {
        id: "leg",
        partId: "leg",
        parentId: "hull",
        position: [0, 1.5, 0],
        connection: { connector: "-y", to: "+y" },
      },
    ]);
    const out = disconnectPiece(doc, "leg");
    expect(pieceOf(out, "leg").position).toEqual([0, 1.5, 0]);
  });

  it("reparentPiece keeps the size and place", () => {
    const doc = project([
      { id: "hull", partId: "hull", scale: [2, 1, 1] },
      { id: "other", partId: "hull", position: [5, 0, 0], scale: [1, 3, 1] },
      {
        id: "leg",
        partId: "leg",
        parentId: "hull",
        position: [0.5, 1.5, 0.25],
        connection: { connector: "-y", to: "+y" },
      },
    ]);
    const out = reparentPiece(doc, "leg", "other");
    expect(pieceOf(out, "leg").parentId).toBe("other");
    expect(round(worldMatrix(out, "leg"))).toEqual(round(drawn(doc, "leg")));
  });

  it("groupTransform writes a local transform that lands at the moved place", () => {
    const doc = scaledHull();
    const delta = {
      position: [0, 0.5, 0] as Vec3,
      rotation: [0, 0, 0] as Vec3,
      scale: 1,
    };
    const changes = groupTransform(doc, ["leg"], [0, 0, 0], delta);
    const change = changes.get("leg") as {
      position: Vec3;
      rotation: Vec3;
      scale: Vec3;
    };
    const moved = {
      ...doc,
      pieces: doc.pieces.map((p) => (p.id === "leg" ? { ...p, ...change } : p)),
    };
    const expected = new THREE.Matrix4()
      .makeTranslation(0, 0.5, 0)
      .multiply(drawn(doc, "leg"));
    expect(round(worldMatrix(moved, "leg"))).toEqual(round(expected));
  });

  it("mirrorPiece lands at the reflection of the joined piece", () => {
    const doc = project([
      { id: "hull", partId: "hull", scale: [2, 1, 1] },
      {
        id: "leg",
        partId: "leg",
        parentId: "hull",
        position: [0.5, 1.5, 0.25],
        connection: { connector: "-y", to: "+y" },
      },
    ]);
    const out = mirrorPiece(doc, "leg");
    const expected = new THREE.Matrix4()
      .makeScale(-1, 1, 1)
      .multiply(drawn(doc, "leg"));
    expect(round(worldMatrix(out, "leg"))).toEqual(round(expected));
  });

  it("mirrorCopy of a joined piece under a scaled parent keeps its size and place before reflecting", () => {
    const doc = project([
      { id: "hull", partId: "hull", scale: [2, 1, 1] },
      { id: "arm", partId: "hull", position: [0, 0, 4], scale: [1, 2, 1] },
      {
        id: "leg",
        partId: "leg",
        parentId: "hull",
        position: [0.5, 1.5, 0.25],
        connection: { connector: "-y", to: "+y" },
      },
    ]);
    let n = 0;
    const out = mirrorCopy(doc, "leg", () => `n${n++}`, "arm");
    expect(out).not.toBeNull();
    const copy = worldMatrix(
      (out as NonNullable<typeof out>).project,
      (out as NonNullable<typeof out>).pieceId,
    );
    const expected = new THREE.Matrix4()
      .makeScale(-1, 1, 1)
      .multiply(drawn(doc, "leg"));
    expect(round(copy)).toEqual(round(expected));
  });

  it("selectionAsCompound places a second joined root against the first at its drawn size", () => {
    const doc = project([
      { id: "hull", partId: "hull", scale: [2, 1, 1] },
      {
        id: "a",
        partId: "leg",
        parentId: "hull",
        position: [0.5, 1.5, 0],
        connection: { connector: "-y", to: "+y" },
      },
      {
        id: "b",
        partId: "leg",
        parentId: "hull",
        position: [-0.5, 1.5, 0],
        connection: { connector: "-y", to: "+y" },
      },
    ]);
    let n = 0;
    const out = selectionAsCompound(doc, ["a", "b"], {
      id: "c",
      now: "2026-10-17T00:00:00Z",
      newId: () => `n${n++}`,
    });
    const compound = out as NonNullable<typeof out>;
    const roots = compound.pieces.filter((p) => p.parentId === null);
    const second = roots.find(
      (p) => p.id !== compound.rootPieceId,
    ) as LegoPiece;
    expect(second.scale.map((v) => Number(v.toFixed(5)))).toEqual([1, 1, 1]);
    const frame = drawn(doc, "a").invert();
    const expected = frame.multiply(drawn(doc, "b"));
    expect(round(localOf(second))).toEqual(round(expected));
  });

  it("dragPiece seats against a scaled parent with the twist of the turn it was dropped at", () => {
    const seat: Seat = { parentId: "hull", connector: "-y", to: "+y" };
    const twistUnder = (scale: Vec3): number => {
      const doc = project([
        { id: "hull", partId: "hull", scale },
        { id: "leg", partId: "leg", position: [0, 1.5, 0] },
      ]);
      const out = dragPiece(
        doc,
        pack(),
        "leg",
        {
          position: [0, 1.5, 0],
          rotation: [0, 0.6, 0],
          scale: [1, 1, 1],
        },
        seat,
      );
      return pieceOf(out, "leg").connection?.twist ?? 0;
    };
    expect(twistUnder([1, 1, 1])).not.toBe(0);
    expect(twistUnder([2, 1, 1])).toBeCloseTo(twistUnder([1, 1, 1]), 6);
  });
});
