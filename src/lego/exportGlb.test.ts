import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { buildGlbScene } from "./exportGlb";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import type { LegoPartInfo, LoadedPack } from "./pack";

/** Same fixture as s3oBuild.test.ts and exportObj.test.ts. */
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
    bbox: { min: [0, 0, 0], max: [1, 0, 1] },
    uvBox: { min: [0, 0], max: [1, 1] },
    pivot: [0, 0, 0],
    sourceNames: [],
    aliasCount: 0,
  };
  const vertices = new Float32Array([
    0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1,
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

function project(pieces: Partial<LegoPiece>[]): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "probe",
    packId: "lego",
    packVersion: "1",
    now: "2026-07-28T00:00:00Z",
  });
  return {
    ...base,
    pieces: [
      ...base.pieces,
      ...pieces.map((piece, i) => ({
        id: `piece${i}`,
        name: `piece${i}`,
        parentId: "root",
        partId: "tri",
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
        ...piece,
      })),
    ],
  };
}

function find(node: THREE.Object3D, name: string): THREE.Object3D {
  const found = node.getObjectByName(name);
  if (!found) throw new Error(`no node called ${name}`);
  return found;
}

describe("buildGlbScene", () => {
  it("mirrors the piece hierarchy as a node tree, root first", () => {
    const doc = project([
      { id: "hull", name: "hull", parentId: "root" },
      { id: "gun", name: "gun", parentId: "hull" },
    ]);

    const scene = buildGlbScene(doc, pack(), null);

    expect(scene?.name).toBe("base");
    const hull = find(scene as THREE.Group, "hull");
    expect(hull.parent?.name).toBe("base");
    expect(find(hull, "gun").parent).toBe(hull);
  });

  it("carries a piece's baked offset as its node position", () => {
    const doc = project([
      { id: "arm", name: "arm", parentId: "root", position: [5, 0, 0] },
    ]);

    const scene = buildGlbScene(doc, pack(), null);
    const arm = find(scene as THREE.Group, "arm");

    expect([arm.position.x, arm.position.y, arm.position.z]).toEqual([5, 0, 0]);
  });

  /**
   * The piece itself is the mesh, not a group with a mesh inside it.
   * `GLTFExporter` writes a node per `Object3D`, so nesting one gave every
   * piece with geometry two nodes in the file and doubled the tree on the way
   * back in (#2576).
   */
  it("gives a piece with geometry one node, which is the mesh", () => {
    const doc = project([
      { id: "hull", name: "hull", parentId: "root" },
      { id: "gun", name: "gun", parentId: "hull" },
    ]);

    const scene = buildGlbScene(doc, pack(), null);
    const hull = find(scene as THREE.Object3D, "hull");

    expect(hull).toBeInstanceOf(THREE.Mesh);
    const mesh = hull as THREE.Mesh;
    expect(mesh.geometry.getAttribute("position").count).toBe(3);
    expect(mesh.geometry.getIndex()?.count).toBe(3);
    // Its child hangs off it directly rather than off a wrapper.
    expect(hull.children.map((child) => child.name)).toEqual(["gun"]);
  });

  it("gives an empty piece no mesh, but keeps it in the tree", () => {
    const doc = project([
      { id: "flare", name: "flare", parentId: "root", partId: null },
    ]);

    const scene = buildGlbScene(doc, pack(), null);
    const flare = find(scene as THREE.Object3D, "flare");

    expect(flare).not.toBeInstanceOf(THREE.Mesh);
    expect(flare.children).toEqual([]);
  });

  it("returns null when the project has no root piece", () => {
    const doc = project([]);
    const broken = { ...doc, rootPieceId: "missing" };

    expect(buildGlbScene(broken, pack(), null)).toBeNull();
  });
});
