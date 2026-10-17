import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
  balanceProblem,
  balanceSummary,
  checkBalance,
  convexHull,
  isSupportRole,
  meshVolume,
  SAME_POSITION,
  signedDistanceToHull,
} from "./balance";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import type { LegoPackManifest, LegoPartInfo, LoadedPack } from "./pack";
import { mergePacks } from "./pack";
import { bakedPieces } from "./s3oBuild";

/** A pack of unit cubes, a flat triangle, and an open box (a cube with no top). */
function pack(): LoadedPack {
  const cube = (x: number, y: number, z: number) =>
    [
      [0, 0, 0],
      [x, 0, 0],
      [x, 0, z],
      [0, 0, z],
      [0, y, 0],
      [x, y, 0],
      [x, y, z],
      [0, y, z],
    ] as const;
  const corners = cube(1, 1, 1);
  // Counter clockwise seen from outside, two triangles a face.
  const solid = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2,
    3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
  ];
  const vertices: number[] = [];
  const indices: number[] = [];
  const parts: LegoPartInfo[] = [];
  const add = (
    id: string,
    points: readonly (readonly number[])[],
    tri: number[],
  ) => {
    const vFirst = vertices.length / 8;
    for (const p of points) vertices.push(...p, 0, 1, 0, 0, 0);
    const iFirst = indices.length;
    indices.push(...tri);
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const zs = points.map((p) => p[2]);
    parts.push({
      id,
      packId: "lego",
      shapeId: id,
      name: id,
      category: "grey",
      colourway: "grey",
      shape: id,
      material: "metal",
      tags: [],
      vFirst,
      vCount: points.length,
      iFirst,
      iCount: tri.length,
      bbox: {
        min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
        max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)],
      },
      uvBox: { min: [0, 0], max: [1, 1] },
      pivot: [0, 0, 0],
      sourceNames: [],
      aliasCount: 0,
    });
  };
  add("cube", corners, solid);
  // The same cube without its top face.
  add("open", corners, [...solid.slice(0, 6), ...solid.slice(12)]);
  const byId = new Map(parts.map((p) => [p.id, p]));
  return {
    manifest: {} as LoadedPack["manifest"],
    library: { packs: [], atlases: [], dir: "", problems: [] },
    parts,
    byId,
    vertices: new Float32Array(vertices),
    indices: new Uint16Array(indices),
  };
}

function project(pieces: (Partial<LegoPiece> & { id: string })[]): LegoProject {
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
      // The root is empty, so it weighs nothing.
      ...base.pieces,
      ...pieces.map((piece) => ({
        name: piece.id,
        parentId: "root",
        partId: "cube",
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
        ...piece,
      })),
    ],
  };
}

describe("isSupportRole", () => {
  it("counts feet and wheels and nothing else", () => {
    expect(isSupportRole("wheel")).toBe(true);
    expect(isSupportRole("leg.l1.foot")).toBe(true);
    expect(isSupportRole("leg.r2.foot")).toBe(true);
    expect(isSupportRole("leg.l1.shin")).toBe(false);
    expect(isSupportRole("base")).toBe(false);
    expect(isSupportRole(undefined)).toBe(false);
  });
});

describe("meshVolume", () => {
  const cube = pack();
  const points = (id: string) => {
    const part = cube.byId.get(id) as LegoPartInfo;
    const out: [number, number, number][] = [];
    for (let i = 0; i < part.vCount; i++) {
      const at = (part.vFirst + i) * 8;
      out.push([
        cube.vertices[at],
        cube.vertices[at + 1],
        cube.vertices[at + 2],
      ]);
    }
    return out;
  };
  const tris = (id: string) => {
    const part = cube.byId.get(id) as LegoPartInfo;
    return [...cube.indices.slice(part.iFirst, part.iFirst + part.iCount)];
  };

  it("measures a closed cube", () => {
    const result = meshVolume(points("cube"), tris("cube"));
    expect(result.closed).toBe(true);
    expect(result.volume).toBeCloseTo(1, 9);
    expect(result.centre[0]).toBeCloseTo(0.5, 9);
    expect(result.centre[1]).toBeCloseTo(0.5, 9);
    expect(result.centre[2]).toBeCloseTo(0.5, 9);
  });

  it("says a mesh with a missing face is open", () => {
    expect(meshVolume(points("open"), tris("open")).closed).toBe(false);
  });

  it("welds the vertices a part repeats for its normals", () => {
    const p = points("cube");
    const doubled = [...p, ...p];
    const t = tris("cube");
    const result = meshVolume(doubled, [
      ...t.slice(0, 18),
      ...t.slice(18).map((i) => i + 8),
    ]);
    expect(result.closed).toBe(true);
    expect(result.volume).toBeCloseTo(1, 9);
  });
});

describe("convexHull and signedDistanceToHull", () => {
  it("drops interior and collinear points", () => {
    const hull = convexHull([
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [1, 1],
      [1, 0],
    ]);
    expect(hull).toHaveLength(4);
  });

  it("is negative inside, positive outside, and measures to the nearest edge", () => {
    const hull = convexHull([
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ]);
    expect(signedDistanceToHull([1, 2], hull)).toBeCloseTo(-1, 9);
    expect(signedDistanceToHull([6, 2], hull)).toBeCloseTo(2, 9);
    expect(signedDistanceToHull([7, 8], hull)).toBeCloseTo(5, 9);
  });
});

describe("checkBalance", () => {
  const feet = [
    { id: "fl", role: "leg.l1.foot", position: [-4, 0, -4] },
    { id: "fr", role: "leg.r1.foot", position: [4, 0, -4] },
    { id: "bl", role: "leg.l2.foot", position: [-4, 0, 4] },
    { id: "br", role: "leg.r2.foot", position: [4, 0, 4] },
  ] as (Partial<LegoPiece> & { id: string })[];

  it("is inside when the body sits over four feet", () => {
    const doc = project([
      ...feet,
      { id: "body", position: [-1, 1, -1], scale: [2, 2, 2] },
    ]);

    const result = checkBalance(doc, pack(), null);

    expect(result.status).toBe("inside");
    if (result.status !== "inside") return;
    expect(result.resting.sort()).toEqual(["bl", "br", "fl", "fr"]);
    expect(result.outsideBy).toBeLessThan(0);
    expect(balanceProblem(result)).toBeNull();
  });

  it("reports how far outside, in elmos, when the weight is forward of the feet", () => {
    const doc = project([
      ...feet,
      { id: "body", position: [-1, 1, -12], scale: [2, 2, 2] },
    ]);

    const result = checkBalance(doc, pack(), null);

    expect(result.status).toBe("outside");
    if (result.status !== "outside") return;
    // The body's centre is at z = -11. The feet's nearest edge is at z = -4 + 0
    // (each foot's own centre is 0.5 in, so its lowest points reach -4).
    expect(result.centre[1]).toBeGreaterThan(-12);
    expect(result.outsideBy).toBeGreaterThan(0);
    expect(balanceProblem(result)).toMatch(/tip.*elmos outside/);
  });

  it("weighs a piece by its volume after scaling", () => {
    // Three feet of volume 1, a body of volume 8 centred at (1, 2, 1), and a
    // small one of volume 1 centred at (0.5, 1.5, 4.5).
    const doc = project([
      { id: "fl", role: "leg.l1.foot", position: [-10, 0, 0] },
      { id: "fr", role: "leg.r1.foot", position: [10, 0, 0] },
      { id: "bl", role: "leg.l2.foot", position: [0, 0, 10] },
      { id: "big", position: [0, 1, 0], scale: [2, 2, 2] },
      { id: "small", position: [0, 1, 4] },
    ]);

    const result = checkBalance(doc, pack(), null);

    if (result.status === "notApplicable") throw new Error("expected a result");
    expect(result.centre[0]).toBeCloseTo((-9.5 + 10.5 + 0.5 + 8 + 0.5) / 12, 9);
    expect(result.centre[1]).toBeCloseTo((0.5 + 0.5 + 10.5 + 8 + 4.5) / 12, 9);
  });

  it("falls back to the bounding box for an open mesh and says so", () => {
    const doc = project([
      ...feet,
      { id: "shell", partId: "open", position: [-1, 1, -1], scale: [2, 2, 2] },
    ]);

    const result = checkBalance(doc, pack(), null);

    if (result.status === "notApplicable") throw new Error("expected a result");
    expect(result.basis.box).toBe(1);
    expect(result.basis.mesh).toBe(4);
  });

  it("does not apply to a unit with no feet or wheels", () => {
    const doc = project([{ id: "body", position: [0, 0, 0] }]);

    const result = checkBalance(doc, pack(), null);

    expect(result.status).toBe("notApplicable");
    expect(balanceProblem(result)).toBeNull();
    expect(balanceSummary(result)).toMatch(/foot or wheel/);
  });

  it("does not apply, and says how high, when no foot reaches the ground", () => {
    const doc = project([
      { id: "foot", role: "leg.l1.foot", position: [0, 3, 0] },
      { id: "body", position: [0, 4, 0] },
    ]);

    const result = checkBalance(doc, pack(), null);

    expect(result.status).toBe("notApplicable");
    expect(balanceSummary(result)).toMatch(/3 elmos above the ground/);
  });

  it("leaves a lifted foot out of the support area", () => {
    const doc = project([
      ...feet.slice(0, 3),
      { id: "br", role: "leg.r2.foot", position: [4, 2, 4] },
      { id: "body", position: [3, 1, 3] },
    ]);

    const result = checkBalance(doc, pack(), null);

    if (result.status === "notApplicable") throw new Error("expected a result");
    expect([...result.resting].sort()).toEqual(["bl", "fl", "fr"]);
    expect(result.status).toBe("outside");
  });

  it("says a single foot has a support area with no width", () => {
    const doc = project([
      {
        id: "foot",
        role: "leg.l1.foot",
        position: [0, 0, 0],
        scale: [0, 1, 0],
      },
      { id: "body", position: [5, 1, 0] },
    ]);

    const result = checkBalance(doc, pack(), null);

    expect(result.status).toBe("noWidth");
    expect(balanceProblem(result)).toBeNull();
    expect(balanceSummary(result)).toMatch(/no width/);
  });

  it("says two wheels in a line have a support area with no width", () => {
    const doc = project([
      { id: "w1", role: "wheel", position: [0, 0, 0], scale: [0, 1, 0] },
      { id: "w2", role: "wheel", position: [0, 0, 6], scale: [0, 1, 0] },
      { id: "body", position: [0, 1, 2] },
    ]);

    const result = checkBalance(doc, pack(), null);

    expect(result.status).toBe("noWidth");
  });
});

describe("the bundled parts", () => {
  const dir = fileURLToPath(
    new URL("../../src-tauri/legoparts/", import.meta.url),
  );
  const manifest = JSON.parse(
    readFileSync(`${dir}pack.json`, "utf8"),
  ) as LegoPackManifest;
  const blob = new Uint8Array(gunzipSync(readFileSync(`${dir}parts.bin.gz`)));
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const vertexOffset = view.getUint32(16, true);
  const vertexBytes = view.getUint32(20, true);
  const indexOffset = view.getUint32(24, true);
  const indexBytes = view.getUint32(28, true);
  const vertices = new Float32Array(
    blob.slice(vertexOffset, vertexOffset + vertexBytes).buffer,
  );
  const indices = new Uint16Array(
    blob.slice(indexOffset, indexOffset + indexBytes).buffer,
  );
  const merged = mergePacks([{ manifest, vertices, indices }]);
  const real: LoadedPack = {
    ...merged,
    vertices,
    indices,
    library: { packs: [manifest], atlases: [], dir: "", problems: [] },
  };

  function triangles(part: LegoPartInfo) {
    const points: [number, number, number][] = [];
    for (let i = 0; i < part.vCount; i++) {
      const at = (part.vFirst + i) * 8;
      points.push([vertices[at], vertices[at + 1], vertices[at + 2]]);
    }
    return {
      points,
      tris: [...indices.slice(part.iFirst, part.iFirst + part.iCount)],
    };
  }

  it("measures how many are closed meshes", () => {
    let closed = 0;
    let open = 0;
    for (const part of real.parts) {
      const { points, tris } = triangles(part);
      const m = meshVolume(points, tris);
      if (m.closed && m.volume > 0) closed++;
      else {
        open++;
      }
    }
    // Most parts are closed. The few that are not take the box, so a unit
    // built from them still has a centre.
    expect(closed).toBeGreaterThan(open);
    expect(closed + open).toBe(real.parts.length);
  });

  it("keeps a flat face level to within SAME_POSITION once baked", () => {
    // Vertices that share one local coordinate lie on a plane. Turn that plane
    // to face down and the spread of their heights is rounding alone.
    const turns: [[number, number, number], 0 | 1 | 2][] = [
      [[Math.PI / 2, 0, 0], 2],
      [[-Math.PI / 2, 0, 0], 2],
      [[0, 0, Math.PI / 2], 0],
      [[0, 0, -Math.PI / 2], 0],
      [[0, Math.PI, 0], 1],
      [[0, 0.6458, 0], 1],
    ];
    let worst = 0;
    for (const part of real.parts) {
      const { points } = triangles(part);
      for (const [rotation, axis] of turns) {
        const doc = project([
          {
            id: "f",
            partId: part.id,
            role: "leg.l1.foot",
            rotation,
            position: [3, 5, 7],
            scale: [1.37, 1.37, 1.37],
          },
        ]);
        const f = bakedPieces(doc, real, null).pieces.get("f");
        if (!f) continue;
        const groups = new Map<number, number[]>();
        points.forEach((p, i) => {
          const list = groups.get(p[axis]) ?? [];
          list.push(f.vertices[i].pos[1]);
          groups.set(p[axis], list);
        });
        for (const heights of groups.values()) {
          if (heights.length < 3) continue;
          worst = Math.max(worst, Math.max(...heights) - Math.min(...heights));
        }
      }
    }
    expect(worst).toBeLessThan(SAME_POSITION);
  });
});
