import { describe, expect, it } from "vitest";

import { isRole, presetById, unmetRequirements } from "./animPresets";
import {
  BODY_PLANS,
  type BodyPlan,
  bodyPlanById,
  planProportions,
  projectFromPlan,
  releaseSkeleton,
} from "./bodyPlans";
import { insertCompound, subtreeAsCompound } from "./compounds";
import {
  type LegoProject,
  normalisePieceName,
  parseLegoProjectJson,
  pieceById,
} from "./model";
import { reparentPiece } from "./reparent";

/** A small two legged plan, only for these tests. */
const STILTS: BodyPlan = {
  id: "test.stilts",
  label: "Stilts",
  description: "Two legs and a body, for tests.",
  proportions: [
    {
      id: "legLength",
      label: "Leg length",
      unit: "elmo",
      min: 2,
      max: 20,
      step: 0.5,
      fallback: 8,
    },
    {
      id: "stance",
      label: "Stance width",
      unit: "elmo",
      min: 1,
      max: 10,
      step: 0.5,
      fallback: 3,
    },
  ],
  bones({ legLength, stance }) {
    const leg = legLength as number;
    const half = (stance as number) / 2;
    return [
      { id: "base", name: "base", parent: null, position: [0, 0, 0] },
      {
        id: "hip",
        name: "hip",
        parent: "base",
        position: [0, leg, 0],
        role: "base",
      },
      {
        id: "thigh.l",
        name: "lthigh",
        parent: "hip",
        position: [half, 0, 0],
        role: "leg.l1.thigh",
        twin: "thigh.r",
      },
      {
        id: "shin.l",
        name: "lshin",
        parent: "thigh.l",
        position: [0, -leg / 2, 0],
        role: "leg.l1.shin",
        twin: "shin.r",
      },
      {
        id: "thigh.r",
        name: "rthigh",
        parent: "hip",
        position: [-half, 0, 0],
        role: "leg.r1.thigh",
        twin: "thigh.l",
      },
      {
        id: "shin.r",
        name: "rshin",
        parent: "thigh.r",
        position: [0, -leg / 2, 0],
        role: "leg.r1.shin",
        twin: "shin.l",
        pivot: [0, -1, 0],
      },
    ];
  },
  presets: [{ presetId: "walk.biped", params: { period: 1.2 } }],
};

/** What every plan has to be for `projectFromPlan` to make a sound unit. */
function planProblems(plan: BodyPlan): string[] {
  const problems: string[] = [];
  for (const proportion of plan.proportions) {
    const { id, min, max, fallback } = proportion;
    if (!(min <= fallback && fallback <= max)) {
      problems.push(`${id}'s default is outside its range`);
    }
  }
  const bones = plan.bones(planProportions(plan));
  const seen = new Set<string>();
  const names = new Set<string>();
  bones.forEach((bone, i) => {
    if (seen.has(bone.id)) problems.push(`${bone.id} is listed twice`);
    if (i === 0 && bone.parent !== null)
      problems.push("the first bone is not the root");
    if (i > 0 && (bone.parent === null || !seen.has(bone.parent))) {
      problems.push(`${bone.id}'s parent is not listed before it`);
    }
    const name = normalisePieceName(bone.name);
    if (name !== bone.name || names.has(name)) {
      problems.push(`${bone.id}'s piece name is not a unique Lua name`);
    }
    if (bone.role !== undefined && !isRole(bone.role)) {
      problems.push(`${bone.id} has no such role as ${bone.role}`);
    }
    seen.add(bone.id);
    names.add(name);
  });
  for (const bone of bones) {
    if (bone.twin === undefined) continue;
    if (bones.find((other) => other.id === bone.twin)?.twin !== bone.id) {
      problems.push(`${bone.id}'s twin does not name it back`);
    }
  }
  const roles = new Map<string, number>();
  for (const bone of bones) {
    if (bone.role) roles.set(bone.role, (roles.get(bone.role) ?? 0) + 1);
  }
  for (const applied of plan.presets) {
    const preset = presetById(applied.presetId);
    if (!preset) {
      problems.push(`no such preset as ${applied.presetId}`);
      continue;
    }
    const missing = unmetRequirements(preset, roles);
    if (missing.length > 0) {
      problems.push(`${applied.presetId} lacks ${missing.join(", ")}`);
    }
  }
  return problems;
}

let counter = 0;
function newId(): string {
  counter += 1;
  return `id${counter}`;
}

function fromStilts(proportions?: Record<string, number>): LegoProject {
  return projectFromPlan(STILTS, {
    id: "unit",
    rootPieceId: "root",
    name: "Stilt walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
    newId,
    ...(proportions ? { proportions } : {}),
  });
}

function pieceForBone(project: LegoProject, bone: string) {
  const piece = project.pieces.find((p) => p.bone === bone);
  if (!piece) throw new Error(`no piece for ${bone}`);
  return piece;
}

describe("body plans", () => {
  it.each(
    [...BODY_PLANS, STILTS].map((plan) => [plan.id, plan]),
  )("%s makes a sound skeleton", (_id, plan) => {
    expect(planProblems(plan)).toEqual([]);
  });

  it("has unique plan ids, each found by id", () => {
    const ids = BODY_PLANS.map((plan) => plan.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const plan of BODY_PLANS) expect(bodyPlanById(plan.id)).toBe(plan);
    expect(bodyPlanById("no.such.plan")).toBeUndefined();
  });
});

describe("planProportions", () => {
  it("fills the defaults", () => {
    expect(planProportions(STILTS)).toEqual({ legLength: 8, stance: 3 });
  });

  it("keeps given values, clamps them to the range and drops unknown ones", () => {
    expect(
      planProportions(STILTS, { legLength: 12, stance: 99, tail: 4 }),
    ).toEqual({ legLength: 12, stance: 10 });
  });

  it("uses the default for a value that is not a number", () => {
    expect(planProportions(STILTS, { legLength: Number.NaN })).toEqual({
      legLength: 8,
      stance: 3,
    });
  });
});

describe("projectFromPlan", () => {
  it("records the plan and its proportions on the unit", () => {
    const project = fromStilts({ legLength: 10 });
    expect(project.skeleton).toEqual({
      plan: "test.stilts",
      proportions: { legLength: 10, stance: 3 },
    });
  });

  it("writes one empty piece per bone, with its role and bone id", () => {
    const project = fromStilts();
    expect(project.pieces).toHaveLength(6);
    for (const piece of project.pieces) expect(piece.partId).toBeNull();
    expect(pieceForBone(project, "thigh.l")).toMatchObject({
      name: "lthigh",
      role: "leg.l1.thigh",
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    });
    expect(pieceForBone(project, "base").role).toBeUndefined();
  });

  it("makes the root bone the unit's root piece", () => {
    const project = fromStilts();
    const root = pieceForBone(project, "base");
    expect(root.id).toBe("root");
    expect(root.parentId).toBeNull();
    expect(project.rootPieceId).toBe("root");
  });

  it("hangs each piece off its parent bone's piece", () => {
    const project = fromStilts();
    const thigh = pieceForBone(project, "thigh.l");
    expect(pieceForBone(project, "shin.l").parentId).toBe(thigh.id);
    expect(thigh.parentId).toBe(pieceForBone(project, "hip").id);
  });

  it("places the bones from the proportions", () => {
    const project = fromStilts({ legLength: 10, stance: 4 });
    expect(pieceForBone(project, "hip").position).toEqual([0, 10, 0]);
    expect(pieceForBone(project, "thigh.l").position).toEqual([2, 0, 0]);
    expect(pieceForBone(project, "thigh.r").position).toEqual([-2, 0, 0]);
    expect(pieceForBone(project, "shin.r").position).toEqual([0, -5, 0]);
  });

  it("copies a bone's pivot onto its piece", () => {
    const project = fromStilts();
    expect(pieceForBone(project, "shin.r").pivot).toEqual([0, -1, 0]);
    expect(pieceForBone(project, "shin.l").pivot).toBeUndefined();
  });

  it("pairs twin bones as symmetry twins", () => {
    const project = fromStilts();
    const left = pieceForBone(project, "thigh.l");
    const right = pieceForBone(project, "thigh.r");
    expect(left.twin).toBe(right.id);
    expect(right.twin).toBe(left.id);
    expect(pieceForBone(project, "hip").twin).toBeUndefined();
  });

  it("writes the plan's presets, each a copy", () => {
    const project = fromStilts();
    expect(project.animations).toEqual([
      { presetId: "walk.biped", params: { period: 1.2 } },
    ]);
    expect(project.animations?.[0]?.params).not.toBe(STILTS.presets[0]?.params);
  });

  it("is otherwise the project newProject makes", () => {
    const project = fromStilts();
    expect(project).toMatchObject({
      id: "unit",
      name: "Stilt walker",
      unitName: "stilt_walker",
      packId: "lego",
      createdAt: "2026-10-17T00:00:00Z",
    });
  });

  it("keeps the unit's game", () => {
    const project = projectFromPlan(STILTS, {
      id: "unit",
      rootPieceId: "root",
      name: "Stilt walker",
      packId: "lego",
      packVersion: "1",
      game: null,
      now: "2026-10-17T00:00:00Z",
      newId,
    });
    expect(project.game).toBeNull();
  });

  it("survives a save and a load", () => {
    const project = fromStilts({ legLength: 11 });
    const loaded = parseLegoProjectJson(JSON.stringify(project));
    expect(loaded?.skeleton).toEqual(project.skeleton);
    expect(loaded?.pieces.map((p) => p.bone)).toEqual(
      project.pieces.map((p) => p.bone),
    );
  });
});

describe("releaseSkeleton", () => {
  it("leaves plain pieces where they were", () => {
    const project = fromStilts();
    const released = releaseSkeleton(project);
    expect(released.skeleton).toBeUndefined();
    expect(released.pieces.some((p) => "bone" in p)).toBe(false);
    expect(released.pieces.map((p) => p.role)).toEqual(
      project.pieces.map((p) => p.role),
    );
    expect(released.pieces.map((p) => p.position)).toEqual(
      project.pieces.map((p) => p.position),
    );
    expect(released.animations).toEqual(project.animations);
  });

  it("returns a unit with no skeleton unchanged", () => {
    const project = releaseSkeleton(fromStilts());
    expect(releaseSkeleton(project)).toBe(project);
  });
});

describe("a bone piece copied or moved", () => {
  it("is a free piece once copied", () => {
    const project = fromStilts();
    const thigh = pieceForBone(project, "thigh.l");
    const cutting = subtreeAsCompound(project, thigh.id, {
      id: "cut",
      now: "2026-10-17T00:00:00Z",
      newId,
    });
    if (!cutting) throw new Error("no cutting");
    const pasted = insertCompound(project, cutting, project.rootPieceId, newId);
    const copies = pasted.rootPieceIds.flatMap((id) => {
      const piece = pieceById(pasted.project, id);
      return piece ? [piece] : [];
    });
    expect(copies).toHaveLength(1);
    expect(copies[0]?.bone).toBeUndefined();
    expect(pasted.project.pieces.filter((p) => p.bone === "thigh.l")).toEqual([
      thigh,
    ]);
    expect(
      pasted.project.pieces.filter((p) => p.bone === "shin.l"),
    ).toHaveLength(1);
  });

  it("is left out of a module saved from it", () => {
    const project = fromStilts();
    const cutting = subtreeAsCompound(
      project,
      pieceForBone(project, "hip").id,
      { id: "cut", now: "2026-10-17T00:00:00Z", newId },
    );
    expect(cutting?.pieces).toHaveLength(5);
    expect(cutting?.pieces.some((p) => "bone" in p)).toBe(false);
  });

  it("stays in the plan when its parent is chosen again", () => {
    const project = fromStilts();
    const shin = pieceForBone(project, "shin.l");
    const same = reparentPiece(project, shin.id, shin.parentId as string);
    expect(pieceById(same, shin.id)?.bone).toBe("shin.l");
  });

  it("leaves the plan when it moves to another parent", () => {
    const project = fromStilts();
    const shin = pieceForBone(project, "shin.l");
    const moved = reparentPiece(project, shin.id, project.rootPieceId);
    expect(pieceById(moved, shin.id)?.bone).toBeUndefined();
    expect(pieceForBone(moved, "thigh.l").bone).toBe("thigh.l");
  });
});
