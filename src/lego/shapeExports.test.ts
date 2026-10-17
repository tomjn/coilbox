/**
 * Every generated shape kind in the three exports (#3336). The kinds come from
 * `shapeKinds`, so a kind added to the generators is covered here with no
 * change to this file.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { derivedCollisionVolume } from "./collisionVolume";
import { buildGlbScene } from "./exportGlb";
import { buildObj } from "./exportObj";
import { bundledSwatches } from "./fixtures/bundledSwatches";
import { checkFootprint } from "./footprint";
import { recoverProject, type S3oModel, type S3oReadPiece } from "./importS3o";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import type { LoadedPack } from "./pack";
import {
  bakedPieces,
  buildS3o,
  type S3oPiece,
  unitBounds,
  unitSize,
} from "./s3oBuild";
import {
  type LegoShape,
  setShapeSwatches,
  shapeKinds,
  shapeMesh,
} from "./shapes";

beforeAll(() => {
  setShapeSwatches(bundledSwatches());
});

type Vec3 = [number, number, number];

function pack(): LoadedPack {
  return {
    manifest: {} as LoadedPack["manifest"],
    library: {
      packs: [],
      atlases: [{ tex1: "atlas.png", packId: "lego", folder: null }],
      dir: "",
      problems: [],
    },
    parts: [],
    byId: new Map(),
    vertices: new Float32Array(),
    indices: new Uint16Array(),
  };
}

function shapeOf(kind: string): LegoShape {
  return { kind, size: [4, 6, 4], swatch: "grey" };
}

function unit(pieces: (Partial<LegoPiece> & { id: string })[]): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "roller",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  return {
    ...base,
    pieces: [
      ...base.pieces,
      ...pieces.map((piece) => ({
        name: piece.id,
        parentId: "root",
        partId: null,
        position: [0, 0, 0] as Vec3,
        rotation: [0, 0, 0] as Vec3,
        scale: [1, 1, 1] as Vec3,
        ...piece,
      })),
    ],
  } satisfies LegoProject;
}

/** The unit with one piece of the kind, set to one side of the root. */
function withKind(kind: string, scale: Vec3 = [1, 1, 1]): LegoProject {
  return unit([
    { id: "part", shape: shapeOf(kind), position: [3, 0, 0], scale },
  ]);
}

function build(project: LegoProject) {
  const built = buildS3o(project, pack(), null, { texture1: "atlas.png" });
  if (!built) throw new Error("no build");
  return built;
}

function flat<T extends { children: T[] }>(root: T): T[] {
  return [root, ...root.children.flatMap(flat)];
}

/** What a write and a read do to a piece: every number becomes a float32. */
function written(piece: S3oPiece): S3oReadPiece {
  const f3 = (v: number[]) => v.map(Math.fround) as Vec3;
  return {
    name: piece.name,
    primitiveType: piece.primitiveType,
    offset: f3(piece.offset),
    vertices: piece.vertices.map((v) => ({
      pos: f3(v.pos),
      normal: f3(v.normal),
      uv: v.uv.map(Math.fround) as [number, number],
    })),
    indices: [...piece.indices],
    children: piece.children.map(written),
  };
}

function box(points: Vec3[]) {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], p[axis]);
      max[axis] = Math.max(max[axis], p[axis]);
    }
  }
  return { min, max };
}

/** Every vertex of the model, with the offsets down to its piece added. */
function modelPoints(root: S3oReadPiece): Vec3[] {
  const walk = (piece: S3oReadPiece, from: Vec3): Vec3[] => {
    const at: Vec3 = [
      from[0] + piece.offset[0],
      from[1] + piece.offset[1],
      from[2] + piece.offset[2],
    ];
    return [
      ...piece.vertices.map(
        (v) => [at[0] + v.pos[0], at[1] + v.pos[1], at[2] + v.pos[2]] as Vec3,
      ),
      ...piece.children.flatMap((child) => walk(child, at)),
    ];
  };
  return walk(root, [0, 0, 0]);
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Triangles whose winding disagrees with their vertex normals. */
function backwardTriangles(piece: S3oPiece): number {
  let backward = 0;
  for (let i = 0; i + 2 < piece.indices.length; i += 3) {
    const [a, b, c] = [0, 1, 2].map(
      (k) => piece.vertices[piece.indices[i + k]],
    );
    const face = cross(
      sub(b.pos as Vec3, a.pos as Vec3),
      sub(c.pos as Vec3, a.pos as Vec3),
    );
    const area = Math.hypot(...face);
    if (area < 1e-9) continue;
    const normal = [0, 1, 2].map(
      (axis) => a.normal[axis] + b.normal[axis] + c.normal[axis],
    );
    const dot = face[0] * normal[0] + face[1] * normal[1] + face[2] * normal[2];
    if (dot < 0) backward++;
  }
  return backward;
}

describe.each(shapeKinds())("a %s in the exports", (kind) => {
  it("reads back from the .s3o with the generated mesh's counts and bounds", () => {
    const model = build(withKind(kind));
    const back: S3oModel = {
      radius: Math.fround(model.radius),
      height: Math.fround(model.height),
      mid: model.mid,
      texture1: model.texture1,
      texture2: model.texture2,
      root: written(model.root),
    };
    const mesh = shapeMesh(shapeOf(kind));
    if (!mesh) throw new Error("no mesh");

    expect(flat(model.root)).toHaveLength(2);
    const shaped = flat(back.root).filter((p) => p.vertices.length > 0);
    expect(shaped).toHaveLength(1);
    expect(shaped[0].vertices).toHaveLength(mesh.vCount);
    expect(shaped[0].indices).toHaveLength(mesh.iCount);
    expect(Math.max(...shaped[0].indices)).toBeLessThan(mesh.vCount);

    const generated = box(
      Array.from({ length: mesh.vCount }, (_, i) => [
        mesh.vertices[i * 8] + 3,
        mesh.vertices[i * 8 + 1],
        mesh.vertices[i * 8 + 2],
      ]),
    );
    const read = box(modelPoints(back.root));
    // The engine's axes may differ from the builder's, so compare extents.
    for (let axis = 0; axis < 3; axis++) {
      expect(read.max[axis] - read.min[axis]).toBeCloseTo(
        generated.max[axis] - generated.min[axis],
        4,
      );
    }
    const baked = box(
      bakedPieces(withKind(kind), pack(), null).world.map(
        (p) => [p.x, p.y, p.z] as Vec3,
      ),
    );
    expect(read.min[1]).toBeCloseTo(baked.min[1], 4);
    expect(read.max[1]).toBeCloseTo(baked.max[1], 4);
  });

  it("writes unit normals and counter-clockwise winding", () => {
    const piece = flat(build(withKind(kind)).root).find(
      (p) => p.vertices.length > 0,
    );
    if (!piece) throw new Error("no geometry");
    for (const { normal } of piece.vertices) {
      expect(Math.hypot(...normal)).toBeCloseTo(1, 4);
    }
    expect(backwardTriangles(piece)).toBe(0);
  });

  it("reverses the winding of a mirrored copy and keeps it facing out", () => {
    const find = (p: LegoProject) =>
      flat(build(p).root).find((piece) => piece.vertices.length > 0);
    const plain = find(withKind(kind));
    const mirrored = find(withKind(kind, [-1, 1, 1]));
    if (!plain || !mirrored) throw new Error("no geometry");
    expect(mirrored.indices.slice(0, 3)).toEqual([
      plain.indices[0],
      plain.indices[2],
      plain.indices[1],
    ]);
    expect(backwardTriangles(mirrored)).toBe(0);
  });

  it("counts in the footprint, collision volume, radius and height", () => {
    const project = withKind(kind);
    const bounds = unitBounds(project, pack(), null);
    expect(bounds.sizeX).toBeGreaterThan(0);
    expect(bounds.sizeY).toBeGreaterThan(0);
    expect(bounds.sizeZ).toBeGreaterThan(0);

    const volume = derivedCollisionVolume(bounds, bounds.mid);
    expect(volume.scales).toEqual([bounds.sizeX, bounds.sizeY, bounds.sizeZ]);

    const model = build(project);
    const size = unitSize(project, pack(), null);
    expect(size.radius).toBeGreaterThan(0);
    expect(size.height).toBeGreaterThan(0);
    expect(model.radius).toBeCloseTo(size.radius, 6);
    expect(model.height).toBeCloseTo(size.height, 6);

    const footprint = checkFootprint(project, pack(), null, false);
    expect(footprint.status).toBe("ok");
  });

  it("is recoverable only as far as it is not a pack part", () => {
    const model = build(withKind(kind));
    const result = recoverProject(
      {
        radius: model.radius,
        height: model.height,
        mid: model.mid,
        texture1: model.texture1,
        texture2: model.texture2,
        root: written(model.root),
      },
      pack(),
      { name: "n", unitName: "n", now: "now", newId: () => "id" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem).toContain('starting with "part"');
      expect(result.problem).toContain("generated shape");
    }
  });

  it("refuses a kind it does not know in all three writers, naming the piece", () => {
    const odd = unit([
      { id: "good", shape: shapeOf(kind) },
      { id: "wobbly", shape: { kind: "torus", size: [1, 1, 1] } },
    ]);
    const message = /"wobbly".*"torus"/;
    expect(() =>
      buildS3o(odd, pack(), null, { texture1: "atlas.png" }),
    ).toThrow(message);
    expect(() =>
      buildObj(odd, pack(), null, { unitName: "u", textureName: null }),
    ).toThrow(message);
    expect(() => buildGlbScene(odd, pack(), null)).toThrow(message);
  });
});

describe("a shape in a mixed unit", () => {
  it("is measured with the rest of the unit", () => {
    const project = unit(
      shapeKinds().map((kind, i) => ({
        id: `s${i}`,
        shape: shapeOf(kind),
        position: [i * 10, 0, 0] as Vec3,
      })),
    );
    const bounds = unitBounds(project, pack(), null);
    expect(bounds.sizeX).toBeGreaterThanOrEqual(
      (shapeKinds().length - 1) * 10 + 4 - 1e-6,
    );
  });
});
