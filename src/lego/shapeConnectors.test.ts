import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  connectPiece,
  type LegoConnector,
  pieceConnectors,
  resolveConnections,
  slideJoin,
} from "./connectors";
import {
  type LegoPiece,
  type LegoProject,
  newProject,
  pieceById,
} from "./model";
import { insertModule, moduleConnectors, placeModule } from "./moduleMount";
import type { LegoPartInfo, LoadedPack } from "./pack";
import { attachToFreeFace, faceUnder, placePart } from "./placePart";
import { worldMatrix } from "./reparent";
import { shapeConnectors } from "./shapeConnectors";
import {
  type LegoShape,
  shapeBox,
  shapeKinds,
  shapeMesh,
  tubeInnerRadius,
} from "./shapes";

type Vec3 = [number, number, number];

function round(values: number[]): number[] {
  return values.map((n) => Number(n.toFixed(6)) + 0);
}

/** Sizes and options that make each kind's connectors differ from a box's. */
function examples(kind: string): LegoShape[] {
  const size: Vec3 = [2, 3, 4];
  switch (kind) {
    case "wedge":
      return [
        { kind, size },
        { kind, size, options: { low: 1 } },
        { kind, size, options: { low: 1, flip: 1 } },
        { kind, size, options: { low: 3 } },
      ];
    case "cone":
      return [
        { kind, size },
        { kind, size, options: { top: 0.5 } },
        { kind, size, options: { axis: 0, top: 0.5 } },
        { kind, size, options: { axis: 2, sides: 7 } },
      ];
    case "sphere":
      return [
        { kind, size },
        { kind, size, options: { keep: 1 } },
        { kind, size, options: { keep: 2, sides: 7 } },
        { kind, size, options: { sides: 5 } },
      ];
    case "cylinder":
    case "tube":
      return [
        { kind, size },
        { kind, size, options: { axis: 0 } },
        { kind, size, options: { axis: 2, sides: 7 } },
        { kind, size, options: { sides: 3 } },
      ];
    default:
      return [{ kind, size }];
  }
}

function byId(shape: LegoShape): Record<string, LegoConnector> {
  return Object.fromEntries(shapeConnectors(shape).map((c) => [c.id, c]));
}

/** How far a point is from the shape's surface. */
function distanceToSurface(shape: LegoShape, point: Vec3): number {
  const mesh = shapeMesh(shape);
  if (!mesh) throw new Error("no mesh");
  const at = (i: number) =>
    new THREE.Vector3(
      mesh.vertices[mesh.indices[i] * 8],
      mesh.vertices[mesh.indices[i] * 8 + 1],
      mesh.vertices[mesh.indices[i] * 8 + 2],
    );
  const target = new THREE.Vector3(...point);
  const closest = new THREE.Vector3();
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < mesh.iCount; i += 3) {
    new THREE.Triangle(at(i), at(i + 1), at(i + 2)).closestPointToPoint(
      target,
      closest,
    );
    best = Math.min(best, closest.distanceTo(target));
  }
  return best;
}

describe("every shape kind", () => {
  it("lists at least the kinds with a generator", () => {
    expect(shapeKinds()).toEqual(
      expect.arrayContaining(["cylinder", "tube", "cone", "sphere", "wedge"]),
    );
  });

  for (const kind of shapeKinds()) {
    describe(kind, () => {
      for (const shape of examples(kind)) {
        const label = JSON.stringify(shape.options ?? {});

        it(`has connectors that are well formed (${label})`, () => {
          const connectors = shapeConnectors(shape);
          expect(connectors.length).toBeGreaterThan(0);
          expect(new Set(connectors.map((c) => c.id)).size).toBe(
            connectors.length,
          );
          const box = shapeBox(shape) as NonNullable<
            ReturnType<typeof shapeBox>
          >;
          for (const c of connectors) {
            expect(Math.hypot(...c.facing)).toBeCloseTo(1, 9);
            expect(Math.hypot(...c.up)).toBeCloseTo(1, 9);
            const dot =
              c.facing[0] * c.up[0] +
              c.facing[1] * c.up[1] +
              c.facing[2] * c.up[2];
            expect(dot).toBeCloseTo(0, 9);
            for (let axis = 0; axis < 3; axis++) {
              expect(c.position[axis]).toBeGreaterThanOrEqual(
                box.min[axis] - 1e-9,
              );
              expect(c.position[axis]).toBeLessThanOrEqual(
                box.max[axis] + 1e-9,
              );
            }
          }
        });

        it(`puts each connector on the shape (${label})`, () => {
          // A tube's end connector is at the middle of the end, over its hole.
          const reach = kind === "tube" ? tubeInnerRadius(shape) : 1e-6;
          for (const c of shapeConnectors(shape)) {
            expect(distanceToSurface(shape, c.position)).toBeLessThanOrEqual(
              reach + 1e-6,
            );
          }
        });

        it(`moves with the size (${label})`, () => {
          const bigger: LegoShape = {
            ...shape,
            size: shape.size.map((n) => n * 2) as Vec3,
            options: {
              ...shape.options,
              ...(shape.options?.low !== undefined
                ? { low: shape.options.low * 2 }
                : {}),
            },
          };
          const before = shapeConnectors(shape);
          const after = shapeConnectors(bigger);
          expect(after.map((c) => c.id)).toEqual(before.map((c) => c.id));
          for (const [i, c] of after.entries()) {
            expect(round(c.position)).toEqual(
              round(before[i].position.map((n) => n * 2)),
            );
          }
        });
      }
    });
  }

  it("has none for a kind this build does not know", () => {
    expect(
      shapeConnectors({ kind: "from-the-future", size: [1, 1, 1] }),
    ).toEqual([]);
  });
});

describe("cylinder and tube connectors", () => {
  for (const kind of ["cylinder", "tube"]) {
    it(`${kind}: one at each end and four round the side, facing out`, () => {
      const c = byId({ kind, size: [2, 6, 4] });
      expect(Object.keys(c).sort()).toEqual([
        "+x",
        "+y",
        "+z",
        "-x",
        "-y",
        "-z",
      ]);
      expect(c["+y"].position).toEqual([0, 3, 0]);
      expect(c["-y"].facing).toEqual([0, -1, 0]);
      expect(c["+x"].position).toEqual([1, 0, 0]);
      expect(c["+x"].facing).toEqual([1, 0, 0]);
      expect(c["-z"].position).toEqual([0, 0, -2]);
    });

    it(`${kind}: ends follow the axis option`, () => {
      const c = byId({ kind, size: [6, 2, 2], options: { axis: 0 } });
      expect(c["+x"].position).toEqual([3, 0, 0]);
      expect(c["+y"].position).toEqual([0, 1, 0]);
      expect(c["+y"].facing).toEqual([0, 1, 0]);
    });
  }

  it("meets a ring of 3 sides on the wall, not in the air past it", () => {
    const shape: LegoShape = {
      kind: "cylinder",
      size: [2, 2, 2],
      options: { sides: 3 },
    };
    for (const c of shapeConnectors(shape)) {
      expect(distanceToSurface(shape, c.position)).toBeLessThan(1e-6);
    }
  });
});

describe("cone connectors", () => {
  it("has one at the flat bottom and none at the tip", () => {
    const c = byId({ kind: "cone", size: [2, 4, 2] });
    expect(Object.keys(c)).toEqual(["-y"]);
    expect(c["-y"].position).toEqual([0, -2, 0]);
    expect(c["-y"].facing).toEqual([0, -1, 0]);
  });

  it("has one at each end of a cut cone", () => {
    const c = byId({ kind: "cone", size: [2, 4, 2], options: { top: 0.5 } });
    expect(Object.keys(c).sort()).toEqual(["+y", "-y"]);
    expect(c["+y"].position).toEqual([0, 2, 0]);
    expect(c["+y"].facing).toEqual([0, 1, 0]);
  });

  it("follows the axis option", () => {
    const c = byId({
      kind: "cone",
      size: [4, 2, 2],
      options: { axis: 0, top: 0.5 },
    });
    expect(c["+x"].position).toEqual([2, 0, 0]);
    expect(c["-x"].position).toEqual([-2, 0, 0]);
  });
});

describe("sphere connectors", () => {
  it("gives a whole sphere its two poles and four points round the equator", () => {
    const c = byId({ kind: "sphere", size: [2, 4, 6] });
    expect(Object.keys(c).sort()).toEqual(["+x", "+y", "+z", "-x", "-y", "-z"]);
    expect(c["+y"].position).toEqual([0, 2, 0]);
    expect(c["+x"].position).toEqual([1, 0, 0]);
    expect(c["-z"].position).toEqual([0, 0, -3]);
  });

  it("gives a dome its base and its apex and nothing at the sides", () => {
    const c = byId({ kind: "sphere", size: [2, 1, 2], options: { keep: 1 } });
    expect(Object.keys(c).sort()).toEqual(["+y", "-y"]);
    expect(c["-y"].position).toEqual([0, -0.5, 0]);
    expect(c["-y"].facing).toEqual([0, -1, 0]);
    expect(c["+y"].position).toEqual([0, 0.5, 0]);
  });

  it("gives a bowl the same two, with its flat base on top", () => {
    const c = byId({ kind: "sphere", size: [2, 1, 2], options: { keep: 2 } });
    expect(Object.keys(c).sort()).toEqual(["+y", "-y"]);
  });
});

describe("wedge connectors", () => {
  const size: Vec3 = [2, 4, 3];

  it("has a slope, a bottom, two sides and a high end on a pure wedge", () => {
    const c = byId({ kind: "wedge", size });
    expect(Object.keys(c).sort()).toEqual(["+x", "+y", "-x", "-y", "-z"]);
    expect(c["-z"].position).toEqual([0, 0, -1.5]);
    expect(c["-z"].facing).toEqual([0, 0, -1]);
  });

  it("faces the slope along its normal, at the middle of the slope", () => {
    const slope = byId({ kind: "wedge", size })["+y"];
    expect(slope.position).toEqual([0, 0, 0]);
    const length = Math.hypot(3, 4);
    expect(round(slope.facing)).toEqual(round([0, 3 / length, 4 / length]));
    const dot =
      slope.facing[0] * slope.up[0] +
      slope.facing[1] * slope.up[1] +
      slope.facing[2] * slope.up[2];
    expect(dot).toBeCloseTo(0, 9);
  });

  it("adds the low end when it has height, at the middle of that end", () => {
    const c = byId({ kind: "wedge", size, options: { low: 1 } });
    expect(c["+z"].position).toEqual([0, -1.5, 1.5]);
    expect(c["+z"].facing).toEqual([0, 0, 1]);
  });

  it("turns the ends round when flipped", () => {
    const c = byId({ kind: "wedge", size, options: { low: 1, flip: 1 } });
    expect(c["+z"].position).toEqual([0, 0, 1.5]);
    expect(c["-z"].position).toEqual([0, -1.5, -1.5]);
    expect(round(c["+y"].facing)).toEqual(
      round([0, Math.SQRT1_2, -Math.SQRT1_2]),
    );
  });

  it("puts a side connector at the centre of the side, which is inside it", () => {
    const c = byId({ kind: "wedge", size });
    expect(round(c["+x"].position)).toEqual(round([1, -2 / 3, -0.5]));
  });

  it("is the same six faces as a box when the low end is as tall as the high", () => {
    const c = byId({ kind: "wedge", size, options: { low: 4 } });
    expect(c["+y"].position).toEqual([0, 2, 0]);
    expect(c["+y"].facing).toEqual([0, 1, 0]);
    expect(Object.keys(c)).toHaveLength(6);
  });
});

// Joins and placement ------------------------------------------------------

function part(id: string, min: Vec3, max: Vec3): LegoPartInfo {
  return {
    id,
    packId: "lego",
    shapeId: id,
    name: id,
    category: "grey",
    colourway: "grey",
    shape: "block",
    material: "metal",
    tags: [],
    vFirst: 0,
    vCount: 0,
    iFirst: 0,
    iCount: 0,
    bbox: { min, max },
    uvBox: { min: [0, 0], max: [1, 1] },
    pivot: [0, 0, 0],
    sourceNames: [],
    aliasCount: 0,
  };
}

function pack(): LoadedPack {
  const parts = [
    part("leg", [-0.25, -1, -0.25], [0.25, 1, 0.25]),
    part("hull", [-1, -0.5, -2], [1, 0.5, 2]),
  ];
  return {
    manifest: {} as LoadedPack["manifest"],
    library: { packs: [], atlases: [], dir: "", problems: [] },
    parts,
    byId: new Map(parts.map((p) => [p.id, p])),
    vertices: new Float32Array(),
    indices: new Uint16Array(),
  } as LoadedPack;
}

function piece(extra: Partial<LegoPiece> & { id: string }): LegoPiece {
  return {
    name: extra.id,
    parentId: "root",
    partId: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...extra,
  };
}

function doc(pieces: LegoPiece[]): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  return { ...base, pieces: [...base.pieces, ...pieces] };
}

function worldPoint(project: LegoProject, id: string, local: Vec3): number[] {
  const p = new THREE.Vector3(...local).applyMatrix4(worldMatrix(project, id));
  return round([p.x, p.y, p.z]);
}

function counter() {
  let n = 0;
  return () => `m${n++}`;
}

const DRUM: LegoShape = { kind: "cylinder", size: [2, 4, 2] };

describe("pieceConnectors on a shape", () => {
  it("answers the shape's own connectors", () => {
    const drum = piece({ id: "drum", shape: DRUM });
    expect(pieceConnectors(pack(), drum)).toEqual(shapeConnectors(DRUM));
  });

  it("puts a shape's custom anchors first, as for a part", () => {
    const drum = piece({
      id: "drum",
      shape: DRUM,
      customAnchors: [
        { id: "a1", name: "anchor", position: [1, 1, 0], facing: [1, 0, 0] },
      ],
    });
    expect(pieceConnectors(pack(), drum).map((c) => c.id)).toEqual(["a1"]);
  });

  it("gives a custom anchor on a shape the nearest face of its box", () => {
    const drum = piece({
      id: "drum",
      shape: DRUM,
      customAnchors: [{ id: "a1", name: "anchor", position: [0.9, 0, 0] }],
    });
    expect(pieceConnectors(pack(), drum)[0].facing).toEqual([1, 0, 0]);
  });
});

describe("a part joined to a shape", () => {
  it("sits on the side of a cylinder, and follows when the cylinder is resized", () => {
    const joined = connectPiece(
      doc([
        piece({ id: "drum", shape: DRUM }),
        piece({ id: "leg", parentId: "drum", partId: "leg" }),
      ]),
      pack(),
      "leg",
      { connector: "-x", to: "+x" },
    );
    // The leg's own -x face is at x = -0.25, flush with the cylinder's side.
    expect(worldPoint(joined, "leg", [-0.25, 0, 0])).toEqual([1, 0, 0]);

    const wider: LegoProject = {
      ...joined,
      pieces: joined.pieces.map((p) =>
        p.id === "drum" ? { ...p, shape: { ...DRUM, size: [6, 4, 2] } } : p,
      ),
    };
    const { project: followed, broken } = resolveConnections(wider, pack());
    expect(broken).toEqual([]);
    expect(worldPoint(followed, "leg", [-0.25, 0, 0])).toEqual([3, 0, 0]);
  });

  it("slides along the side in whole grid steps", () => {
    const joined = connectPiece(
      doc([
        piece({ id: "drum", shape: DRUM }),
        piece({ id: "leg", parentId: "drum", partId: "leg" }),
      ]),
      pack(),
      "leg",
      { connector: "-x", to: "+x" },
    );
    const target = pieceById(joined, "leg") as LegoPiece;
    const slid = slideJoin(
      joined,
      pack(),
      "leg",
      [target.position[0], target.position[1] + 0.6, target.position[2]],
      0.5,
    );
    expect(slid?.offset.map((n) => Math.abs(n))).toContain(0.5);
    expect(
      slid?.offset.every((n) => Math.abs(n * 2 - Math.round(n * 2)) < 1e-9),
    ).toBe(true);
  });

  it("is lost, not thrown, when the shape stops having the connector", () => {
    const ramp: LegoShape = {
      kind: "wedge",
      size: [2, 4, 3],
      options: { low: 1 },
    };
    const joined = connectPiece(
      doc([
        piece({ id: "ramp", shape: ramp }),
        piece({ id: "leg", parentId: "ramp", partId: "leg" }),
      ]),
      pack(),
      "leg",
      { connector: "-y", to: "+z" },
    );
    const edge: LegoProject = {
      ...joined,
      pieces: joined.pieces.map((p) =>
        p.id === "ramp" ? { ...p, shape: { ...ramp, options: { low: 0 } } } : p,
      ),
    };
    expect(resolveConnections(edge, pack()).broken).toEqual(["leg"]);
  });

  it("can be a shape on a part's face", () => {
    const joined = connectPiece(
      doc([
        piece({ id: "hull", partId: "hull" }),
        piece({ id: "drum", parentId: "hull", shape: DRUM }),
      ]),
      pack(),
      "drum",
      { connector: "-y", to: "+y" },
    );
    // The drum's bottom end middle is on the hull's top.
    expect(worldPoint(joined, "drum", [0, -2, 0])).toEqual([0, 0.5, 0]);
  });
});

describe("hover and click placement on a shape", () => {
  const project = doc([piece({ id: "drum", shape: DRUM })]);
  const leg = pack().byId.get("leg") as LegoPartInfo;

  it("finds the connector under a hit on a cylinder's side", () => {
    const hit = faceUnder(
      pack(),
      pieceById(project, "drum") as LegoPiece,
      [1, 0.3, 0],
      [1, 0, 0],
    );
    expect(hit?.id).toBe("+x");
  });

  it("finds the connector under a hit on a wedge's slope", () => {
    const ramp = piece({
      id: "ramp",
      shape: { kind: "wedge", size: [2, 4, 3] },
    });
    const normal: Vec3 = [0, 3, 4];
    expect(faceUnder(pack(), ramp, [0, 0, 0], normal)?.id).toBe("+y");
  });

  it("places a part on a cylinder's end", () => {
    const placed = placePart(
      project,
      pack(),
      leg,
      { parentId: "drum", to: "+y" },
      { cycle: 0, twist: 0 },
      "new",
    );
    expect(placed).not.toBeNull();
    expect(pieceById(placed as LegoProject, "new")?.connection?.to).toBe("+y");
  });

  it("takes a part on the cylinder's top first when added from the strip", () => {
    const placed = attachToFreeFace(project, pack(), leg, "drum", "new");
    expect(
      placed?.project.pieces.find((p) => p.id === "new")?.connection?.to,
    ).toBe("+y");
  });
});

describe("module mounts and shapes", () => {
  const module: LegoProject = {
    ...doc([
      piece({ id: "post", parentId: null, shape: DRUM }),
      piece({
        id: "pod",
        parentId: "post",
        partId: "hull",
        position: [0, 2.5, 0],
      }),
    ]),
    id: "module",
    rootPieceId: "post",
  };

  it("lists a shape's connectors for choosing a mount", () => {
    const list = moduleConnectors(module, pack()).filter(
      (c) => c.piece === "post",
    );
    expect(list.map((c) => c.connector).sort()).toEqual([
      "+x",
      "+y",
      "+z",
      "-x",
      "-y",
      "-z",
    ]);
  });

  it("joins a module by a shape's connector to a shape's connector", () => {
    const unit = doc([
      piece({ id: "ramp", shape: { kind: "wedge", size: [2, 4, 3] } }),
    ]);
    const placed = placeModule(
      unit,
      module,
      pack(),
      { parentId: "ramp", to: "+y" },
      { cycle: 0, twist: 0 },
      counter(),
    );
    expect(placed).not.toBeNull();
    const roots = placed?.rootPieceIds ?? [];
    const root = pieceById(placed?.project as LegoProject, roots[0]);
    expect(root?.connection?.to).toBe("+y");
    // The module's end now touches the slope's middle.
    const down = module.pieces.find((p) => p.id === "post");
    expect(down).toBeDefined();
    const connector = root?.connection?.connector as string;
    const own = shapeConnectors(DRUM).find(
      (c) => c.id === connector,
    ) as LegoConnector;
    expect(
      worldPoint(placed?.project as LegoProject, roots[0], own.position),
    ).toEqual([0, 0, 0]);
  });

  it("mounts to the parent's first free face with insertModule", () => {
    const unit = doc([piece({ id: "drum", shape: DRUM })]);
    const mounted: LegoProject = {
      ...module,
      mount: { piece: "post", connector: "-y" },
    };
    const inserted = insertModule(unit, mounted, "drum", counter(), pack());
    const root = pieceById(inserted.project, inserted.rootPieceIds[0]);
    expect(root?.connection).toMatchObject({ connector: "-y", to: "+y" });
  });
});
