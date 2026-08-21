import { describe, expect, it } from "vitest";

import { type LegoPiece, type LegoProject, newProject } from "./model";
import type { LegoPartInfo, LoadedPack } from "./pack";
import type { RawGeometry } from "./rawGeometry";
import { buildS3o, type S3oPiece, sitOnGround, unitBounds } from "./s3oBuild";

/**
 * A pack holding one part: a single triangle on the x/z plane, one metre out
 * along each axis, with its normal up.
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

const TEXTURES = { texture1: "probe.png" };

function round(values: number[]): number[] {
  return values.map((n) => Number(n.toFixed(5)));
}

function child(root: S3oPiece, name: string): S3oPiece {
  const found = root.children.find((piece) => piece.name === name);
  if (!found) throw new Error(`no piece called ${name}`);
  return found;
}

describe("buildS3o", () => {
  it("mirrors the piece hierarchy, root first", () => {
    const doc = project([
      { id: "hull", name: "hull", parentId: "root" },
      { id: "gun", name: "gun", parentId: "hull" },
    ]);

    const build = buildS3o(doc, pack(), null, TEXTURES);

    expect(build?.root.name).toBe("base");
    expect(
      child(build?.root as S3oPiece, "hull").children.map((p) => p.name),
    ).toEqual(["gun"]);
  });

  it("bakes rotation into the vertices and leaves the offset a translation", () => {
    const doc = project([
      {
        id: "arm",
        name: "arm",
        parentId: "root",
        position: [5, 0, 0],
        // A quarter turn about y, which sends +x to -z.
        rotation: [0, Math.PI / 2, 0],
      },
    ]);

    const arm = child(
      buildS3o(doc, pack(), null, TEXTURES)?.root as S3oPiece,
      "arm",
    );

    expect(round(arm.offset)).toEqual([5, 0, 0]);
    // The vertex that sat at (1, 0, 0) is now at (0, 0, -1).
    expect(round(arm.vertices[1].pos)).toEqual([0, 0, -1]);
    expect(round(arm.vertices[1].normal)).toEqual([0, 1, 0]);
  });

  it("compounds a parent's rotation into its children", () => {
    const doc = project([
      {
        id: "turret",
        name: "turret",
        parentId: "root",
        rotation: [0, Math.PI / 2, 0],
      },
      { id: "barrel", name: "barrel", parentId: "turret", position: [2, 0, 0] },
    ]);

    const root = buildS3o(doc, pack(), null, TEXTURES)?.root as S3oPiece;
    const barrel = child(child(root, "turret"), "barrel");

    // The offset is in engine axes, so the parent's turn moves it off +x.
    expect(round(barrel.offset)).toEqual([0, 0, -2]);
    expect(round(barrel.vertices[1].pos)).toEqual([0, 0, -1]);
  });

  it("scales vertices without skewing their normals", () => {
    const doc = project([
      { id: "slab", name: "slab", parentId: "root", scale: [4, 1, 1] },
    ]);

    const slab = child(
      buildS3o(doc, pack(), null, TEXTURES)?.root as S3oPiece,
      "slab",
    );

    expect(round(slab.vertices[1].pos)).toEqual([4, 0, 0]);
    expect(round(slab.vertices[1].normal)).toEqual([0, 1, 0]);
  });

  it("reverses winding when a piece is mirrored", () => {
    const doc = project([
      { id: "left", name: "left", parentId: "root" },
      { id: "right", name: "right", parentId: "root", scale: [-1, 1, 1] },
    ]);

    const root = buildS3o(doc, pack(), null, TEXTURES)?.root as S3oPiece;

    expect(child(root, "left").indices).toEqual([0, 1, 2]);
    expect(child(root, "right").indices).toEqual([0, 2, 1]);
  });

  it("gives an empty piece no geometry, and keeps it in the tree", () => {
    const doc = project([
      { id: "flare", name: "flare", parentId: "root", partId: null },
    ]);

    const flare = child(
      buildS3o(doc, pack(), null, TEXTURES)?.root as S3oPiece,
      "flare",
    );

    expect(flare.vertices).toEqual([]);
    expect(flare.indices).toEqual([]);
    expect(flare.primitiveType).toBe(0);
  });

  it("measures the header from world space", () => {
    const doc = project([
      { id: "up", name: "up", parentId: "root", position: [0, 3, 0] },
    ]);

    const build = buildS3o(doc, pack(), null, TEXTURES);

    // The corners land at (0,3,0), (1,3,0) and (0,3,1), so the top is 3 and
    // the middle is half a metre along x and z.
    expect(build?.height).toBeCloseTo(3);
    expect(round(build?.mid ?? [])).toEqual([0.5, 3, 0.5]);
    // Measured from mid, not the origin: every corner is the same half-diagonal
    // away from the middle.
    expect(build?.radius).toBeCloseTo(Math.hypot(0.5, 0.5));
  });

  it("measures sizeX and sizeZ off the bounding box, not off the radius", () => {
    // A long thin unit: 8 along x, 2 along z. A radius-derived footprint
    // would be square. Measuring the box instead keeps the axes apart.
    const doc = project([
      { id: "hull", name: "hull", parentId: "root", scale: [8, 1, 2] },
    ]);

    const build = buildS3o(doc, pack(), null, TEXTURES);

    expect(build?.sizeX).toBeCloseTo(8);
    expect(build?.sizeZ).toBeCloseTo(2);
  });

  it("measures sizeY the same way, for a collision volume to use", () => {
    // The part is flat, so height comes from stacking two of them apart.
    const doc = project([
      { id: "floor", name: "floor", parentId: "root" },
      { id: "roof", name: "roof", parentId: "root", position: [0, 5, 0] },
    ]);

    const build = buildS3o(doc, pack(), null, TEXTURES);

    expect(build?.sizeY).toBeCloseTo(5);
  });

  it("measures a wide flat unit the same way", () => {
    const doc = project([
      { id: "pad", name: "pad", parentId: "root", scale: [1, 1, 6] },
    ]);

    const build = buildS3o(doc, pack(), null, TEXTURES);

    expect(build?.sizeX).toBeCloseTo(1);
    expect(build?.sizeZ).toBeCloseTo(6);
  });

  it("measures a tiny unit as a small extent rather than zero", () => {
    const doc = project([
      { id: "speck", name: "speck", parentId: "root", scale: [0.1, 0.1, 0.1] },
    ]);

    const build = buildS3o(doc, pack(), null, TEXTURES);

    expect(build?.sizeX).toBeCloseTo(0.1);
    expect(build?.sizeZ).toBeCloseTo(0.1);
  });

  it("measures a unit exactly on a step boundary at its true size", () => {
    // 16 elmos is exactly one ELMOS_PER_FOOTPRINT step.
    const doc = project([
      { id: "block", name: "block", parentId: "root", scale: [16, 1, 16] },
    ]);

    const build = buildS3o(doc, pack(), null, TEXTURES);

    expect(build?.sizeX).toBeCloseTo(16);
    expect(build?.sizeZ).toBeCloseTo(16);
  });

  it("does not inflate the radius of a unit built away from the origin", () => {
    const near = buildS3o(
      project([{ id: "a", name: "a", parentId: "root" }]),
      pack(),
      null,
      TEXTURES,
    );
    const far = buildS3o(
      project([{ id: "a", name: "a", parentId: "root", position: [40, 0, 0] }]),
      pack(),
      null,
      TEXTURES,
    );

    // The same geometry, moved. Its collision sphere is the same size, because
    // the sphere is centred on the model rather than on the world origin.
    expect(far?.radius).toBeCloseTo(near?.radius ?? -1, 5);
  });

  /**
   * The collision sphere is centred on the header's mid, so a unit given an
   * aim point of its own needs its radius measured from there. Keeping the
   * measurement on the bounding box's middle would leave the sphere short of
   * the geometry by however far the aim point had been moved.
   */
  it("measures the radius from an aim point the unit was given", () => {
    // The triangle's corners are (0,0,0), (1,0,0) and (0,0,1), so its box is
    // centred on (0.5, 0, 0.5) and every corner is hypot(0.5, 0.5) from there.
    const doc = project([{ id: "a", name: "a", parentId: "root" }]);

    const build = buildS3o({ ...doc, mid: [0, 0, 0] }, pack(), null, TEXTURES);

    // From the corner instead, the two far corners are a whole elmo away.
    expect(build?.radius).toBeCloseTo(1);
    expect(build?.mid).toEqual([0, 0, 0]);
  });

  it("writes zeros for a unit with no geometry, deferring to the engine", () => {
    const build = buildS3o(project([]), pack(), null, TEXTURES);

    expect(build?.radius).toBe(0);
    expect(build?.height).toBe(0);
    expect(build?.mid).toEqual([0, 0, 0]);
    expect(build?.sizeX).toBe(0);
    expect(build?.sizeY).toBe(0);
    expect(build?.sizeZ).toBe(0);
  });

  it("sits a floating unit down on the ground", () => {
    const doc = project([
      { id: "up", name: "up", parentId: "root", position: [0, 4, 0] },
    ]);

    const grounded = sitOnGround(doc, pack(), null);

    expect(buildS3o(doc, pack(), null, TEXTURES)?.height).toBeCloseTo(4);
    // The part is flat, so its lowest point is its only point: it lands on 0.
    expect(buildS3o(grounded, pack(), null, TEXTURES)?.height).toBeCloseTo(0);
  });

  it("lifts a buried unit up out of the ground", () => {
    const doc = project([
      { id: "down", name: "down", parentId: "root", position: [0, -3, 0] },
    ]);

    const grounded = sitOnGround(doc, pack(), null);
    const root = grounded.pieces.find((piece) => piece.id === "root");

    expect(root?.position).toEqual([0, 3, 0]);
  });

  it("moves only the root, so the unit keeps its shape", () => {
    const doc = project([
      { id: "a", name: "a", parentId: "root", position: [0, 5, 0] },
      { id: "b", name: "b", parentId: "a", position: [0, 2, 0] },
    ]);

    const grounded = sitOnGround(doc, pack(), null);

    for (const id of ["a", "b"]) {
      expect(
        grounded.pieces.find((piece) => piece.id === id)?.position,
      ).toEqual(doc.pieces.find((piece) => piece.id === id)?.position);
    }
  });

  it("leaves a unit already on the ground alone", () => {
    const doc = project([{ id: "a", name: "a", parentId: "root" }]);

    expect(sitOnGround(doc, pack(), null)).toBe(doc);
  });

  it("has nothing to measure on a unit with no geometry", () => {
    const doc = project([]);

    expect(sitOnGround(doc, pack(), null)).toBe(doc);
  });

  it("uses the header the document pins, and measures one it does not", () => {
    const doc = project([{ id: "a", name: "a", parentId: "root" }]);
    const pinned = { ...doc, radius: 99, height: 42, mid: [1, 2, 3] as const };

    const measured = buildS3o(doc, pack(), null, TEXTURES);
    const kept = buildS3o(
      { ...pinned, mid: [1, 2, 3] },
      pack(),
      null,
      TEXTURES,
    );

    expect(measured?.radius).not.toBeCloseTo(99);
    // A unit imported from somebody else's model carries that model's own
    // collision sphere, and re-exporting it must not change it.
    expect(kept?.radius).toBe(99);
    expect(kept?.height).toBe(42);
    expect(kept?.mid).toEqual([1, 2, 3]);
    // The box the unit definition is derived from is still measured, because
    // the header has no room for it.
    expect(kept?.sizeX).toBeCloseTo(measured?.sizeX ?? -1);
  });

  it("carries the texture names through", () => {
    const build = buildS3o(project([]), pack(), null, {
      texture1: "probe.png",
      texture2: "probe_glow.png",
    });

    expect(build?.texture1).toBe("probe.png");
    expect(build?.texture2).toBe("probe_glow.png");
  });
});

describe("unitBounds", () => {
  it("gives the same box the header does, without building a model", () => {
    const doc = project([
      { id: "hull", name: "hull", parentId: "root", scale: [8, 1, 2] },
      { id: "mast", name: "mast", parentId: "root", position: [0, 6, 0] },
    ]);

    const measured = unitBounds(doc, pack(), null);
    const build = buildS3o(doc, pack(), null, TEXTURES);

    expect(measured.sizeX).toBeCloseTo(build?.sizeX ?? -1);
    expect(measured.sizeY).toBeCloseTo(build?.sizeY ?? -1);
    expect(measured.sizeZ).toBeCloseTo(build?.sizeZ ?? -1);
    expect(round(measured.mid)).toEqual(round(build?.mid ?? []));
  });

  it("measures nothing on a unit with no geometry", () => {
    expect(unitBounds(project([]), pack(), null)).toEqual({
      mid: [0, 0, 0],
      sizeX: 0,
      sizeY: 0,
      sizeZ: 0,
    });
  });
});

/**
 * The meshes of an imported unit, as `rawGeometry.ts` hands them over: one
 * triangle standing on the y/z plane so it is unmistakably not the pack's.
 */
function raw(): RawGeometry {
  return {
    byId: new Map([
      [
        "m1",
        {
          id: "m1",
          vFirst: 0,
          vCount: 3,
          iFirst: 0,
          iCount: 3,
          bbox: { min: [0, 0, 0], max: [0, 2, 2] },
        },
      ],
    ]),
    // x, y, z, nx, ny, nz, u, v
    vertices: new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 0, 0, 2, 0, 1, 0, 0, 0.5, 0, 0, 0, 2, 1, 0, 0, 0.5,
      0.5,
    ]),
    indices: new Uint32Array([0, 1, 2]),
  };
}

describe("baking an imported unit", () => {
  it("takes a piece's geometry from the sidecar rather than the pack", () => {
    const doc = project([
      {
        id: "hull",
        name: "hull",
        parentId: "root",
        partId: null,
        meshId: "m1",
      },
    ]);

    const build = buildS3o(doc, pack(), raw(), TEXTURES);

    const hull = child(build?.root as S3oPiece, "hull");
    expect(hull.vertices).toHaveLength(3);
    expect(hull.vertices[1].pos).toEqual([0, 2, 0]);
    // The UVs are the model's own, untouched. A texture swap is a pointer
    // change and never a remap.
    expect(hull.vertices[1].uv).toEqual([0.5, 0]);
    expect(hull.indices).toEqual([0, 1, 2]);
  });

  it("bakes a mesh's rotation and scale into its vertices, as it does a part's", () => {
    const doc = project([
      {
        id: "hull",
        name: "hull",
        parentId: "root",
        partId: null,
        meshId: "m1",
        scale: [1, 3, 1],
      },
    ]);

    const build = buildS3o(doc, pack(), raw(), TEXTURES);

    expect(child(build?.root as S3oPiece, "hull").vertices[1].pos).toEqual([
      0, 6, 0,
    ]);
  });

  it("shows nothing for a mesh the sidecar does not hold", () => {
    const doc = project([
      {
        id: "hull",
        name: "hull",
        parentId: "root",
        partId: null,
        meshId: "m9",
      },
    ]);

    const build = buildS3o(doc, pack(), raw(), TEXTURES);

    expect(child(build?.root as S3oPiece, "hull").vertices).toEqual([]);
  });
});
