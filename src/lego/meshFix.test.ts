import { describe, expect, it } from "vitest";

import {
  canFixMesh,
  computeSmoothedNormals,
  DEFAULT_SMOOTHING_ANGLE_DEG,
  fixUv,
  hasMeshFix,
} from "./meshFix";

/** One vertex, x/y/z/nx/ny/nz/u/v, matching the s3o vertex record. */
function vertex(
  pos: [number, number, number],
  normal: [number, number, number] = [0, 0, 0],
  uv: [number, number] = [0, 0],
): number[] {
  return [...pos, ...normal, ...uv];
}

describe("canFixMesh", () => {
  it("is true only for a piece with a meshId", () => {
    expect(canFixMesh({ meshId: "m1" })).toBe(true);
    expect(canFixMesh({})).toBe(false);
  });
});

describe("hasMeshFix", () => {
  it("is false for a piece with none of the fix fields set", () => {
    expect(hasMeshFix({})).toBe(false);
    expect(hasMeshFix({ uvFlip: false, uvMirror: false })).toBe(false);
  });

  it("is true when any fix field is set", () => {
    expect(hasMeshFix({ uvFlip: true })).toBe(true);
    expect(hasMeshFix({ uvMirror: true })).toBe(true);
    expect(hasMeshFix({ normalsAngle: 45 })).toBe(true);
  });
});

describe("fixUv", () => {
  it("passes a uv through untouched with no fix set", () => {
    expect(fixUv(0.25, 0.75, {})).toEqual([0.25, 0.75]);
  });

  it("flips v vertically and leaves u alone", () => {
    expect(fixUv(0.25, 0.75, { uvFlip: true })).toEqual([0.25, 0.25]);
  });

  it("mirrors u horizontally and leaves v alone", () => {
    expect(fixUv(0.25, 0.75, { uvMirror: true })).toEqual([0.75, 0.75]);
  });

  it("applies both at once", () => {
    expect(fixUv(0.25, 0.75, { uvFlip: true, uvMirror: true })).toEqual([
      0.75, 0.25,
    ]);
  });
});

describe("DEFAULT_SMOOTHING_ANGLE_DEG", () => {
  it("is the engine's own smoothing rule, in degrees", () => {
    // crates/coilbox-3do/src/read.rs:12: SMOOTH_DOT = 0.45, about 63 degrees.
    expect(DEFAULT_SMOOTHING_ANGLE_DEG).toBe(63);
  });
});

describe("computeSmoothedNormals", () => {
  it("gives a flat quad's two triangles the same normal at every vertex", () => {
    // A unit square in the XZ plane, wound so both triangles face +Y, split
    // into two sharing the diagonal 0-1.
    const vertices = new Float32Array(
      [
        vertex([0, 0, 0]),
        vertex([1, 0, 0]),
        vertex([1, 0, 1]),
        vertex([0, 0, 1]),
      ].flat(),
    );
    const indices = new Uint32Array([0, 2, 1, 0, 3, 2]);

    const { normals, vertexCount } = computeSmoothedNormals(
      vertices,
      indices,
      0,
      4,
      0,
      6,
      DEFAULT_SMOOTHING_ANGLE_DEG,
    );

    // Every face already agrees with every other, so nothing is split.
    expect(vertexCount).toBe(4);
    for (let v = 0; v < 4; v++) {
      expect(normals[v * 3]).toBeCloseTo(0, 5);
      expect(normals[v * 3 + 1]).toBeCloseTo(1, 5);
      expect(normals[v * 3 + 2]).toBeCloseTo(0, 5);
    }
  });

  it("keeps a sharp fold close to each side's own face normal, by splitting the shared edge", () => {
    // Two triangles sharing the edge 0-1 (along X) but folded 90 degrees
    // apart. The one completed by vertex 2 faces +Y, the one completed by
    // vertex 3 faces +Z. A tight smoothing angle should not blend them.
    const vertices = new Float32Array(
      [
        vertex([0, 0, 0]),
        vertex([1, 0, 0]),
        vertex([0, 0, 1]), // completes the +Y face
        vertex([0, 1, 0]), // completes the +Z face
      ].flat(),
    );
    const indices = new Uint32Array([0, 2, 1, 0, 1, 3]);

    const split = computeSmoothedNormals(
      vertices,
      indices,
      0,
      4,
      0,
      6,
      10, // tight enough that a 90 degree fold does not qualify as smooth
    );

    // Vertex 2 only ever touches the +Y face, vertex 3 only the +Z one, so
    // both should read as close to that face's own flat normal, not the
    // averaged diagonal the shared edge 0-1 falls back to.
    expect(split.normals[2 * 3 + 1]).toBeCloseTo(1, 4);
    expect(split.normals[3 * 3 + 2]).toBeCloseTo(1, 4);

    // Vertices 0 and 1 sit on the fold itself and each touch both faces, so
    // each is split in two: one id keeping the +Y face's normal, a new one
    // past the original count carrying the +Z face's.
    expect(split.vertexCount).toBe(6);
    expect(Array.from(split.splitFrom)).toEqual([0, 1]);
    expect(split.normals[0 * 3 + 1]).toBeCloseTo(1, 4); // vertex 0, +Y face
    expect(split.normals[4 * 3 + 2]).toBeCloseTo(1, 4); // split of 0, +Z face
    expect(split.normals[1 * 3 + 1]).toBeCloseTo(1, 4); // vertex 1, +Y face
    expect(split.normals[5 * 3 + 2]).toBeCloseTo(1, 4); // split of 1, +Z face

    // The +Y face (0,2,1) keeps its original corners. The +Z face (0,1,3)
    // has its 0 and 1 corners moved onto the two new split vertices.
    expect(Array.from(split.indices)).toEqual([0, 2, 1, 4, 5, 3]);
  });

  it("does not split a vertex whose faces all agree, even with several of them", () => {
    // A fan of four triangles around vertex 0, all nearly coplanar, sharing
    // the edge 0-1 only pairwise adjacent to each other in sequence.
    const vertices = new Float32Array(
      [
        vertex([0, 0, 0]),
        vertex([1, 0, 0]),
        vertex([1, 0, 1]),
        vertex([0, 0, 1]),
        vertex([-1, 0, 0]),
      ].flat(),
    );
    const indices = new Uint32Array([
      0,
      1,
      2, //
      0,
      2,
      3, //
      0,
      3,
      4, //
    ]);

    const split = computeSmoothedNormals(
      vertices,
      indices,
      0,
      5,
      0,
      9,
      DEFAULT_SMOOTHING_ANGLE_DEG,
    );

    expect(split.vertexCount).toBe(5);
    expect(split.splitFrom.length).toBe(0);
  });
});
