import { beforeAll, describe, expect, it } from "vitest";
import { meshVolume } from "./balance";
import { bundledSwatches } from "./fixtures/bundledSwatches";
import {
  coneTopRadius,
  cutAndTile,
  DEFAULT_CYLINDER_SIDES,
  isKnownShapeKind,
  type LegoShape,
  parseShape,
  SHAPE_KINDS,
  type ShapeMesh,
  type ShapeSwatch,
  setShapeSwatches,
  shapeBox,
  shapeKey,
  shapeMesh,
  shapeSwatches,
  tubeInnerRadius,
  wedgeProfile,
} from "./shapes";

beforeAll(() => {
  setShapeSwatches(bundledSwatches());
});

type Vec3 = [number, number, number];

describe("SHAPE_KINDS", () => {
  it("lists only kinds this build can make, once each, with a name and a size", () => {
    const kinds = SHAPE_KINDS.map((info) => info.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    for (const info of SHAPE_KINDS) {
      expect(isKnownShapeKind(info.kind)).toBe(true);
      expect(info.label).not.toBe("");
      expect(info.size.every((n) => n > 0)).toBe(true);
      expect(shapeMesh({ kind: info.kind, size: info.size })).not.toBeNull();
    }
  });
});

function cylinder(
  size: Vec3,
  options?: Record<string, number>,
  swatch = "green",
): LegoShape {
  return { kind: "cylinder", size, swatch, ...(options ? { options } : {}) };
}

function positionsOf(shape: LegoShape): Vec3[] {
  const mesh = shapeMesh(shape);
  if (!mesh) throw new Error("no mesh");
  const out: Vec3[] = [];
  for (let i = 0; i < mesh.vCount; i++) {
    const at = i * 8;
    out.push([mesh.vertices[at], mesh.vertices[at + 1], mesh.vertices[at + 2]]);
  }
  return out;
}

function meshBounds(points: Vec3[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], p[a]);
      max[a] = Math.max(max[a], p[a]);
    }
  }
  return { min, max };
}

describe("shapeBox", () => {
  it("is the size, centred on the origin, without making the mesh", () => {
    expect(shapeBox(cylinder([2, 4, 2]))).toEqual({
      min: [-1, -2, -1],
      max: [1, 2, 1],
    });
  });

  it("has no box for a kind this build does not know", () => {
    expect(
      shapeBox({ kind: "teapot", size: [1, 1, 1], swatch: "green" }),
    ).toBeNull();
  });
});

describe("cylinder mesh", () => {
  it("has the box its size says, whatever the axis and side count", () => {
    for (const axis of [0, 1, 2]) {
      for (const sides of [3, 5, 7, 12, 13]) {
        const shape = cylinder([1.5, 2.25, 0.75], { axis, sides });
        const bounds = meshBounds(positionsOf(shape));
        const box = shapeBox(shape);
        for (let a = 0; a < 3; a++) {
          expect(bounds.min[a]).toBeCloseTo(box?.min[a] ?? NaN, 6);
          expect(bounds.max[a]).toBeCloseTo(box?.max[a] ?? NaN, 6);
        }
      }
    }
  });

  it("runs along y by default and along the axis it is given", () => {
    // An upright cylinder's caps face up and down.
    const upright = shapeMesh(cylinder([1, 2, 1]));
    const lying = shapeMesh(cylinder([2, 1, 1], { axis: 0 }));
    const capNormals = (mesh: NonNullable<typeof upright>) => {
      const seen = new Set<string>();
      for (let i = 0; i < mesh.vCount; i++) {
        const n = [0, 1, 2].map((k) =>
          Math.round(mesh.vertices[i * 8 + 3 + k]),
        );
        if (n.some((v) => Math.abs(v) === 1)) seen.add(n.join(","));
      }
      return seen;
    };
    expect(capNormals(upright as NonNullable<typeof upright>)).toContain(
      "0,1,0",
    );
    expect(capNormals(lying as NonNullable<typeof lying>)).toContain("1,0,0");
  });

  it("has caps that share no vertices with the side", () => {
    const mesh = shapeMesh(cylinder([2, 3, 2]));
    if (!mesh) throw new Error("no mesh");
    // Every normal is along the axis, on a cap, or across it, on the side.
    for (let i = 0; i < mesh.vCount; i++) {
      const ny = mesh.vertices[i * 8 + 4];
      expect(Math.abs(ny) < 1e-6 || Math.abs(Math.abs(ny) - 1) < 1e-6).toBe(
        true,
      );
    }
    // Two triangles a side and one a side on each cap, before cutting.
    expect(mesh.iCount).toBeGreaterThanOrEqual(3 * 4 * DEFAULT_CYLINDER_SIDES);
  });

  it("winds every triangle counter clockwise seen from outside", () => {
    for (const axis of [0, 1, 2]) {
      const shape = cylinder([1, 3, 2], { axis, sides: 9 });
      const mesh = shapeMesh(shape);
      const points = positionsOf(shape);
      if (!mesh) throw new Error("no mesh");
      for (let t = 0; t < mesh.iCount; t += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => points[mesh.indices[t + k]]);
        const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const face = [
          ab[1] * ac[2] - ab[2] * ac[1],
          ab[2] * ac[0] - ab[0] * ac[2],
          ab[0] * ac[1] - ab[1] * ac[0],
        ];
        const middle = [0, 1, 2].map((k) => (a[k] + b[k] + c[k]) / 3);
        // The shape is convex and centred on the origin.
        expect(
          face[0] * middle[0] + face[1] * middle[1] + face[2] * middle[2],
        ).toBeGreaterThan(0);
      }
    }
  });

  it("has unit normals", () => {
    const mesh = shapeMesh(cylinder([1, 2, 3], { sides: 7 }));
    if (!mesh) throw new Error("no mesh");
    for (let i = 0; i < mesh.vCount; i++) {
      const [x, y, z] = [3, 4, 5].map((k) => mesh.vertices[i * 8 + k]);
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
    }
  });

  it("is a closed solid of the polygon's area times its length", () => {
    const sides = 12;
    const shape = cylinder([2, 3, 2], { sides });
    const mesh = shapeMesh(shape);
    if (!mesh) throw new Error("no mesh");
    const measured = meshVolume(positionsOf(shape), [...mesh.indices]);
    expect(measured.closed).toBe(true);
    // A regular polygon of radius 1.
    const area = (sides / 2) * Math.sin((2 * Math.PI) / sides);
    expect(measured.volume).toBeCloseTo(area * 3, 6);
    measured.centre.forEach((v) => {
      expect(v).toBeCloseTo(0, 6);
    });
  });

  it("is made once for the same numbers", () => {
    expect(shapeMesh(cylinder([1, 2, 1]))).toBe(shapeMesh(cylinder([1, 2, 1])));
    expect(shapeMesh(cylinder([1, 2, 1]))).not.toBe(
      shapeMesh(cylinder([1, 2.25, 1])),
    );
  });

  it("falls back to the defaults for an axis or side count it cannot use", () => {
    const fallback = shapeMesh(cylinder([1, 2, 1], { axis: 7, sides: 2 }));
    const plain = shapeMesh(cylinder([1, 2, 1]));
    expect(fallback?.vCount).toBe(plain?.vCount);
    expect([...(fallback?.vertices ?? [])]).toEqual([
      ...(plain?.vertices ?? []),
    ]);
  });
});

function tube(
  size: Vec3,
  options?: Record<string, number>,
  swatch = "green",
): LegoShape {
  return { kind: "tube", size, swatch, ...(options ? { options } : {}) };
}

function triangles(mesh: ShapeMesh) {
  const out: { p: Vec3[]; n: Vec3[]; uv: [number, number][] }[] = [];
  const at = (i: number, from: number, count: number) =>
    Array.from({ length: count }, (_, k) => mesh.vertices[i * 8 + from + k]);
  for (let t = 0; t < mesh.iCount; t += 3) {
    const ids = [0, 1, 2].map((k) => mesh.indices[t + k]);
    out.push({
      p: ids.map((i) => at(i, 0, 3) as Vec3),
      n: ids.map((i) => at(i, 3, 3) as Vec3),
      uv: ids.map((i) => at(i, 6, 2) as [number, number]),
    });
  }
  return out;
}

function faceOf([a, b, c]: Vec3[]): Vec3 {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
}

describe("tube mesh", () => {
  it("has the box its size says, whatever the axis", () => {
    for (const axis of [0, 1, 2]) {
      const shape = tube([1.5, 2.25, 0.75], { axis, sides: 7, inner: 0.2 });
      const bounds = meshBounds(positionsOf(shape));
      const box = shapeBox(shape);
      for (let a = 0; a < 3; a++) {
        expect(bounds.min[a]).toBeCloseTo(box?.min[a] ?? NaN, 6);
        expect(bounds.max[a]).toBeCloseTo(box?.max[a] ?? NaN, 6);
      }
    }
  });

  it("is a closed solid of the ring's area times its length", () => {
    const sides = 12;
    const mesh = shapeMesh(tube([2, 3, 2], { sides, inner: 0.6 }));
    if (!mesh) throw new Error("no mesh");
    const measured = meshVolume(
      positionsOf(tube([2, 3, 2], { sides, inner: 0.6 })),
      [...mesh.indices],
    );
    expect(measured.closed).toBe(true);
    const polygon = (r: number) =>
      (sides / 2) * r * r * Math.sin((2 * Math.PI) / sides);
    expect(measured.volume).toBeCloseTo((polygon(1) - polygon(0.6)) * 3, 6);
  });

  it("faces its hole inwards and winds it to be seen from inside", () => {
    const mesh = shapeMesh(tube([2, 3, 2], { sides: 9, inner: 0.5 }));
    if (!mesh) throw new Error("no mesh");
    let inner = 0;
    for (const { p, n } of triangles(mesh)) {
      const face = faceOf(p);
      // Each triangle's winding agrees with the way its vertices face.
      for (const normal of n) {
        expect(
          face[0] * normal[0] + face[1] * normal[1] + face[2] * normal[2],
        ).toBeGreaterThan(0);
      }
      const middle = [0, 1, 2].map((k) => (p[0][k] + p[1][k] + p[2][k]) / 3);
      const across = Math.hypot(middle[0], middle[2]);
      if (Math.abs(n[0][1]) < 1e-6 && across < 0.75) {
        inner++;
        // Pointing at the axis.
        expect(n[0][0] * middle[0] + n[0][2] * middle[2]).toBeLessThan(0);
      }
    }
    expect(inner).toBeGreaterThanOrEqual(2 * 9);
  });

  it("uses half the outer radius for a hole it cannot use", () => {
    expect(tubeInnerRadius(tube([2, 1, 2]))).toBe(0.5);
    expect(tubeInnerRadius(tube([2, 1, 2], { inner: 1 }))).toBe(0.5);
    expect(tubeInnerRadius(tube([2, 1, 2], { inner: 0 }))).toBe(0.5);
    expect(tubeInnerRadius(tube([2, 1, 2], { inner: 0.8 }))).toBeCloseTo(
      0.8,
      9,
    );
  });

  it("keeps 32 bit indices in range for many sides on a long tube", () => {
    const mesh = shapeMesh(tube([2, 10, 2], { sides: 64, inner: 0.8 }));
    if (!mesh) throw new Error("no mesh");
    expect(Math.max(...mesh.indices)).toBeLessThan(mesh.vCount);
  });
});

function wedge(
  size: Vec3,
  options?: Record<string, number>,
  swatch = "green",
): LegoShape {
  return { kind: "wedge", size, swatch, ...(options ? { options } : {}) };
}

function cone(
  size: Vec3,
  options?: Record<string, number>,
  swatch = "green",
): LegoShape {
  return { kind: "cone", size, swatch, ...(options ? { options } : {}) };
}

describe("cone mesh (#3329)", () => {
  const TOPS = [0, 0.3, 0.9];

  it("has the box its size says, whatever the axis, top and side count", () => {
    for (const axis of [0, 1, 2]) {
      for (const top of TOPS) {
        for (const sides of [3, 5, 12, 24]) {
          const shape = cone([2, 3, 2], { axis, top, sides });
          const bounds = meshBounds(positionsOf(shape));
          const box = shapeBox(shape);
          for (let a = 0; a < 3; a++) {
            expect(bounds.min[a]).toBeCloseTo(box?.min[a] ?? NaN, 6);
            expect(bounds.max[a]).toBeCloseTo(box?.max[a] ?? NaN, 6);
          }
        }
      }
    }
  });

  it("is a closed solid with the volume of a frustum of its polygon", () => {
    const radius = 1.5;
    const height = 4;
    for (const top of [0, 0.6, 1.2]) {
      const shape = cone([3, height, 3], { top, sides: 12 });
      const mesh = shapeMesh(shape);
      if (!mesh) throw new Error("no mesh");
      const volume = meshVolume(positionsOf(shape), [...mesh.indices]);
      const base = 0.5 * 12 * radius * radius * Math.sin((2 * Math.PI) / 12);
      const t = top / radius;
      expect(volume.closed).toBe(true);
      expect(volume.volume).toBeCloseTo(
        (height / 3) * base * (1 + t + t * t),
        4,
      );
    }
  });

  it("narrows from the bottom (-axis) to the top, and to a point with no top", () => {
    const tall = positionsOf(cone([2, 4, 2], { top: 0.5 }));
    const widthAt = (y: number) =>
      Math.max(
        ...tall.filter((p) => Math.abs(p[1] - y) < 1e-6).map((p) => p[0]),
      );
    expect(widthAt(-2)).toBeCloseTo(1, 6);
    expect(widthAt(2)).toBeCloseTo(0.5, 6);
    const pointed = positionsOf(cone([2, 4, 2]));
    expect(
      pointed
        .filter((p) => p[1] > 1.999)
        .every((p) => Math.hypot(p[0], p[2]) < 1e-9),
    ).toBe(true);
  });

  it("gives the tip one normal for each side", () => {
    const sides = 12;
    const mesh = shapeMesh(cone([2, 4, 2], { sides }));
    if (!mesh) throw new Error("no mesh");
    const normals = new Set<string>();
    for (let i = 0; i < mesh.vCount; i++) {
      if (mesh.vertices[i * 8 + 1] < 1.999) continue;
      normals.add(
        [3, 4, 5].map((k) => mesh.vertices[i * 8 + k].toFixed(4)).join(","),
      );
    }
    expect(normals.size).toBe(sides);
  });

  it("leans its side normals out and up by the slope", () => {
    const radius = 1;
    const height = 4;
    for (const top of [0, 0.5]) {
      const mesh = shapeMesh(cone([2, height, 2], { top, sides: 12 }));
      if (!mesh) throw new Error("no mesh");
      // The slope's normal is perpendicular to the way the side runs.
      const lean = radius - top;
      const length = Math.hypot(height, lean);
      let checked = 0;
      for (let i = 0; i < mesh.vCount; i++) {
        const [x, y, z, nx, ny, nz] = Array.from(
          mesh.vertices.slice(i * 8, i * 8 + 6),
        );
        // A vertex of the bottom ring that belongs to the side, not the cap.
        if (Math.abs(y + height / 2) > 1e-6 || ny < -0.5) continue;
        if (Math.hypot(x, z) < radius - 1e-6) continue;
        expect(ny).toBeCloseTo(lean / length, 5);
        expect(Math.hypot(nx, nz)).toBeCloseTo(height / length, 5);
        // Pointing the way the vertex is from the axis.
        expect(nx * x + nz * z).toBeGreaterThan(0);
        checked++;
      }
      expect(checked).toBe(13);
    }
  });

  it("winds every triangle counter clockwise seen from outside", () => {
    for (const top of TOPS) {
      for (const axis of [0, 1, 2]) {
        const mesh = shapeMesh(cone([2, 3, 2], { axis, top, sides: 10 }));
        if (!mesh) throw new Error("no mesh");
        for (const { p, n } of triangles(mesh)) {
          const face = faceOf(p);
          if (Math.hypot(...face) < 1e-9) continue;
          for (const vertex of n) {
            expect(
              face[0] * vertex[0] + face[1] * vertex[1] + face[2] * vertex[2],
            ).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("has unit normals", () => {
    const mesh = shapeMesh(cone([2, 3, 2], { top: 0.4 }));
    if (!mesh) throw new Error("no mesh");
    for (let i = 0; i < mesh.vCount; i++) {
      expect(
        Math.hypot(...Array.from(mesh.vertices.slice(i * 8 + 3, i * 8 + 6))),
      ).toBeCloseTo(1, 5);
    }
  });

  it("reads a top it cannot use as a point", () => {
    for (const top of [-1, 1, 5]) {
      expect(coneTopRadius(cone([2, 3, 2], { top }))).toBe(0);
    }
    expect(coneTopRadius(cone([2, 3, 2]))).toBe(0);
    expect(coneTopRadius(cone([2, 3, 2], { top: 0.4 }))).toBe(0.4);
    expect(coneTopRadius(cone([2, 3, 6], { top: 0.4, axis: 1 }))).toBe(0.4);
  });

  it("keeps a cut cone's top flat and its bottom flat, each with its own normals", () => {
    const mesh = shapeMesh(cone([2, 4, 2], { top: 0.5, sides: 12 }));
    if (!mesh) throw new Error("no mesh");
    for (const [y, ny] of [
      [2, 1],
      [-2, -1],
    ]) {
      const cap = triangles(mesh).filter(({ n }) =>
        n.every((v) => Math.abs(v[1] - ny) < 1e-6),
      );
      expect(cap.length).toBeGreaterThan(0);
      for (const { p } of cap) {
        for (const point of p) expect(point[1]).toBeCloseTo(y, 6);
      }
    }
  });
});

describe("wedge mesh (#3328)", () => {
  it("has the box its size says, for a wedge, a ramp and a flipped one", () => {
    for (const options of [
      {},
      { low: 1 },
      { flip: 1 },
      { low: 3, flip: 1 },
    ] as Record<string, number>[]) {
      const shape = wedge([2, 4, 3], options);
      const bounds = meshBounds(positionsOf(shape));
      const box = shapeBox(shape);
      for (let a = 0; a < 3; a++) {
        expect(bounds.min[a]).toBeCloseTo(box?.min[a] ?? NaN, 6);
        expect(bounds.max[a]).toBeCloseTo(box?.max[a] ?? NaN, 6);
      }
    }
  });

  it("is closed and holds the volume of a prism with a trapezoid end", () => {
    for (const [low, flip] of [
      [0, 0],
      [1, 0],
      [3.5, 1],
      [4, 0],
    ]) {
      const shape = wedge([2, 4, 3], { low, flip });
      const mesh = shapeMesh(shape);
      if (!mesh) throw new Error("no mesh");
      const measured = meshVolume(positionsOf(shape), [...mesh.indices]);
      expect(measured.closed).toBe(true);
      expect(measured.volume).toBeCloseTo((2 * 3 * (4 + low)) / 2, 5);
    }
  });

  it("is high at the back (-z) and low at the front, and flips on request", () => {
    const heightAt = (shape: LegoShape, z: number) =>
      Math.max(
        ...positionsOf(shape)
          .filter((p) => Math.abs(p[2] - z) < 1e-6)
          .map((p) => p[1]),
      );
    const plain = wedge([2, 4, 3], { low: 1 });
    expect(heightAt(plain, -1.5)).toBeCloseTo(2, 6);
    expect(heightAt(plain, 1.5)).toBeCloseTo(-1, 6);
    const flipped = wedge([2, 4, 3], { low: 1, flip: 1 });
    expect(heightAt(flipped, 1.5)).toBeCloseTo(2, 6);
    expect(heightAt(flipped, -1.5)).toBeCloseTo(-1, 6);
  });

  it("makes the sides of a pure wedge triangles and of a ramp four sided", () => {
    // Small enough to sit inside one tile, so nothing is cut and each side face
    // is the triangles it was made of: one for a triangle, two for a quad.
    const sideTriangles = (shape: LegoShape) => {
      const mesh = shapeMesh(shape);
      if (!mesh) throw new Error("no mesh");
      return triangles(mesh).filter(({ n }) => n[0][0] === -1).length;
    };
    expect(sideTriangles(wedge([0.5, 0.8, 1]))).toBe(1);
    expect(sideTriangles(wedge([0.5, 0.8, 1], { low: 0.3 }))).toBe(2);
  });

  it("gives every flat face one normal and the slope one for the whole face", () => {
    const mesh = shapeMesh(wedge([2, 4, 3], { low: 1 }));
    if (!mesh) throw new Error("no mesh");
    const normals = new Set<string>();
    for (let i = 0; i < mesh.vCount; i++) {
      normals.add(
        [3, 4, 5].map((k) => mesh.vertices[i * 8 + k].toFixed(5)).join(","),
      );
    }
    const slope = Math.hypot(3, 3);
    expect([...normals].sort()).toEqual(
      [
        "-1.00000,0.00000,0.00000",
        "1.00000,0.00000,0.00000",
        "0.00000,-1.00000,0.00000",
        "0.00000,0.00000,-1.00000",
        "0.00000,0.00000,1.00000",
        `0.00000,${(3 / slope).toFixed(5)},${(3 / slope).toFixed(5)}`,
      ].sort(),
    );
  });

  it("winds every triangle counter clockwise seen from outside, with its normal", () => {
    for (const options of [
      {},
      { low: 1 },
      { flip: 1 },
      { low: 2, flip: 1 },
    ] as Record<string, number>[]) {
      const mesh = shapeMesh(wedge([2, 4, 3], options));
      if (!mesh) throw new Error("no mesh");
      for (const { p, n } of triangles(mesh)) {
        const face = faceOf(p);
        for (const normal of n) {
          expect(
            face[0] * normal[0] + face[1] * normal[1] + face[2] * normal[2],
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  it("is made once for the same numbers and again for another", () => {
    expect(shapeMesh(wedge([1, 1, 1]))).toBe(shapeMesh(wedge([1, 1, 1])));
    expect(shapeMesh(wedge([1, 1, 1]))).not.toBe(
      shapeMesh(wedge([1, 1, 1], { low: 0.5 })),
    );
  });

  it("reads a low end it cannot use as a pure wedge", () => {
    expect(wedgeProfile(wedge([1, 2, 1], { low: -1 })).low).toBe(0);
    expect(wedgeProfile(wedge([1, 2, 1], { low: 3 })).low).toBe(0);
    expect(wedgeProfile(wedge([1, 2, 1], { low: Number.NaN })).low).toBe(0);
    expect(wedgeProfile(wedge([1, 2, 1], { low: 2 })).low).toBe(2);
    expect(wedgeProfile(wedge([1, 2, 1], { flip: 1 })).flip).toBe(true);
    expect(wedgeProfile(wedge([1, 2, 1])).flip).toBe(false);
  });

  it("unwraps the slope in its own plane, measured from the back", () => {
    // Rise 3 over run 4 is a 5 long slope. Before tiling its v runs 0 to 5, so
    // after tiling no triangle on it is squashed (the density test below).
    const shape = wedge([2, 3, 4]);
    const mesh = shapeMesh(shape);
    if (!mesh) throw new Error("no mesh");
    let area = 0;
    for (const { p, n } of triangles(mesh)) {
      if (n[0][1] > 0.1 && n[0][2] > 0.1) area += Math.hypot(...faceOf(p)) / 2;
    }
    expect(area).toBeCloseTo(2 * 5, 5);
  });
});

/**
 * The pack's own texel density, the area weighted median over every triangle
 * of every part, measured in #3326.
 */
const PACK_DENSITY = 41.1;
/** The bundled atlas is 2048 pixels square. */
const ATLAS = 2048;
/**
 * How far a shape's density may sit from the pack's. The swatches are a
 * whole number of 1/10000 UV steps and `tile` is two decimals, which leaves
 * 40.96 pixels a unit across and 41.09 along. 1% covers that.
 */
const DENSITY_TOLERANCE = 0.01;

describe("shape UVs (#3326)", () => {
  const SIZES: Vec3[] = [
    [2, 0.5, 2],
    [1, 6, 1],
    [4, 4, 4],
    [2, 10, 2],
    [0.3, 0.3, 0.3],
    [3, 1.7, 1.2],
  ];
  const shapes = () =>
    SIZES.flatMap((size) =>
      [0, 1, 2].flatMap((axis) =>
        shapeSwatches().flatMap((swatch) => [
          cylinder(size, { axis }, swatch.id),
          tube(
            size,
            { axis, inner: Math.min(size[0], size[2]) / 4 },
            swatch.id,
          ),
        ]),
      ),
    )
      .concat(
        SIZES.flatMap((size) =>
          [0, 1, 2].flatMap((axis) =>
            shapeSwatches().flatMap((swatch) =>
              [0, 0.3, 0.95].map((share) =>
                cone(
                  size,
                  {
                    axis,
                    top:
                      (share *
                        Math.min(size[(axis + 1) % 3], size[(axis + 2) % 3])) /
                      2,
                  },
                  swatch.id,
                ),
              ),
            ),
          ),
        ),
      )
      .concat(
        SIZES.flatMap((size) =>
          shapeSwatches().flatMap((swatch) =>
            (
              [
                {},
                { low: size[1] / 2 },
                { flip: 1 },
                { low: size[1], flip: 1 },
              ] as Record<string, number>[]
            ).map((options) => wedge(size, options, swatch.id)),
          ),
        ),
      );

  it("has three swatches from the bundled pack", () => {
    expect(shapeSwatches().map((s) => s.id)).toEqual(["green", "tan", "grey"]);
  });

  it("puts every UV inside the shape's swatch, at any size", () => {
    // Collected rather than expected one by one: there are a few hundred
    // thousand values, and an expect each is slow enough to time out under load.
    const outside: string[] = [];
    for (const shape of shapes()) {
      const mesh = shapeMesh(shape);
      if (!mesh) throw new Error("no mesh");
      const swatch = shapeSwatches().find((s) => s.id === shape.swatch);
      if (!swatch) throw new Error("no swatch");
      for (let i = 0; i < mesh.vCount; i++) {
        for (const k of [0, 1]) {
          const uv = mesh.vertices[i * 8 + 6 + k];
          if (
            uv < Math.fround(swatch.uv.min[k]) - 1e-7 ||
            uv > Math.fround(swatch.uv.max[k]) + 1e-7
          ) {
            outside.push(`${shapeKey(shape)} vertex ${i} uv ${k}: ${uv}`);
          }
        }
      }
    }
    expect(outside).toEqual([]);
  });

  it("draws every triangle at the pack's density, at any size", () => {
    for (const shape of shapes()) {
      const mesh = shapeMesh(shape);
      if (!mesh) throw new Error("no mesh");
      for (const { p, uv } of triangles(mesh)) {
        const area = Math.hypot(...faceOf(p));
        const uvArea = Math.abs(
          (uv[1][0] - uv[0][0]) * (uv[2][1] - uv[0][1]) -
            (uv[2][0] - uv[0][0]) * (uv[1][1] - uv[0][1]),
        );
        // Slivers along a cut are too small to measure in float32.
        if (area < 1e-4) continue;
        const density = Math.sqrt(uvArea / area) * ATLAS;
        expect(Math.abs(density / PACK_DENSITY - 1)).toBeLessThan(
          DENSITY_TOLERANCE,
        );
      }
    }
  });

  it("keeps the mesh closed after cutting", () => {
    for (const shape of shapes()) {
      const mesh = shapeMesh(shape);
      if (!mesh) throw new Error("no mesh");
      expect(meshVolume(positionsOf(shape), [...mesh.indices]).closed).toBe(
        true,
      );
    }
  });

  it("draws an unknown swatch, or none, with the first", () => {
    const uvs = (shape: LegoShape) => [...(shapeMesh(shape)?.vertices ?? [])];
    const first = uvs(cylinder([1, 1, 1], undefined, "green"));
    expect(uvs(cylinder([1, 1, 1], undefined, "purple"))).toEqual(first);
    expect(uvs({ kind: "cylinder", size: [1, 1, 1] })).toEqual(first);
  });

  it("samples nothing but (0, 0) when the pack lists no swatches", () => {
    const before = shapeSwatches();
    setShapeSwatches([]);
    try {
      const mesh = shapeMesh(cylinder([1, 1, 1]));
      if (!mesh) throw new Error("no mesh");
      for (let i = 0; i < mesh.vCount; i++) {
        expect(mesh.vertices[i * 8 + 6]).toBe(0);
        expect(mesh.vertices[i * 8 + 7]).toBe(0);
      }
    } finally {
      setShapeSwatches(before);
    }
  });
});

describe("cutAndTile", () => {
  const swatch: ShapeSwatch = {
    id: "s",
    uv: { min: [0.5, 0.25], max: [0.75, 0.5] },
    tile: 2,
  };
  // A strip 6 long and 1 high, two triangles, unwrapped as it lies.
  const strip = {
    positions: [0, 0, 0, 6, 0, 0, 6, 1, 0, 0, 1, 0],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    indices: [0, 1, 2, 0, 2, 3],
    unwrapped: [0, 0, 6, 0, 6, 1, 0, 1],
  };

  it("cuts where each tile ends and shares the vertices along a cut", () => {
    const out = cutAndTile(strip, swatch);
    // Three tiles across: four columns of two vertices, and the two places the
    // diagonal crosses a cut.
    expect(out.positions.length / 3).toBe(10);
    const xs = new Set<number>();
    for (let i = 0; i < out.positions.length; i += 3) xs.add(out.positions[i]);
    expect([...xs].sort((a, b) => a - b)).toEqual([0, 2, 4, 6]);
  });

  it("runs every other tile backwards", () => {
    const out = cutAndTile(strip, swatch);
    const uAt = new Map<number, number>();
    for (let i = 0; i < out.positions.length / 3; i++) {
      uAt.set(out.positions[i * 3], out.uvs[i * 2]);
    }
    expect([0, 2, 4, 6].map((x) => uAt.get(x))).toEqual([0.5, 0.75, 0.5, 0.75]);
  });

  it("keeps the winding", () => {
    const out = cutAndTile(strip, swatch);
    for (let t = 0; t < out.indices.length; t += 3) {
      const p = [0, 1, 2].map((k) => {
        const i = out.indices[t + k];
        return out.positions.slice(i * 3, i * 3 + 3) as Vec3;
      });
      expect(faceOf(p)[2]).toBeGreaterThan(0);
    }
  });
});

describe("parseShape", () => {
  it("reads a shape back as it was written", () => {
    const shape = cylinder([1, 2, 3], { axis: 0, sides: 16 }, "tan");
    expect(parseShape(JSON.parse(JSON.stringify(shape)))).toEqual(shape);
  });

  it("keeps a kind it does not know, so a newer file is not damaged", () => {
    expect(
      parseShape({ kind: "torus", size: [1, 1, 1], swatch: "grey" }),
    ).toEqual({ kind: "torus", size: [1, 1, 1], swatch: "grey" });
  });

  it("leaves a shape with no swatch without one", () => {
    expect(
      parseShape({ kind: "cylinder", size: [1, 1, 1], swatch: 3 }),
    ).toEqual({ kind: "cylinder", size: [1, 1, 1] });
  });

  it("drops options that are not numbers", () => {
    expect(
      parseShape({
        kind: "cylinder",
        size: [1, 1, 1],
        swatch: "green",
        options: { sides: 8, axis: "y", other: null },
      }),
    ).toEqual({
      kind: "cylinder",
      size: [1, 1, 1],
      swatch: "green",
      options: { sides: 8 },
    });
  });

  it("refuses a shape with no kind or no usable size", () => {
    expect(parseShape(null)).toBeNull();
    expect(parseShape({ size: [1, 1, 1] })).toBeNull();
    expect(parseShape({ kind: "", size: [1, 1, 1] })).toBeNull();
    expect(parseShape({ kind: "cylinder" })).toBeNull();
    expect(parseShape({ kind: "cylinder", size: [1, 0, 1] })).toBeNull();
    expect(parseShape({ kind: "cylinder", size: [1, -1, 1] })).toBeNull();
    expect(parseShape({ kind: "cylinder", size: [1, 1] })).toBeNull();
    expect(parseShape({ kind: "cylinder", size: [1, "2", 1] })).toBeNull();
  });
});
