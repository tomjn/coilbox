import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { boxConnectors } from "./connectors";
import { mirrorTwin } from "./mirror";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import type { LegoPartInfo, LoadedPack } from "./pack";
import { faceUnder, ownFace, placePart } from "./placePart";
import { worldMatrix } from "./reparent";

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

/** A hull 2 wide, 1 high and 4 long, and a leg 0.5 by 2 by 0.5. */
function pack(): LoadedPack {
  const parts = [
    part("hull", [-1, -0.5, -2], [1, 0.5, 2]),
    part("leg", [-0.25, -1, -0.25], [0.25, 1, 0.25], { shape: "leg" }),
    part("blank", [-1, -1, -1], [1, 1, 1], { connectors: [] }),
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

function unit(): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  const hull: LegoPiece = {
    id: "hull",
    name: "hull",
    parentId: "root",
    partId: "hull",
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  };
  return { ...base, pieces: [...base.pieces, hull] };
}

function leg(doc: LegoProject): LegoPiece {
  return doc.pieces.find((p) => p.id === "new") as LegoPiece;
}

function round(values: number[]): number[] {
  return values.map((n) => Number(n.toFixed(6)) + 0);
}

describe("faceUnder", () => {
  const hull = unit().pieces[1];

  it("finds the face a flat hit is on", () => {
    expect(faceUnder(pack(), hull, [0.3, 0.5, 1], [0, 1, 0])?.id).toBe("+y");
    expect(faceUnder(pack(), hull, [1, 0, 0], [1, 0, 0])?.id).toBe("+x");
    expect(faceUnder(pack(), hull, [0, 0, -2], [0, 0, -1])?.id).toBe("-z");
  });

  it("finds nothing on a slope that no connector faces", () => {
    const slope = new THREE.Vector3(0, 1, 1).normalize().toArray() as Vec3;
    expect(faceUnder(pack(), hull, [0, 0.5, 2], slope)).toBeNull();
  });

  it("finds nothing on a piece with no part", () => {
    const root = unit().pieces[0];
    expect(faceUnder(pack(), root, [0, 0, 0], [0, 1, 0])).toBeNull();
  });
});

describe("ownFace", () => {
  const theirs = boxConnectors(pack().byId.get("hull")?.bbox as never)[2];
  const leg = pack().byId.get("leg") as LegoPartInfo;

  it("starts with the face that points opposite", () => {
    expect(theirs.id).toBe("+y");
    expect(ownFace(pack(), leg, theirs, 0)?.id).toBe("-y");
  });

  it("goes on through the part's faces, and comes back round", () => {
    expect(ownFace(pack(), leg, theirs, 1)?.id).toBe("+z");
    expect(ownFace(pack(), leg, theirs, 6)?.id).toBe("-y");
    expect(ownFace(pack(), leg, theirs, -1)?.id).toBe("+y");
  });

  it("answers nothing for a part with no connectors", () => {
    expect(
      ownFace(pack(), pack().byId.get("blank") as LegoPartInfo, theirs, 0),
    ).toBeNull();
  });
});

describe("placePart", () => {
  const target = { parentId: "hull", to: "+y" };

  it("seats the part flush on the face, joined to it", () => {
    const doc = placePart(
      unit(),
      pack(),
      pack().byId.get("leg") as LegoPartInfo,
      target,
      { cycle: 0, twist: 0 },
      "new",
    ) as LegoProject;

    expect(leg(doc)).toMatchObject({
      parentId: "hull",
      partId: "leg",
      name: "leg",
      connection: { connector: "-y", to: "+y" },
    });
    // The leg is 2 high, so its middle stands 1 above the hull's top at 0.5.
    expect(round(leg(doc).position)).toEqual([0, 1.5, 0]);
    const bottom = new THREE.Vector3(0, -1, 0).applyMatrix4(
      worldMatrix(doc, "new"),
    );
    expect(round(bottom.toArray())).toEqual([0, 0.5, 0]);
  });

  it("joins by another face of the part when cycled", () => {
    const doc = placePart(
      unit(),
      pack(),
      pack().byId.get("leg") as LegoPartInfo,
      target,
      { cycle: 1, twist: 0 },
      "new",
    ) as LegoProject;

    expect(leg(doc).connection).toEqual({ connector: "+z", to: "+y" });
    // Its +z face now meets the hull's top, so it lies on its side.
    const end = new THREE.Vector3(0, 0, 0.25).applyMatrix4(
      worldMatrix(doc, "new"),
    );
    expect(round(end.toArray())[1]).toBe(0.5);
  });

  it("twists in quarter turns about the joined face", () => {
    const at = (twist: number) =>
      placePart(
        unit(),
        pack(),
        pack().byId.get("leg") as LegoPartInfo,
        target,
        { cycle: 0, twist },
        "new",
      ) as LegoProject;

    expect(leg(at(0)).connection?.twist).toBeUndefined();
    expect(leg(at(1)).connection?.twist).toBeCloseTo(Math.PI / 2);
    expect(leg(at(4)).connection?.twist).toBeUndefined();
    expect(round(leg(at(1)).position)).toEqual([0, 1.5, 0]);
  });

  it("names the piece so it does not clash", () => {
    const first = placePart(
      unit(),
      pack(),
      pack().byId.get("leg") as LegoPartInfo,
      target,
      { cycle: 0, twist: 0 },
      "a",
    ) as LegoProject;
    const second = placePart(
      first,
      pack(),
      pack().byId.get("leg") as LegoPartInfo,
      target,
      { cycle: 0, twist: 0 },
      "b",
    ) as LegoProject;

    expect(second.pieces.find((p) => p.id === "b")?.name).toBe("leg2");
  });

  it("adds nothing when the face or the part's face is missing", () => {
    const leg = pack().byId.get("leg") as LegoPartInfo;
    const blank = pack().byId.get("blank") as LegoPartInfo;
    const options = { cycle: 0, twist: 0 };
    expect(
      placePart(
        unit(),
        pack(),
        leg,
        { parentId: "hull", to: "nope" },
        options,
        "n",
      ),
    ).toBeNull();
    expect(
      placePart(
        unit(),
        pack(),
        leg,
        { parentId: "gone", to: "+y" },
        options,
        "n",
      ),
    ).toBeNull();
    expect(placePart(unit(), pack(), blank, target, options, "n")).toBeNull();
  });
});

describe("a part placed on a side face", () => {
  it("is already off the centre line, so it can be twinned at once", () => {
    const placed = placePart(
      unit(),
      pack(),
      pack().byId.get("leg") as LegoPartInfo,
      { parentId: "hull", to: "+x" },
      { cycle: 0, twist: 0 },
      "new",
    ) as LegoProject;

    const twinned = mirrorTwin(placed, "new", () => "twin");
    expect(twinned?.twinId).toBe("twin");
    const twin = twinned?.project.pieces.find((p) => p.id === "twin");
    expect(round(twin?.position ?? [])).toEqual([
      -round(leg(placed).position)[0] + 0,
      round(leg(placed).position)[1],
      round(leg(placed).position)[2],
    ]);
  });

  it("on the top face is its own reflection, so it waits", () => {
    const placed = placePart(
      unit(),
      pack(),
      pack().byId.get("leg") as LegoPartInfo,
      { parentId: "hull", to: "+y" },
      { cycle: 0, twist: 0 },
      "new",
    ) as LegoProject;

    expect(mirrorTwin(placed, "new", () => "twin")).toBeNull();
  });
});
