import { beforeAll, describe, expect, it } from "vitest";
import type { BodyPlan } from "./bodyPlans";
import { projectFromPlan } from "./bodyPlans";
import { bundledSwatches } from "./fixtures/bundledSwatches";
import type { LegoPiece, LegoProject } from "./model";
import type { LoadedPack } from "./pack";
import { setShapeSwatches } from "./shapes";
import { geometryJoints, pieceReach, skeletonJoints } from "./skeletonJoints";

/** Empty pieces have no geometry, so the pack is never read. */
const pack = {} as LoadedPack;

const PLAN: BodyPlan = {
  id: "test.joints",
  label: "Joints",
  description: "A base, a body and one leg, for tests.",
  proportions: [],
  bones() {
    return [
      { id: "base", name: "base", parent: null, position: [0, 0, 0] },
      {
        id: "body",
        name: "body",
        parent: "base",
        position: [0, 10, 0],
        role: "base",
      },
      {
        id: "thigh",
        name: "thigh_l",
        parent: "body",
        position: [3, -2, 1],
        role: "leg.l1.thigh",
      },
      { id: "tag", name: "tag", parent: "thigh", position: [0, -5, 0] },
    ];
  },
  presets: [],
};

function unit(): LegoProject {
  let n = 0;
  return projectFromPlan(PLAN, {
    id: "u",
    rootPieceId: "root",
    name: "Unit",
    packId: "p",
    packVersion: "1",
    now: "2026-01-01T00:00:00.000Z",
    newId: () => `piece-${++n}`,
  });
}

describe("skeletonJoints", () => {
  it("gives every bone its place in the unit and its parent's place", () => {
    const joints = skeletonJoints(unit(), pack, null);

    expect(joints.map((joint) => [joint.at, joint.parentAt])).toEqual([
      [[0, 0, 0], null],
      [
        [0, 10, 0],
        [0, 0, 0],
      ],
      [
        [3, 8, 1],
        [0, 10, 0],
      ],
      [
        [3, 3, 1],
        [3, 8, 1],
      ],
    ]);
  });

  it("labels a bone by its role and a bone with no role by its piece name", () => {
    const labels = skeletonJoints(unit(), pack, null).map((j) => j.label);

    expect(labels).toEqual(["base", "Body", "Front left thigh", "tag"]);
  });

  it("draws nothing for a unit with no skeleton", () => {
    const { skeleton: _gone, ...plain } = unit();
    const free = {
      ...plain,
      pieces: plain.pieces.map(({ bone: _bone, ...rest }) => rest),
    };

    expect(skeletonJoints(free, pack, null)).toEqual([]);
  });

  it("leaves out a free piece added to a unit with a skeleton", () => {
    const project = unit();
    const withFree: LegoProject = {
      ...project,
      pieces: [
        ...project.pieces,
        {
          id: "free",
          name: "free",
          parentId: "root",
          partId: null,
          position: [1, 1, 1],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      ],
    };

    expect(skeletonJoints(withFree, pack, null)).toHaveLength(4);
  });

  it("measures a bone against a parent that is a free piece", () => {
    const project = unit();
    const moved: LegoProject = {
      ...project,
      pieces: [
        ...project.pieces.map((p) =>
          p.bone === "body" ? { ...p, parentId: "free" } : p,
        ),
        {
          id: "free",
          name: "free",
          parentId: "root",
          partId: null,
          position: [0, 4, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      ],
    };
    const body = skeletonJoints(moved, pack, null).find(
      (j) => j.label === "Body",
    );

    expect(body?.parentAt).toEqual([0, 4, 0]);
    expect(body?.at).toEqual([0, 14, 0]);
  });
});

const vertex = (pos: [number, number, number]) => ({
  pos,
  normal: [0, 1, 0] as [number, number, number],
  uv: [0, 0] as [number, number],
});

describe("pieceReach", () => {
  it("takes the far end of the box the baked vertices span", () => {
    // A barrel from its pivot, as in the widget's tests: a box 0 to 30 along z.
    expect(
      pieceReach({
        vertices: [vertex([-1, -1, 0]), vertex([1, 1, 30]), vertex([0, 0, 12])],
      }),
    ).toEqual([0, 0, 30]);
  });

  it("gives an empty piece no bone", () => {
    expect(pieceReach({ vertices: [] })).toBeNull();
  });
});

describe("geometryJoints", () => {
  beforeAll(() => {
    setShapeSwatches(bundledSwatches());
  });

  /** A pack with no parts: the pieces below are shapes or empty. */
  const shapePack = {
    manifest: {} as LoadedPack["manifest"],
    library: { packs: [], atlases: [], dir: "", problems: [] },
    parts: [],
    byId: new Map(),
    vertices: new Float32Array(),
    indices: new Uint16Array(),
  } as LoadedPack;

  function withPieces(extra: Partial<LegoPiece>[]): LegoProject {
    const { skeleton: _gone, ...plain } = unit();
    const free = plain.pieces.map(({ bone: _bone, ...rest }) => rest);
    return {
      ...plain,
      pieces: [
        ...free,
        ...extra.map((piece, n) => ({
          id: `extra-${n}`,
          name: `extra-${n}`,
          parentId: "root",
          partId: null,
          position: [0, 0, 0] as [number, number, number],
          rotation: [0, 0, 0] as [number, number, number],
          scale: [1, 1, 1] as [number, number, number],
          ...piece,
        })),
      ],
    };
  }

  it("makes a joint of every piece, named for the piece and not its role", () => {
    const joints = geometryJoints(withPieces([]), pack, null);

    expect(joints.map((joint) => joint.label)).toEqual([
      "base",
      "body",
      "thigh_l",
      "tag",
    ]);
    expect(joints.map((joint) => joint.at)).toEqual([
      [0, 0, 0],
      [0, 10, 0],
      [3, 8, 1],
      [3, 3, 1],
    ]);
    expect(joints.map((joint) => joint.parentId)).toEqual([
      null,
      ...joints.slice(0, 3).map((joint) => joint.pieceId),
    ]);
  });

  it("gives an empty piece a joint and no bone", () => {
    const joints = geometryJoints(withPieces([]), pack, null);

    expect(joints.every((joint) => joint.reach === undefined)).toBe(true);
  });

  it("runs a bone from a piece's origin to the far end of its geometry", () => {
    // A rod 3 long on y, at (4, 2, 0): the box is centred on the piece's
    // origin, both y faces are as far as each other, so the positive one wins.
    const joints = geometryJoints(
      withPieces([
        {
          id: "rod",
          shape: { kind: "cylinder", size: [1, 3, 1], swatch: "grey" },
          position: [4, 2, 0],
        },
      ]),
      shapePack,
      null,
    );
    const rod = joints.find((joint) => joint.pieceId === "rod");

    expect(rod?.at).toEqual([4, 2, 0]);
    expect(rod?.reach?.local[0]).toBeCloseTo(0, 6);
    expect(rod?.reach?.local[1]).toBeCloseTo(1.5, 6);
    expect(rod?.reach?.local[2]).toBeCloseTo(0, 6);
    expect(rod?.reach?.at[1]).toBeCloseTo(3.5, 6);
  });
});
