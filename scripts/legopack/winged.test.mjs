import { describe, expect, it } from "vitest";

import { buildMesh } from "./mesh.mjs";
import { cornerNormals } from "./normals.mjs";
import { faceLoops, newellNormal, triangulate } from "./winged.mjs";

/**
 * The smallest hand-checkable winged-edge solid: one triangle with a front face
 * (0) and a back face (1). Every field is written out rather than generated, so
 * the fixture cannot inherit a bug from the code it tests.
 *
 * Face 0 runs v0 -> v1 -> v2 and lies in the xz plane. Under Wings' convention
 * that loops run clockwise seen from outside, face 0 therefore faces +y.
 */
function triangleObject({ hard = [] } = {}) {
  const uv = [
    [0, 0],
    [1, 0],
    [0, 1],
  ];
  return {
    name: "tri",
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 0, 1],
    ],
    faceMaterials: ["front", "back"],
    hardEdges: new Set(hard),
    edges: [
      // vs ve lf rf, left loop e0 -> e1 -> e2, right loop e0 -> e2 -> e1
      {
        vs: 0,
        ve: 1,
        lf: 0,
        rf: 1,
        ltpr: 2,
        ltsu: 1,
        rtpr: 1,
        rtsu: 2,
        uvLt: uv[0],
        uvRt: uv[1],
      },
      {
        vs: 1,
        ve: 2,
        lf: 0,
        rf: 1,
        ltpr: 0,
        ltsu: 2,
        rtpr: 2,
        rtsu: 0,
        uvLt: uv[1],
        uvRt: uv[2],
      },
      {
        vs: 2,
        ve: 0,
        lf: 0,
        rf: 1,
        ltpr: 1,
        ltsu: 0,
        rtpr: 0,
        rtsu: 1,
        uvLt: uv[2],
        uvRt: uv[0],
      },
    ],
  };
}

/** A square in the xz plane, as one face with four corners. */
function quadLoop() {
  return {
    positions: [
      [0, 0, 0],
      [2, 0, 0],
      [2, 0, 2],
      [0, 0, 2],
    ],
    corners: [{ v: 0 }, { v: 1 }, { v: 2 }, { v: 3 }],
  };
}

/** An L, so ear clipping has a reflex corner to cope with. */
function concaveLoop() {
  return {
    positions: [
      [0, 0, 0],
      [3, 0, 0],
      [3, 0, 1],
      [1, 0, 1],
      [1, 0, 3],
      [0, 0, 3],
    ],
    corners: [{ v: 0 }, { v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }, { v: 5 }],
  };
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function triangleNormal(positions, [i, j, k]) {
  return cross(
    sub(positions[j], positions[i]),
    sub(positions[k], positions[i]),
  );
}

describe("faceLoops", () => {
  it("walks each face and pairs the uv with the corner it belongs to", () => {
    const loops = faceLoops(triangleObject());

    expect(loops[0].material).toBe("front");
    expect(loops[0].corners).toEqual([
      { v: 0, uv: [0, 0] },
      { v: 1, uv: [1, 0] },
      { v: 2, uv: [0, 1] },
    ]);

    // The back face walks the same edges in reverse, taking `ve` and `uvRt`.
    expect(loops[1].corners).toEqual([
      { v: 1, uv: [1, 0] },
      { v: 0, uv: [0, 0] },
      { v: 2, uv: [0, 1] },
    ]);
  });

  it("rejects a face with no incident edge", () => {
    const object = triangleObject();
    object.faceMaterials.push("orphan");
    expect(() => faceLoops(object)).toThrow(/no incident edge/);
  });
});

describe("triangulate", () => {
  it("reverses the winding, because s3o wants the opposite of Wings", () => {
    const { positions, corners } = quadLoop();
    const wingsNormal = newellNormal(corners.map((c) => positions[c.v]));

    const { triangles, fanFallback } = triangulate(corners, positions);

    expect(fanFallback).toBe(false);
    expect(triangles).toHaveLength(2);
    for (const triangle of triangles) {
      const emitted = triangleNormal(
        positions,
        triangle.map((i) => corners[i].v),
      );
      expect(dot(emitted, wingsNormal)).toBeLessThan(0);
    }
  });

  it("reverses the winding whichever way the face happens to point", () => {
    // The same square wound the other way projects with the opposite sign, so
    // this covers the branch where ear clipping has to reverse the polygon.
    const { positions } = quadLoop();
    const corners = [{ v: 3 }, { v: 2 }, { v: 1 }, { v: 0 }];
    const wingsNormal = newellNormal(corners.map((c) => positions[c.v]));

    const { triangles } = triangulate(corners, positions);

    for (const triangle of triangles) {
      const emitted = triangleNormal(
        positions,
        triangle.map((i) => corners[i].v),
      );
      expect(dot(emitted, wingsNormal)).toBeLessThan(0);
    }
  });

  it("handles a concave face without a fan fallback", () => {
    const { positions, corners } = concaveLoop();
    const wingsNormal = newellNormal(corners.map((c) => positions[c.v]));

    const { triangles, fanFallback } = triangulate(corners, positions);

    expect(fanFallback).toBe(false);
    expect(triangles).toHaveLength(corners.length - 2);

    // Every triangle faces away from the Wings normal, which a naive fan would
    // not manage across the reflex corner.
    for (const triangle of triangles) {
      const emitted = triangleNormal(
        positions,
        triangle.map((i) => corners[i].v),
      );
      expect(dot(emitted, wingsNormal)).toBeLessThan(0);
    }
  });

  it("keeps a triangle as one triangle", () => {
    const { triangles } = triangulate(
      [{ v: 0 }, { v: 1 }, { v: 2 }],
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 0, 1],
      ],
    );
    expect(triangles).toEqual([[0, 2, 1]]);
  });
});

describe("cornerNormals", () => {
  it("points normals outward, not along the raw Wings loop", () => {
    const object = triangleObject();
    const normals = cornerNormals(object, faceLoops(object));

    // Face 0 runs v0 -> v1 -> v2, whose Newell normal is -y, so outward is +y.
    for (const normal of normals[0]) {
      expect(normal[1]).toBeGreaterThan(0.99);
    }
    for (const normal of normals[1]) {
      expect(normal[1]).toBeLessThan(-0.99);
    }
  });

  it("smooths across a soft edge and creases at a hard one", () => {
    // Two faces meeting at a right angle along the shared edge. Soft: the
    // shared corners average to a 45 degree normal. Hard: each keeps its own.
    const object = {
      name: "fold",
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [1, 0, 1],
        [0, 0, 1],
        [1, 1, 0],
        [1, 1, 1],
      ],
      faceMaterials: ["a", "b"],
      hardEdges: new Set(),
      edges: [],
    };

    // Only the topology the normal code reads: the shared edge between faces.
    object.edges = [
      { vs: 1, ve: 2, lf: 0, rf: 1, ltpr: 0, ltsu: 0, rtpr: 0, rtsu: 0 },
    ];
    const loops = [
      { material: "a", corners: [{ v: 0 }, { v: 1 }, { v: 2 }, { v: 3 }] },
      { material: "b", corners: [{ v: 1 }, { v: 4 }, { v: 5 }, { v: 2 }] },
    ];

    const soft = cornerNormals(object, loops);
    const sharedSoft = soft[0][1];
    expect(Math.abs(sharedSoft[0])).toBeGreaterThan(0.5);
    expect(Math.abs(sharedSoft[1])).toBeGreaterThan(0.5);

    object.hardEdges = new Set([0]);
    const hard = cornerNormals(object, loops);
    const sharedHard = hard[0][1];
    expect(Math.abs(sharedHard[1])).toBeGreaterThan(0.99);
  });
});

describe("buildMesh", () => {
  it("recentres on the bounding box and hashes the geometry", () => {
    const object = triangleObject();
    object.vertices = object.vertices.map(([x, y, z]) => [x + 100, y, z + 100]);

    const mesh = buildMesh(object);

    expect(mesh.indices).toHaveLength(6); // two faces, one triangle each
    expect(mesh.bbox.min[0]).toBeCloseTo(-0.5);
    expect(mesh.bbox.max[0]).toBeCloseTo(0.5);
    expect(mesh.plateOrigin[0]).toBeCloseTo(100.5);
    expect(mesh.id).toMatch(/^[0-9a-f]{12}$/);
  });

  it("gives the same id to a part that only moved on the build plate", () => {
    const here = buildMesh(triangleObject());
    const moved = triangleObject();
    moved.vertices = moved.vertices.map(([x, y, z]) => [x + 40, y - 7, z + 3]);

    expect(buildMesh(moved).id).toBe(here.id);
  });

  it("fills a missing uv with the part average rather than the atlas origin", () => {
    const object = triangleObject();
    object.edges[0].uvLt = null;

    const mesh = buildMesh(object);

    expect(mesh.stats.cornersWithoutUv).toBeGreaterThan(0);
    const uvs = [];
    for (let i = 0; i < mesh.vertices.length; i += 8) {
      uvs.push([mesh.vertices[i + 6], mesh.vertices[i + 7]]);
    }
    expect(uvs.some(([u, v]) => u !== 0 || v !== 0)).toBe(true);
    // The average of the remaining uvs, never (0, 0).
    expect(uvs.every(([u, v]) => u >= 0 && v >= 0)).toBe(true);
  });

  it("returns null for an object with no geometry", () => {
    expect(
      buildMesh({
        name: "empty",
        vertices: [],
        edges: [],
        faceMaterials: [],
        hardEdges: new Set(),
      }),
    ).toBeNull();
  });
});
