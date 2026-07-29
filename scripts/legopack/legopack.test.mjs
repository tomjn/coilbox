import { describe, expect, it } from "vitest";

import { buildMesh } from "./mesh.mjs";
import { readObj } from "./obj.mjs";
import { newellNormal, tessellate } from "./tessellate.mjs";

/**
 * A square in the xz plane facing +y, written the way Wings exports one. The
 * corners run counter-clockwise seen from +y, so the winding agrees with the
 * declared normal and nothing needs turning round.
 */
const SQUARE = `
# a part
mtllib legos.mtl
o Part1
g Part1_01 - Default
usemtl 01 - Default
v 0 0 0
v 2 0 0
v 2 0 2
v 0 0 2
vt 0 0
vt 1 0
vt 1 1
vt 0 1
vn 0 1 0
f 1/1/1 4/4/1 3/3/1 2/2/1
`;

/** The same square wound the wrong way round, with the normal left alone. */
const BACKWARDS = SQUARE.replace(
  "f 1/1/1 4/4/1 3/3/1 2/2/1",
  "f 1/1/1 2/2/1 3/3/1 4/4/1",
);

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Every triangle in a built mesh, as its face normal from the winding. */
function triangleNormals(mesh) {
  const out = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const p = [0, 1, 2].map((k) => {
      const at = mesh.indices[t + k] * 8;
      return [mesh.vertices[at], mesh.vertices[at + 1], mesh.vertices[at + 2]];
    });
    out.push(
      cross(
        [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]],
        [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]],
      ),
    );
  }
  return out;
}

describe("readObj", () => {
  it("treats a group as a material run inside an object, not a new part", () => {
    // Wings writes `o Part1` then `g Part1_<Material>`. Splitting on the group
    // would cut every part in two.
    const obj = readObj(SQUARE);
    expect(obj.objects).toHaveLength(1);
    expect(obj.objects[0].name).toBe("Part1");
    expect(obj.objects[0].faces).toHaveLength(1);
    expect(obj.objects[0].faces[0].material).toBe("01 - Default");
  });

  it("falls back to groups when a file has no objects", () => {
    const obj = readObj("g OnlyGroup\nv 0 0 0\nv 1 0 0\nv 0 0 1\nf 1 2 3\n");
    expect(obj.objects.map((o) => o.name)).toEqual(["OnlyGroup"]);
  });

  it("reads every corner form and resolves negative indices", () => {
    const obj = readObj(
      "v 0 0 0\nv 1 0 0\nv 0 0 1\nvt 0 0\nvn 0 1 0\no P\nf 1 2//1 -1/-1/-1\n",
    );
    expect(obj.objects[0].faces[0].corners).toEqual([
      { v: 0, vt: null, vn: null },
      { v: 1, vt: null, vn: 0 },
      { v: 2, vt: 0, vn: 0 },
    ]);
  });

  it("rejects a face index that means nothing", () => {
    expect(() => readObj("v 0 0 0\no P\nf 0 1 2\n")).toThrow(/bad index/);
  });
});

describe("tessellate", () => {
  it("keeps the source winding rather than imposing one", () => {
    const positions = [
      [0, 0, 0],
      [2, 0, 0],
      [2, 0, 2],
      [0, 0, 2],
    ];
    const corners = [{ v: 0 }, { v: 1 }, { v: 2 }, { v: 3 }];
    const faceNormal = newellNormal(positions);

    const { triangles, fanFallback } = tessellate(corners, positions);

    expect(fanFallback).toBe(false);
    expect(triangles).toHaveLength(2);
    for (const triangle of triangles) {
      const p = triangle.map((i) => positions[corners[i].v]);
      const emitted = cross(
        [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]],
        [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]],
      );
      expect(dot(emitted, faceNormal)).toBeGreaterThan(0);
    }
  });

  it("splits a concave face without falling back to a fan", () => {
    const positions = [
      [0, 0, 0],
      [3, 0, 0],
      [3, 0, 1],
      [1, 0, 1],
      [1, 0, 3],
      [0, 0, 3],
    ];
    const corners = positions.map((_, v) => ({ v }));

    const { triangles, fanFallback } = tessellate(corners, positions);

    expect(fanFallback).toBe(false);
    expect(triangles).toHaveLength(4);
  });

  it("leaves a triangle alone", () => {
    const positions = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 0, 1],
    ];
    expect(
      tessellate([{ v: 0 }, { v: 1 }, { v: 2 }], positions).triangles,
    ).toEqual([[0, 1, 2]]);
  });
});

describe("buildMesh", () => {
  it("winds every triangle to agree with the normals the artist shipped", () => {
    const source = readObj(SQUARE);
    const mesh = buildMesh(source.objects[0], source);

    // The face declares +y, so every triangle must face +y whatever order the
    // corners were written in.
    for (const normal of triangleNormals(mesh)) {
      expect(normal[1]).toBeGreaterThan(0);
    }
    expect(mesh.stats.flipped).toBe(0);
  });

  it("turns round a face wound against its own normal", () => {
    // The source contradicts itself. The normal is the artist's intent, so the
    // winding is what gets corrected.
    const source = readObj(BACKWARDS);
    const mesh = buildMesh(source.objects[0], source);

    expect(mesh.stats.flipped).toBeGreaterThan(0);
    for (const normal of triangleNormals(mesh)) {
      expect(normal[1]).toBeGreaterThan(0);
    }
  });

  it("recentres on the bounding box and hashes the geometry", () => {
    const source = readObj(SQUARE);
    const mesh = buildMesh(source.objects[0], source);

    expect(mesh.bbox.min[0]).toBeCloseTo(-1);
    expect(mesh.bbox.max[0]).toBeCloseTo(1);
    expect(mesh.plateOrigin[0]).toBeCloseTo(1);
    expect(mesh.id).toMatch(/^[0-9a-f]{12}$/);
  });

  it("gives the same id to a part that only moved on the build plate", () => {
    const here = readObj(SQUARE);
    const moved = readObj(
      SQUARE.replaceAll(
        /^v (\S+) (\S+) (\S+)$/gm,
        (_, x, y, z) => `v ${Number(x) + 40} ${Number(y) - 7} ${Number(z) + 3}`,
      ),
    );

    expect(buildMesh(moved.objects[0], moved).id).toBe(
      buildMesh(here.objects[0], here).id,
    );
  });

  it("drops a triangle that collapses once rounded to float32", () => {
    // Two corners closer together than float32 can tell apart.
    const source = readObj(
      "v 0 0 0\nv 1 0 0\nv 1.0000000001 0 0\nvn 0 1 0\no P\nf 1//1 2//1 3//1\n",
    );
    expect(buildMesh(source.objects[0], source)).toBeNull();
  });

  it("returns null for an object with no faces", () => {
    expect(buildMesh({ name: "empty", faces: [] }, readObj(SQUARE))).toBeNull();
  });
});
