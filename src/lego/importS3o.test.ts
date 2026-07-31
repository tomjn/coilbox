import { describe, expect, it } from "vitest";

import type { LegoAtlas } from "./atlas";
import {
  recoveredAtlas,
  recoverProject,
  type S3oModel,
  type S3oReadPiece,
} from "./importS3o";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import type { LegoPartInfo, LoadedPack } from "./pack";
import { buildS3o, type S3oPiece } from "./s3oBuild";

/** The eight corners of a unit cube, mapped down one column of the atlas. */
function cube(u: number): number[] {
  const corners = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ];
  return corners.flatMap(([x, y, z], i) => [x, y, z, 0, 1, 0, u, i / 10]);
}

/** Three corners on the x/z plane: a part with no thickness to read. */
function triangle(u: number): number[] {
  const corners = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 0, 1],
  ];
  return corners.flatMap(([x, y, z], i) => [x, y, z, 0, 1, 0, u, i / 10]);
}

const CUBE_FACES = [
  0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6,
  7, 2, 7, 3, 3, 7, 4, 3, 4, 0,
];

/**
 * A pack of three parts.
 *
 * `red` and `blue` are the same cube mapped into different columns of the
 * atlas, which is what a colourway family is: the pair is here so a test can
 * tell whether the UVs or the mesh decided a match. `flat` is a triangle, the
 * case where no transform can be read back.
 */
function pack(): LoadedPack {
  const part = (
    id: string,
    vFirst: number,
    vCount: number,
    iFirst: number,
    iCount: number,
  ) =>
    ({
      id,
      packId: "lego",
      shapeId: id,
      name: id,
      category: "grey",
      colourway: id,
      shape: "solid",
      material: "metal",
      tags: [],
      vFirst,
      vCount,
      iFirst,
      iCount,
      bbox: { min: [0, 0, 0], max: [1, 1, 1] },
      uvBox: { min: [0, 0], max: [1, 1] },
      pivot: [0, 0, 0],
      sourceNames: [],
      aliasCount: 0,
    }) satisfies LegoPartInfo;

  const vertices = new Float32Array([
    ...cube(0.25),
    ...cube(0.75),
    ...triangle(0.5),
  ]);
  const indices = new Uint16Array([...CUBE_FACES, ...CUBE_FACES, 0, 1, 2]);

  const parts = [
    part("red", 0, 8, 0, 36),
    part("blue", 8, 8, 36, 36),
    part("flat", 16, 3, 72, 3),
  ];
  return {
    manifest: {
      id: "lego",
      version: "1",
    } as LoadedPack["manifest"],
    library: { packs: [], atlases: [], dir: "", problems: [] },
    parts,
    byId: new Map(parts.map((p) => [p.id, p])),
    vertices,
    indices,
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
        partId: "red",
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
        ...piece,
      })),
    ],
  };
}

/**
 * A built model as it comes back off disk.
 *
 * Everything the format stores is a 32-bit float, so rounding to one is the
 * whole of what a write and a read do to a model: the crate's own round trip
 * test covers the bytes.
 */
function written(build: S3oPiece): S3oReadPiece {
  return {
    name: build.name,
    primitiveType: build.primitiveType,
    offset: build.offset.map(Math.fround) as [number, number, number],
    vertices: build.vertices.map((v) => ({
      pos: v.pos.map(Math.fround) as [number, number, number],
      normal: v.normal.map(Math.fround) as [number, number, number],
      uv: v.uv.map(Math.fround) as [number, number],
    })),
    indices: [...build.indices],
    children: build.children.map(written),
  };
}

function exported(doc: LegoProject): S3oModel {
  const build = buildS3o(doc, pack(), { texture1: "coilbox_atlas.png" });
  if (!build) throw new Error("nothing to export");
  return {
    radius: Math.fround(build.radius),
    height: Math.fround(build.height),
    mid: build.mid.map(Math.fround) as [number, number, number],
    texture1: build.texture1,
    texture2: build.texture2,
    root: written(build.root),
  };
}

let counter = 0;
const newId = () => `id${counter++}`;

function recover(model: S3oModel): LegoProject {
  const result = recoverProject(model, pack(), {
    name: "recovered",
    unitName: "recovered",
    now: "2026-07-30T00:00:00Z",
    newId,
  });
  if (!result.ok) throw new Error(result.problem);
  return result.recovery.project;
}

function named(doc: LegoProject, name: string): LegoPiece {
  const piece = doc.pieces.find((p) => p.name === name);
  if (!piece) throw new Error(`no piece called ${name}`);
  return piece;
}

/** Every vertex of a built model, in the order the pieces are written. */
function points(doc: LegoProject): number[] {
  const build = buildS3o(doc, pack(), { texture1: "x" });
  const out: number[] = [];
  const visit = (piece: S3oPiece, x: number, y: number, z: number) => {
    const at = [x + piece.offset[0], y + piece.offset[1], z + piece.offset[2]];
    for (const vertex of piece.vertices) {
      out.push(
        vertex.pos[0] + at[0],
        vertex.pos[1] + at[1],
        vertex.pos[2] + at[2],
      );
    }
    for (const child of piece.children) visit(child, at[0], at[1], at[2]);
  };
  if (build) visit(build.root, 0, 0, 0);
  return out;
}

describe("recoverProject", () => {
  it("gives back the tree the unit was built with", () => {
    const doc = project([
      { id: "hull", name: "hull", parentId: "root" },
      { id: "gun", name: "gun", parentId: "hull" },
      { id: "flare", name: "flare", parentId: "hull", partId: null },
    ]);

    const back = recover(exported(doc));

    expect(back.pieces.map((piece) => piece.name)).toEqual([
      "base",
      "hull",
      "gun",
      "flare",
    ]);
    expect(named(back, "gun").parentId).toBe(named(back, "hull").id);
    expect(named(back, "flare").partId).toBeNull();
    expect(back.rootPieceId).toBe(named(back, "base").id);
  });

  it("reads a piece's position, rotation and scale back off its geometry", () => {
    const doc = project([
      {
        id: "arm",
        name: "arm",
        parentId: "root",
        position: [5, 2, -3],
        rotation: [0, Math.PI / 2, 0],
        scale: [2, 1, 3],
      },
    ]);

    const arm = named(recover(exported(doc)), "arm");

    expect(arm.position[0]).toBeCloseTo(5, 4);
    expect(arm.position[1]).toBeCloseTo(2, 4);
    expect(arm.position[2]).toBeCloseTo(-3, 4);
    expect(arm.rotation[1]).toBeCloseTo(Math.PI / 2, 4);
    expect(arm.scale[0]).toBeCloseTo(2, 4);
    expect(arm.scale[2]).toBeCloseTo(3, 4);
  });

  it("keeps a child's own transform rather than its parent's compounded", () => {
    const doc = project([
      {
        id: "turret",
        name: "turret",
        parentId: "root",
        rotation: [0, Math.PI / 2, 0],
      },
      { id: "barrel", name: "barrel", parentId: "turret", position: [2, 0, 0] },
    ]);

    const barrel = named(recover(exported(doc)), "barrel");

    // The model holds the barrel 2 along -z, because its parent is turned.
    // Written against that parent it is 2 along +x again, as the unit was built.
    expect(barrel.position[0]).toBeCloseTo(2, 4);
    expect(barrel.position[2]).toBeCloseTo(0, 4);
    expect(barrel.rotation[1]).toBeCloseTo(0, 4);
  });

  it("recovers a mirrored piece as a reflection", () => {
    const doc = project([
      { id: "left", name: "left", parentId: "root", position: [3, 0, 0] },
      {
        id: "right",
        name: "right",
        parentId: "root",
        position: [-3, 0, 0],
        scale: [-1, 1, 1],
      },
    ]);

    const right = named(recover(exported(doc)), "right");

    expect(right.scale[0]).toBeCloseTo(-1, 4);
    expect(right.scale[1]).toBeCloseTo(1, 4);
  });

  it("recovers the point a piece turns about", () => {
    const doc = project([
      { id: "door", name: "door", parentId: "root", pivot: [0.5, 0, 0.25] },
    ]);

    const door = named(recover(exported(doc)), "door");

    expect(door.pivot?.[0]).toBeCloseTo(0.5, 4);
    expect(door.pivot?.[2]).toBeCloseTo(0.25, 4);
  });

  it("leaves a piece turning about its part's middle without a pivot", () => {
    const doc = project([{ id: "block", name: "block", parentId: "root" }]);

    expect(named(recover(exported(doc)), "block").pivot).toBeUndefined();
  });

  it("tells two parts of one shape apart by their UVs", () => {
    const doc = project([
      { id: "a", name: "a", parentId: "root", partId: "red" },
      { id: "b", name: "b", parentId: "root", partId: "blue" },
    ]);

    const back = recover(exported(doc));

    expect(named(back, "a").partId).toBe("red");
    expect(named(back, "b").partId).toBe("blue");
  });

  it("rebuilds a unit that lands where the one exported did", () => {
    const doc = project([
      {
        id: "hull",
        name: "hull",
        parentId: "root",
        position: [1, 2, 3],
        rotation: [0.3, -0.7, 1.1],
        scale: [2, 0.5, 1.5],
      },
      { id: "mount", name: "mount", parentId: "hull", partId: null },
      {
        id: "gun",
        name: "gun",
        parentId: "mount",
        position: [0, 4, 0],
        rotation: [0, 0.4, 0],
        scale: [-1, 1, 1],
      },
    ]);

    const back = recover(exported(doc));

    const before = points(doc);
    const after = points(back);
    // Two cubes, eight corners each, so there is something to compare.
    expect(before.length).toBe(48);
    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i++) {
      expect(after[i]).toBeCloseTo(before[i], 3);
    }
  });

  it("names the pack it was recovered against", () => {
    const back = recover(exported(project([{ id: "a", name: "a" }])));

    expect(back.packId).toBe("lego");
    expect(back.packVersion).toBe("1");
  });

  it("refuses a model whose geometry is not made of parts", () => {
    const model = exported(project([{ id: "a", name: "a" }]));
    model.root.children[0].vertices[0].uv = [0.9, 0.9];

    const result = recoverProject(model, pack(), {
      name: "n",
      unitName: "n",
      now: "now",
      newId,
    });

    expect(result).toEqual({
      ok: false,
      problem:
        '1 of 1 pieces are not made of parts from the installed packs, starting with "a". Only a model coilbox exported can be turned back into a project.',
    });
  });

  it("refuses a model with a part scaled into a shape it cannot be", () => {
    const model = exported(project([{ id: "a", name: "a" }]));
    // One corner pulled away, which no rotation or scale of the part can do.
    model.root.children[0].vertices[6].pos = [0, 0, 9];

    const result = recoverProject(model, pack(), {
      name: "n",
      unitName: "n",
      now: "now",
      newId,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem).toContain(
      "no rotation and scale put that part where the file has it",
    );
  });

  it("refuses a model whose triangles are wound against how it is placed", () => {
    const model = exported(project([{ id: "a", name: "a" }]));
    const piece = model.root.children[0];
    for (let i = 0; i + 2 < piece.indices.length; i += 3) {
      [piece.indices[i + 1], piece.indices[i + 2]] = [
        piece.indices[i + 2],
        piece.indices[i + 1],
      ];
    }

    const result = recoverProject(model, pack(), {
      name: "n",
      unitName: "n",
      now: "now",
      newId,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem).toContain(
      "wound the wrong way round",
    );
  });

  it("refuses a model drawn as strips rather than triangles", () => {
    const model = exported(project([{ id: "a", name: "a" }]));
    model.root.children[0].primitiveType = 1;

    const result = recoverProject(model, pack(), {
      name: "n",
      unitName: "n",
      now: "now",
      newId,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem).toContain("triangle strip");
  });

  it("refuses a model with no geometry at all", () => {
    const result = recoverProject(exported(project([])), pack(), {
      name: "n",
      unitName: "n",
      now: "now",
      newId,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem).toContain("no geometry");
  });

  it("says so rather than guessing when a part is flat", () => {
    const doc = project([
      { id: "a", name: "a", parentId: "root", partId: "flat" },
    ]);

    const result = recoverProject(exported(doc), pack(), {
      name: "n",
      unitName: "n",
      now: "now",
      newId,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem).toContain("one plane");
  });

  it("counts what it matched and what had no geometry", () => {
    const doc = project([
      { id: "a", name: "a", parentId: "root" },
      { id: "b", name: "b", parentId: "root" },
      { id: "c", name: "c", parentId: "root", partId: null },
    ]);

    const result = recoverProject(exported(doc), pack(), {
      name: "n",
      unitName: "n",
      now: "now",
      newId,
    });

    expect(result.ok && result.recovery.matched).toBe(2);
    // The unit's own root is empty too.
    expect(result.ok && result.recovery.empty).toBe(2);
  });
});

describe("recoveredAtlas", () => {
  const atlases: LegoAtlas[] = [
    { tex1: "atlas.png", packId: "base", folder: null },
    { tex1: "neon.png", packId: "neon", folder: "neon" },
  ];

  it("finds the atlas an export named", () => {
    expect(recoveredAtlas("coilbox_neon.png", atlases)).toBe(atlases[1]);
  });

  it("has nothing to offer for a texture no installed pack ships", () => {
    expect(recoveredAtlas("arm_texture.dds", atlases)).toBeNull();
  });
});
