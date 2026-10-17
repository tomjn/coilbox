import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { type LegoPiece, type LegoProject, newProject } from "./model";
import type { LegoPartInfo, LoadedPack } from "./pack";
import {
  blockSizes,
  nearestSize,
  resizePackBlock,
  resizeReadout,
  sizeChoices,
} from "./resizePackBlock";

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
    category: "green",
    colourway: "green",
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

/**
 * Green blocks 1 by 1 and 1, 2 and 3 long on z. A 2 long block lying on x
 * (same sizes, different axis), a grey twin of the 2 long one, a beam of the
 * same size, and a 2 by 2 block, which has a cross section of its own.
 */
function pack(): LoadedPack {
  const parts = [
    part("z1", [-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]),
    part("z2", [-0.5, -0.5, -1], [0.5, 0.5, 1]),
    part("z3", [-0.5, -0.5, -1.5], [0.5, 0.5, 1.5]),
    part("x2", [-1, -0.5, -0.5], [1, 0.5, 0.5]),
    part("z2-grey", [-0.5, -0.5, -1], [0.5, 0.5, 1], { colourway: "grey" }),
    part("z2-beam", [-0.5, -0.5, -1], [0.5, 0.5, 1], { shape: "beam" }),
    part("wide", [-1, -1, -1], [1, 1, 1]),
    part("lone", [-0.75, -0.75, -0.75], [0.75, 0.75, 0.75]),
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
            partId: "z2",
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

/** Where a point of a piece's part is, in its parent's space. */
function world(piece: LegoPiece, point: Vec3): number[] {
  const at = piece.pivot ?? [0, 0, 0];
  return new THREE.Vector3(...point)
    .sub(new THREE.Vector3(...at))
    .applyMatrix4(
      new THREE.Matrix4().compose(
        new THREE.Vector3(),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...piece.rotation)),
        new THREE.Vector3(...piece.scale),
      ),
    )
    .add(new THREE.Vector3(...piece.position))
    .toArray();
}

describe("blockSizes", () => {
  it("reads the size along each of the part's own axes", () => {
    const p = pack();
    expect(blockSizes(p.byId.get("x2") as LegoPartInfo)).toEqual([2, 1, 1]);
    expect(blockSizes(p.byId.get("z3") as LegoPartInfo)).toEqual([1, 1, 3]);
  });
});

describe("sizeChoices", () => {
  it("lists the sizes the pack has along an axis, for this cross section", () => {
    const p = pack();
    const choices = sizeChoices(p, p.byId.get("z2") as LegoPartInfo, 2);
    expect(choices.map((c) => c.size)).toEqual([1, 2, 3]);
  });

  it("does not use a part whose sizes lie along other axes", () => {
    const p = pack();
    const ids = sizeChoices(p, p.byId.get("z2") as LegoPartInfo, 2).map(
      (c) => c.part.id,
    );
    expect(ids).not.toContain("x2");
  });

  it("keeps to the piece's colour and shape", () => {
    const p = pack();
    const ids = sizeChoices(p, p.byId.get("z2") as LegoPartInfo, 2).map(
      (c) => c.part.id,
    );
    expect(ids).not.toContain("z2-grey");
    expect(ids).not.toContain("z2-beam");
  });

  it("offers only the part itself when nothing else fits", () => {
    const p = pack();
    const lone = p.byId.get("lone") as LegoPartInfo;
    expect(sizeChoices(p, lone, 0).map((c) => c.part.id)).toEqual(["lone"]);
  });

  it("counts sizes within half a hundredth as one", () => {
    const p = pack();
    p.parts.push(part("z3b", [-0.5, -0.5, -1.502], [0.5, 0.5, 1.502]));
    const sizes = sizeChoices(p, p.byId.get("z2") as LegoPartInfo, 2).map(
      (c) => c.size,
    );
    expect(sizes.filter((s) => Math.abs(s - 3) < 0.01)).toHaveLength(1);
  });
});

describe("nearestSize", () => {
  it("picks the size nearest the dragged one", () => {
    const p = pack();
    const choices = sizeChoices(p, p.byId.get("z2") as LegoPartInfo, 2);
    expect(nearestSize(choices, 2.4)?.size).toBe(2);
    expect(nearestSize(choices, 2.6)?.size).toBe(3);
    expect(nearestSize(choices, 0.1)?.size).toBe(1);
    expect(nearestSize(choices, 40)?.size).toBe(3);
  });

  it("answers null for no choices", () => {
    expect(nearestSize([], 2)).toBeNull();
  });
});

describe("resizePackBlock", () => {
  it("swaps to the part of the new size and keeps the low face still", () => {
    const p = pack();
    const doc = unit([{ id: "a", position: [1, 2, 3] }]);
    const result = resizePackBlock(doc, p, "a", 2, 1, 3);
    const piece = of(result?.project as LegoProject, "a");
    expect(piece.partId).toBe("z3");
    expect(round(piece.position)).toEqual([1, 2, 3.5]);
    expect(round(world(piece, [0, 0, -1.5]))).toEqual([1, 2, 2]);
  });

  it("keeps the high face still when the low face is dragged", () => {
    const p = pack();
    const doc = unit([{ id: "a" }]);
    const result = resizePackBlock(doc, p, "a", 2, -1, 3);
    const piece = of(result?.project as LegoProject, "a");
    expect(piece.partId).toBe("z3");
    expect(round(piece.position)).toEqual([0, 0, -0.5]);
  });

  it("shortens as well as lengthens", () => {
    const p = pack();
    const result = resizePackBlock(unit([{ id: "a" }]), p, "a", 2, 1, 1);
    const piece = of(result?.project as LegoProject, "a");
    expect(piece.partId).toBe("z1");
    expect(round(piece.position)).toEqual([0, 0, -0.5]);
  });

  it("moves along the piece's own axis when it is turned", () => {
    const p = pack();
    const doc = unit([{ id: "a", rotation: [0, Math.PI / 2, 0] }]);
    const result = resizePackBlock(doc, p, "a", 2, 1, 3);
    const piece = of(result?.project as LegoProject, "a");
    expect(round(piece.position)).toEqual([0.5, 0, 0]);
    expect(round(world(piece, [0, 0, -1.5]))).toEqual(
      round(world(of(doc, "a"), [0, 0, -1])),
    );
  });

  it("carries the piece's scale into the shift", () => {
    const p = pack();
    const doc = unit([{ id: "a", scale: [2, 2, 2] }]);
    const result = resizePackBlock(doc, p, "a", 2, 1, 3);
    expect(round(of(result?.project as LegoProject, "a").position)).toEqual([
      0, 0, 1,
    ]);
  });

  it("keeps a pivot on its face", () => {
    const p = pack();
    const doc = unit([{ id: "a", pivot: [0, 0, 1] }]);
    const result = resizePackBlock(doc, p, "a", 2, 1, 3);
    const piece = of(result?.project as LegoProject, "a");
    expect(piece.pivot).toEqual([0, 0, 1.5]);
    expect(round(world(piece, [0, 0, -1.5]))).toEqual(
      round(world(of(doc, "a"), [0, 0, -1])),
    );
  });

  it("clamps a pivot that was somewhere else to the new box", () => {
    const p = pack();
    const doc = unit([{ id: "a", partId: "z3", pivot: [0.1, 0, 1.4] }]);
    const result = resizePackBlock(doc, p, "a", 2, 1, 2);
    const piece = of(result?.project as LegoProject, "a");
    expect(piece.partId).toBe("z2");
    expect(piece.pivot).toEqual([0.1, 0, 1]);
  });

  it("keeps the piece's name, role and tags", () => {
    const p = pack();
    const doc = unit([{ id: "a", name: "arm", role: "leg", tags: ["t"] }]);
    const piece = of(
      resizePackBlock(doc, p, "a", 2, 1, 3)?.project as LegoProject,
      "a",
    );
    expect([piece.name, piece.role, piece.tags]).toEqual(["arm", "leg", ["t"]]);
  });

  it("leaves children where they are in the world", () => {
    const p = pack();
    const doc = unit([
      { id: "a" },
      { id: "kid", parentId: "a", partId: "z1", position: [0, 0, 1] },
    ]);
    const result = resizePackBlock(doc, p, "a", 2, 1, 3);
    const out = result?.project as LegoProject;
    expect(round(of(out, "kid").position)).toEqual([0, 0, 0.5]);
    expect(round(of(out, "a").position)).toEqual([0, 0, 0.5]);
  });

  it("moves a child's offset back through the piece's turn", () => {
    const p = pack();
    const doc = unit([
      { id: "a", rotation: [0, Math.PI / 2, 0] },
      { id: "kid", parentId: "a", partId: "z1", position: [0, 0, 1] },
    ]);
    const out = resizePackBlock(doc, p, "a", 2, 1, 3)?.project as LegoProject;
    const before = world(of(doc, "a"), [0, 0, 1]);
    const after = world(of(out, "a"), of(out, "kid").position);
    expect(round(after)).toEqual(round(before));
  });

  it("lets a joined child follow its join instead", () => {
    const p = pack();
    const doc = unit([
      { id: "a" },
      {
        id: "kid",
        parentId: "a",
        partId: "z1",
        position: [0, 0, 1.5],
        connection: { connector: "-z", to: "+z" },
      },
    ]);
    const out = resizePackBlock(doc, p, "a", 2, 1, 3)?.project as LegoProject;
    // The parent's front face is 1.5 from its middle now, and the child's back
    // face is on it. In the unit that is z 2, as the parent moved by 0.5.
    expect(round(world(of(out, "kid"), [0, 0, -0.5]))[2]).toBeCloseTo(1.5, 5);
    expect(of(out, "a").position[2]).toBeCloseTo(0.5, 5);
  });

  it("reports the size it landed on", () => {
    const p = pack();
    const result = resizePackBlock(unit([{ id: "a" }]), p, "a", 2, 1, 2.6);
    expect(result?.size).toBe(3);
    expect(result?.partId).toBe("z3");
  });

  it("answers null for the size the piece already is", () => {
    const p = pack();
    expect(resizePackBlock(unit([{ id: "a" }]), p, "a", 2, 1, 2.1)).toBeNull();
  });

  it("answers null for a piece with no pack part", () => {
    const p = pack();
    expect(resizePackBlock(unit([]), p, "root", 2, 1, 3)).toBeNull();
    expect(
      resizePackBlock(unit([{ id: "e", partId: null }]), p, "e", 2, 1, 3),
    ).toBeNull();
  });

  it("keeps an anchor on the face that stays still", () => {
    const p = pack();
    const doc = unit([
      {
        id: "a",
        customAnchors: [{ id: "back", name: "back", position: [0, 0, -1] }],
      },
    ]);
    const piece = of(
      resizePackBlock(doc, p, "a", 2, 1, 3)?.project as LegoProject,
      "a",
    );
    expect(piece.customAnchors?.[0].position).toEqual([0, 0, -1.5]);
  });
});

describe("resizeReadout", () => {
  const p = pack();
  const choices = sizeChoices(p, p.byId.get("z2") as LegoPartInfo, 2);

  it("gives the size in elmos and part units", () => {
    expect(resizeReadout(choices, 2, 0.25)).toBe("2 elmos, 8 units");
  });

  it("says when the drag was snapped", () => {
    expect(resizeReadout(choices, 2.4, 0.25)).toBe(
      "Snapped to 2 elmos, 8 units",
    );
  });

  it("says when the pack has nothing longer or shorter", () => {
    expect(resizeReadout(choices, 5, 0.25)).toBe(
      "No longer part in the pack. Longest is 3 elmos, 12 units",
    );
    expect(resizeReadout(choices, 0.2, 0.25)).toBe(
      "No shorter part in the pack. Shortest is 1 elmos, 4 units",
    );
  });

  it("says when no other size exists", () => {
    const lone = sizeChoices(p, p.byId.get("lone") as LegoPartInfo, 0);
    expect(resizeReadout(lone, 3, 0.25)).toBe(
      "No other size in the pack on this axis",
    );
  });
});
