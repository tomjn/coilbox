import { describe, expect, it } from "vitest";

import { buildObj } from "./exportObj";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import type { LegoPartInfo, LoadedPack } from "./pack";

/**
 * A pack holding one part: a single triangle on the x/z plane, one metre out
 * along each axis, with its normal up. Same fixture as s3oBuild.test.ts, so
 * the two exporters are checked against the same geometry.
 */
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
  // x, y, z, nx, ny, nz, u, v
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

const OPTIONS = { unitName: "probe", textureName: "probe.png" };

describe("buildObj", () => {
  it("names the mtl and points it at the given texture", () => {
    const built = buildObj(project([]), pack(), null, OPTIONS);

    expect(built?.obj).toContain("mtllib probe.mtl");
    expect(built?.mtl).toContain("newmtl atlas");
    expect(built?.mtl).toContain("map_Kd probe.png");
  });

  it("writes one o block per piece with geometry, with matching v/vt/vn/f counts", () => {
    const doc = project([{ id: "hull", name: "hull", parentId: "root" }]);

    const built = buildObj(doc, pack(), null, OPTIONS);
    const lines = built?.obj.split("\n") ?? [];

    expect(lines).toContain("o hull");
    expect(lines).toContain("usemtl atlas");
    expect(lines.filter((l) => l.startsWith("v ")).length).toBe(3);
    expect(lines.filter((l) => l.startsWith("vt ")).length).toBe(3);
    expect(lines.filter((l) => l.startsWith("vn ")).length).toBe(3);
    expect(lines.filter((l) => l.startsWith("f ")).length).toBe(1);
    expect(lines).toContain("f 1/1/1 2/2/2 3/3/3");
  });

  it("bakes a piece's offset into its vertices, since obj has no hierarchy", () => {
    const doc = project([
      { id: "arm", name: "arm", parentId: "root", position: [5, 0, 0] },
    ]);

    const built = buildObj(doc, pack(), null, OPTIONS);
    const lines = built?.obj.split("\n") ?? [];

    // The triangle's second vertex sits at (1, 0, 0) in part space, so at
    // world space it is 6 along x once the piece's own offset is added.
    expect(lines).toContain("v 6.000000 0.000000 0.000000");
  });

  it("compounds a parent's offset into a child, matching the s3o writer", () => {
    const doc = project([
      {
        id: "turret",
        name: "turret",
        parentId: "root",
        position: [1, 0, 0],
      },
      { id: "barrel", name: "barrel", parentId: "turret", position: [2, 0, 0] },
    ]);

    const built = buildObj(doc, pack(), null, OPTIONS);
    const lines = built?.obj.split("\n") ?? [];
    const barrelBlock = lines.slice(lines.indexOf("o barrel"));

    // turret sits at x=1, barrel a further 2 along, so its own origin (its
    // first vertex) lands at x=3.
    expect(barrelBlock).toContain("v 3.000000 0.000000 0.000000");
  });

  it("skips an empty piece but still descends into its children", () => {
    const doc = project([
      { id: "flare", name: "flare", parentId: "root", partId: null },
      {
        id: "child",
        name: "child",
        parentId: "flare",
        position: [3, 0, 0],
      },
    ]);

    const built = buildObj(doc, pack(), null, OPTIONS);
    const lines = built?.obj.split("\n") ?? [];

    expect(lines).not.toContain("o flare");
    expect(lines).toContain("o child");
    // Only the base root, so child's world offset is exactly its own position.
    expect(lines).toContain("v 4.000000 0.000000 0.000000");
  });

  it("keeps the winding the s3o writer reverses for a mirrored piece", () => {
    const doc = project([
      { id: "left", name: "left", parentId: "root" },
      { id: "right", name: "right", parentId: "root", scale: [-1, 1, 1] },
    ]);

    const built = buildObj(doc, pack(), null, OPTIONS);
    const lines = built?.obj.split("\n") ?? [];
    // o, usemtl, 3 v, 3 vt, 3 vn, then the one face: the face line is 11 rows
    // after the o line.
    const leftFace = lines[lines.indexOf("o left") + 11];
    const rightFace = lines[lines.indexOf("o right") + 11];

    expect(leftFace).toBe("f 1/1/1 2/2/2 3/3/3");
    expect(rightFace).toBe("f 4/4/4 6/6/6 5/5/5");
  });

  it("names the team-colour mask in a comment, since mtl has no slot for it", () => {
    const built = buildObj(project([]), pack(), null, {
      ...OPTIONS,
      textureName: "Beacon_1.png",
      maskName: "Beacon_2.png",
    });

    expect(built?.mtl).toContain("map_Kd Beacon_1.png");
    // Named so whoever opens it knows the file is there and what it is, and
    // commented so no reader samples measurements as if they were colour.
    expect(built?.mtl).toContain("# Beacon_2.png sits beside this file");
    expect(built?.mtl).toContain("team-colour");
    expect(built?.mtl).not.toContain("map_Kd Beacon_2.png");
  });

  it("writes a material with no map when there is no texture to name", () => {
    const built = buildObj(project([]), pack(), null, {
      ...OPTIONS,
      textureName: null,
    });

    expect(built?.mtl).toContain("newmtl atlas");
    expect(built?.mtl).not.toContain("map_Kd");
    // The obj still names the material, so the geometry is grouped as before.
    expect(built?.obj).toContain("mtllib probe.mtl");
  });

  it("returns null when the project has no root piece", () => {
    const doc = project([]);
    const broken = { ...doc, rootPieceId: "missing" };

    expect(buildObj(broken, pack(), null, OPTIONS)).toBeNull();
  });
});
