import { describe, expect, it } from "vitest";
import { meshVolume } from "./balance";
import {
  DEFAULT_CYLINDER_SIDES,
  INTERIM_SWATCH_POINTS,
  type LegoShape,
  parseShape,
  shapeBox,
  shapeMesh,
} from "./shapes";

type Vec3 = [number, number, number];

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

  it("has the default number of sides, with caps that share no vertices with the side", () => {
    const mesh = shapeMesh(cylinder([1, 1, 1]));
    const n = DEFAULT_CYLINDER_SIDES;
    // Two rings of the side, and a ring plus a middle for each cap.
    expect(mesh?.vCount).toBe(2 * n + 2 * (n + 1));
    // Two triangles a side, and one a side on each cap.
    expect(mesh?.iCount).toBe(3 * 4 * n);
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

describe("shape UVs", () => {
  const uvsOf = (shape: LegoShape) => {
    const mesh = shapeMesh(shape);
    if (!mesh) throw new Error("no mesh");
    const out = new Set<string>();
    for (let i = 0; i < mesh.vCount; i++) {
      out.add(`${mesh.vertices[i * 8 + 6]},${mesh.vertices[i * 8 + 7]}`);
    }
    return [...out].map((s) => s.split(",").map(Number));
  };

  it("samples the middle of its swatch for every vertex (#3326)", () => {
    expect(uvsOf(cylinder([1, 1, 1], undefined, "green"))).toEqual([
      [0.1836, 0.9648].map(Math.fround),
    ]);
    expect(uvsOf(cylinder([1, 1, 1], undefined, "tan"))).toEqual([
      [0.5952, 0.9648].map(Math.fround),
    ]);
    expect(uvsOf(cylinder([1, 1, 1], undefined, "grey"))).toEqual([
      [0.9795, 0.2969].map(Math.fround),
    ]);
  });

  it("draws an unknown swatch, or none, with the first", () => {
    const first = uvsOf(cylinder([1, 1, 1], undefined, "green"));
    expect(uvsOf(cylinder([1, 1, 1], undefined, "purple"))).toEqual(first);
    expect(uvsOf(cylinder([1, 1, 1], undefined, "toString"))).toEqual(first);
    expect(uvsOf({ kind: "cylinder", size: [1, 1, 1] })).toEqual(first);
    expect(Object.keys(INTERIM_SWATCH_POINTS)[0]).toBe("green");
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
