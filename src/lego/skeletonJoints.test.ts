import { describe, expect, it } from "vitest";
import type { BodyPlan } from "./bodyPlans";
import { projectFromPlan } from "./bodyPlans";
import type { LegoProject } from "./model";
import type { LoadedPack } from "./pack";
import { skeletonJoints } from "./skeletonJoints";

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
