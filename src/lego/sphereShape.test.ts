import { beforeAll, describe, expect, it } from "vitest";
import { meshVolume } from "./balance";
import { bundledSwatches } from "./fixtures/bundledSwatches";
import {
  DEFAULT_SPHERE_RINGS,
  DEFAULT_SPHERE_SIDES,
  isKnownShapeKind,
  isRoundShapeKind,
  type LegoShape,
  type ShapeMesh,
  SPHERE_BOWL,
  SPHERE_DOME,
  SPHERE_WHOLE,
  setShapeSwatches,
  shapeBox,
  shapeKey,
  shapeMesh,
  shapeSwatches,
  sphereProfile,
} from "./shapes";

beforeAll(() => {
  setShapeSwatches(bundledSwatches());
});

type Vec3 = [number, number, number];

function sphere(
  size: Vec3,
  options?: Record<string, number>,
  swatch = "green",
): LegoShape {
  return { kind: "sphere", size, swatch, ...(options ? { options } : {}) };
}

function meshOf(shape: LegoShape): ShapeMesh {
  const mesh = shapeMesh(shape);
  if (!mesh) throw new Error("no mesh");
  return mesh;
}

function positionsOf(mesh: ShapeMesh): Vec3[] {
  return Array.from({ length: mesh.vCount }, (_, i) => [
    mesh.vertices[i * 8],
    mesh.vertices[i * 8 + 1],
    mesh.vertices[i * 8 + 2],
  ]);
}

function normalOf(mesh: ShapeMesh, i: number): Vec3 {
  return [
    mesh.vertices[i * 8 + 3],
    mesh.vertices[i * 8 + 4],
    mesh.vertices[i * 8 + 5],
  ];
}

function triangles(mesh: ShapeMesh) {
  const at = (i: number, from: number, count: number) =>
    Array.from({ length: count }, (_, k) => mesh.vertices[i * 8 + from + k]);
  const out: { p: Vec3[]; n: Vec3[]; uv: [number, number][] }[] = [];
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

function uvAreaOf(uv: [number, number][]): number {
  return (
    Math.abs(
      (uv[1][0] - uv[0][0]) * (uv[2][1] - uv[0][1]) -
        (uv[2][0] - uv[0][0]) * (uv[1][1] - uv[0][1]),
    ) / 2
  );
}

const KEEPS = [SPHERE_WHOLE, SPHERE_DOME, SPHERE_BOWL];

describe("sphere mesh (#3330)", () => {
  it("is a known kind, and not a round one for wheels", () => {
    expect(isKnownShapeKind("sphere")).toBe(true);
    // A sphere has no axis to spin about, which is what wheel alignment reads.
    expect(isRoundShapeKind("sphere")).toBe(false);
  });

  it("has the box its size says, whatever it keeps, its rings and sides", () => {
    for (const keep of KEEPS) {
      for (const rings of [2, 3, 6]) {
        for (const sides of [3, 5, 12]) {
          const shape = sphere([2, 3, 4], { keep, rings, sides });
          const points = positionsOf(meshOf(shape));
          const box = shapeBox(shape);
          for (let a = 0; a < 3; a++) {
            const values = points.map((p) => p[a]);
            expect(Math.min(...values)).toBeCloseTo(box?.min[a] ?? NaN, 6);
            expect(Math.max(...values)).toBeCloseTo(box?.max[a] ?? NaN, 6);
          }
        }
      }
    }
  });

  it("is closed, and a dome is half the sphere of the same radii", () => {
    const whole = meshOf(sphere([2, 2, 2], { rings: 5, sides: 12 }));
    const dome = meshOf(
      sphere([2, 1, 2], { keep: SPHERE_DOME, rings: 5, sides: 12 }),
    );
    const bowl = meshOf(
      sphere([2, 1, 2], { keep: SPHERE_BOWL, rings: 5, sides: 12 }),
    );
    const volumes = [whole, dome, bowl].map((mesh) =>
      meshVolume(positionsOf(mesh), [...mesh.indices]),
    );
    expect(volumes.map((v) => v.closed)).toEqual([true, true, true]);
    expect(volumes[1].volume).toBeCloseTo(volumes[0].volume / 2, 4);
    expect(volumes[2].volume).toBeCloseTo(volumes[0].volume / 2, 4);
    // The polyhedron sits inside the sphere it approximates.
    expect(volumes[0].volume).toBeLessThan((4 / 3) * Math.PI);
    expect(volumes[0].volume).toBeGreaterThan(0.9 * (4 / 3) * Math.PI);
  });

  it("can be an ellipsoid, its three radii the box's halves", () => {
    const mesh = meshOf(sphere([2, 6, 4], { rings: 16, sides: 32 }));
    for (const p of positionsOf(mesh)) {
      const reach = p[0] ** 2 + (p[1] / 3) ** 2 + (p[2] / 2) ** 2;
      expect(reach).toBeLessThanOrEqual(1 + 1e-6);
      expect(reach).toBeGreaterThan(0.95);
    }
  });

  it("winds every triangle counter clockwise seen from outside", () => {
    for (const keep of KEEPS) {
      for (const sides of [3, 8, 12]) {
        const mesh = meshOf(sphere([2, 2, 2], { keep, sides, rings: 4 }));
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

  it("has unit normals pointing out from the centre", () => {
    const mesh = meshOf(sphere([2, 2, 2], { rings: 4, sides: 12 }));
    const points = positionsOf(mesh);
    for (let i = 0; i < mesh.vCount; i++) {
      const n = normalOf(mesh, i);
      expect(Math.hypot(...n)).toBeCloseTo(1, 5);
      // On a sphere about the origin the normal is the direction of the
      // position. A point where a triangle was cut for tiling sits on its flat
      // face, a little inside, so allow for that.
      const along = Math.hypot(...points[i]);
      const dot =
        n[0] * points[i][0] + n[1] * points[i][1] + n[2] * points[i][2];
      expect(dot / along).toBeGreaterThan(0.98);
    }
  });

  it("makes each pole a point with a normal along y", () => {
    const mesh = meshOf(sphere([2, 2, 2], { rings: 3, sides: 8 }));
    const poles = positionsOf(mesh)
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => Math.abs(p[1]) > 1 - 1e-6);
    expect(poles.length).toBeGreaterThan(0);
    for (const { p, i } of poles) {
      expect(Math.hypot(p[0], p[2])).toBeLessThan(1e-6);
      const n = normalOf(mesh, i);
      expect(n[0]).toBeCloseTo(0, 6);
      expect(n[1]).toBeCloseTo(Math.sign(p[1]), 6);
      expect(n[2]).toBeCloseTo(0, 6);
    }
  });

  it("gives a dome a flat base of its own vertices, facing down", () => {
    const mesh = meshOf(
      sphere([2, 1, 2], { keep: SPHERE_DOME, rings: 4, sides: 12 }),
    );
    const points = positionsOf(mesh);
    let flat = 0;
    for (let i = 0; i < mesh.vCount; i++) {
      if (normalOf(mesh, i)[1] === -1) {
        flat++;
        // Every vertex that faces straight down is on the base plane.
        expect(points[i][1]).toBeCloseTo(-0.5, 6);
      }
    }
    // The disc's middle and rim, which the curved surface does not share.
    expect(flat).toBeGreaterThan(12);
  });

  it("hangs a bowl from a flat base facing up", () => {
    const mesh = meshOf(
      sphere([2, 1, 2], { keep: SPHERE_BOWL, rings: 4, sides: 12 }),
    );
    const points = positionsOf(mesh);
    expect(Math.max(...points.map((p) => p[1]))).toBeCloseTo(0.5, 6);
    let flat = 0;
    for (let i = 0; i < mesh.vCount; i++) {
      if (normalOf(mesh, i)[1] === 1) {
        flat++;
        expect(points[i][1]).toBeCloseTo(0.5, 6);
      }
    }
    expect(flat).toBeGreaterThan(12);
  });

  it("is made once for the same numbers and again for another", () => {
    const a = sphere([1, 1, 1], { rings: 4 });
    expect(shapeMesh(a)).toBe(shapeMesh(sphere([1, 1, 1], { rings: 4 })));
    expect(shapeMesh(a)).not.toBe(shapeMesh(sphere([1, 1, 1], { rings: 5 })));
    expect(shapeKey(a)).not.toBe(
      shapeKey(sphere([1, 1, 1], { rings: 4, keep: SPHERE_DOME })),
    );
  });

  it("falls back to the defaults for numbers it cannot use", () => {
    expect(sphereProfile(sphere([1, 1, 1]))).toEqual({
      keep: SPHERE_WHOLE,
      rings: DEFAULT_SPHERE_RINGS,
      sides: DEFAULT_SPHERE_SIDES,
    });
    expect(
      sphereProfile(sphere([1, 1, 1], { keep: 7, rings: 1, sides: 2 })),
    ).toEqual({
      keep: SPHERE_WHOLE,
      rings: DEFAULT_SPHERE_RINGS,
      sides: DEFAULT_SPHERE_SIDES,
    });
    expect(
      sphereProfile(sphere([1, 1, 1], { keep: 1, rings: 6.4, sides: 7.6 })),
    ).toEqual({ keep: SPHERE_DOME, rings: 6, sides: 8 });
    const a = meshOf(sphere([1, 1, 1], { sides: 2, rings: 0 }));
    const b = meshOf(sphere([1, 1, 1]));
    expect(a.vCount).toBe(b.vCount);
  });
});

/**
 * The texel density the pack draws at, and the bundled atlas, as the cylinder
 * UV tests use them (#3326).
 */
const PACK_DENSITY = 41.1;
const ATLAS = 2048;

describe("sphere UVs (#3330)", () => {
  const SIZES: Vec3[] = [
    [2, 2, 2],
    [0.3, 0.3, 0.3],
    [4, 2, 3],
    [3, 1.7, 1.2],
  ];
  const shapes = () =>
    shapeSwatches().flatMap((swatch) =>
      KEEPS.flatMap((keep) =>
        SIZES.map((size) =>
          sphere(size, { keep, rings: 5, sides: 10 }, swatch.id),
        ),
      ),
    );

  it("puts every UV inside the shape's swatch and keeps the mesh closed", () => {
    const problems: string[] = [];
    for (const shape of shapes()) {
      const mesh = meshOf(shape);
      const swatch = shapeSwatches().find((s) => s.id === shape.swatch);
      if (!swatch) throw new Error("no swatch");
      for (let i = 0; i < mesh.vCount; i++) {
        for (const k of [0, 1]) {
          const uv = mesh.vertices[i * 8 + 6 + k];
          if (
            uv < Math.fround(swatch.uv.min[k]) - 1e-7 ||
            uv > Math.fround(swatch.uv.max[k]) + 1e-7
          ) {
            problems.push(`${shapeKey(shape)} vertex ${i} uv ${k}: ${uv}`);
          }
        }
      }
      if (!meshVolume(positionsOf(mesh), [...mesh.indices]).closed) {
        problems.push(`${shapeKey(shape)} is not closed`);
      }
    }
    expect(problems).toEqual([]);
  });

  /**
   * Box projection cannot be uniform on a curved face. Each triangle is
   * projected onto the plane of the axis its face leans on most, so its UV
   * area is that axis's share of its area: at least 1/sqrt(3), and 1 on a face
   * square to an axis. Measured on a sphere 3 across with 12 rings and 24
   * sides, the area weighted mean linear density was 37.4 atlas pixels per
   * unit against the pack's 41.1, and the sparsest triangle 33.2.
   */
  it("keeps every triangle within the box projection's bound of the pack's density", () => {
    const ideal = (PACK_DENSITY / ATLAS) ** 2;
    const mesh = meshOf(sphere([3, 3, 3], { rings: 12, sides: 24 }));
    let area = 0;
    let linear = 0;
    let sparsest = Number.POSITIVE_INFINITY;
    for (const { p, uv } of triangles(mesh)) {
      const a = Math.hypot(...faceOf(p)) / 2;
      // Slivers along a cut are too small to measure in float32.
      if (a < 1e-4) continue;
      const uvArea = uvAreaOf(uv);
      const share = uvArea / a / ideal;
      expect(share).toBeGreaterThan(1 / Math.sqrt(3) - 0.02);
      expect(share).toBeLessThan(1.02);
      area += a;
      linear += Math.sqrt(uvArea / a) * a;
      sparsest = Math.min(sparsest, Math.sqrt(uvArea / a));
    }
    const mean = (linear / area) * ATLAS;
    expect(mean).toBeGreaterThan(36.5);
    expect(mean).toBeLessThan(38.5);
    expect(sparsest * ATLAS).toBeGreaterThan(32);
  });

  it("draws a dome's base disc at the pack's density", () => {
    const mesh = meshOf(
      sphere([2, 1, 2], { keep: SPHERE_DOME, rings: 4, sides: 12 }),
    );
    let checked = 0;
    for (const { p, n, uv } of triangles(mesh)) {
      if (n.some((vertex) => vertex[1] !== -1)) continue;
      const a = Math.hypot(...faceOf(p)) / 2;
      if (a < 1e-4) continue;
      expect(Math.sqrt(uvAreaOf(uv) / a) * ATLAS).toBeCloseTo(PACK_DENSITY, 0);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
