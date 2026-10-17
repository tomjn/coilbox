import { describe, expect, it } from "vitest";
import {
  BIPED,
  bodyPlanById,
  bonesLostWithParts,
  projectFromPlan,
  QUADRUPED,
} from "./bodyPlans";
import { BUILDING, TURRET_BUILDING } from "./buildingPlans";
import type { LegoPiece, LegoProject } from "./model";
import { framesAgree, worldMatrix } from "./reparent";
import {
  applyProportions,
  boneWorldPositions,
  clampProportion,
  proportionHandles,
} from "./skeletonEdit";
import { TRACKED, WHEELED } from "./vehiclePlans";

function unit(plan = BIPED, proportions?: Record<string, number>): LegoProject {
  let n = 0;
  return projectFromPlan(plan, {
    id: "u",
    rootPieceId: "root",
    name: "Unit",
    packId: "p",
    packVersion: "1",
    now: "2026-01-01T00:00:00.000Z",
    newId: () => `piece-${++n}`,
    proportions,
  });
}

function ids() {
  let n = 0;
  return () => `new-${++n}`;
}

function byBone(project: LegoProject, bone: string): LegoPiece {
  const piece = project.pieces.find((p) => p.bone === bone);
  if (!piece) throw new Error(`no bone ${bone}`);
  return piece;
}

function hang(project: LegoProject, bone: string): LegoProject {
  const parent = byBone(project, bone);
  return {
    ...project,
    pieces: [
      ...project.pieces,
      {
        id: `hung-${bone}`,
        name: `hung_${bone.replace(/\W/g, "_")}`,
        parentId: parent.id,
        partId: "some-part",
        position: [1, 2, 3],
        rotation: [0, 0, 0],
        scale: [2, 3, 4],
      },
    ],
  };
}

describe("applyProportions", () => {
  it("moves the bones a proportion places and records the value", () => {
    const next = applyProportions(unit(), BIPED, { stance: 40 }, ids()).project;

    expect(byBone(next, "thigh.l1").position[0]).toBe(20);
    expect(byBone(next, "thigh.r1").position[0]).toBe(-20);
    expect(next.skeleton?.proportions.stance).toBe(40);
  });

  it("keeps left and right bones mirrors", () => {
    const next = applyProportions(
      unit(),
      BIPED,
      { stance: 33.3, legLength: 12 },
      ids(),
    ).project;

    for (const segment of ["thigh", "shin", "foot"]) {
      const l = byBone(next, `${segment}.l1`).position;
      const r = byBone(next, `${segment}.r1`).position;
      // Plus zero turns -0 into 0.
      expect([-r[0] + 0, r[1], r[2]]).toEqual(l);
    }
  });

  it("leaves a bone alone when the change does not place it", () => {
    const moved = unit();
    const hand = {
      ...moved,
      pieces: moved.pieces.map((p) =>
        p.bone === "torso"
          ? { ...p, position: [9, 9, 9] as [number, number, number] }
          : p,
      ),
    };

    const next = applyProportions(hand, BIPED, { stance: 40 }, ids()).project;

    expect(byBone(next, "torso").position).toEqual([9, 9, 9]);
  });

  it("puts a hand moved bone back when the change places it", () => {
    const base = unit();
    const hand = {
      ...base,
      pieces: base.pieces.map((p) =>
        p.bone === "torso"
          ? { ...p, position: [9, 9, 9] as [number, number, number] }
          : p,
      ),
    };

    const next = applyProportions(
      hand,
      BIPED,
      { bodyHeight: 10 },
      ids(),
    ).project;

    expect(byBone(next, "torso").position).toEqual([0, 10, 0]);
  });

  it("carries a part hung on a bone and keeps its size", () => {
    const hung = hang(unit(), "thigh.l1");

    const next = applyProportions(
      hung,
      BIPED,
      { legLength: 30 },
      ids(),
    ).project;
    const part = next.pieces.find((p) => p.id === "hung-thigh.l1");

    expect(part?.parentId).toBe(byBone(next, "thigh.l1").id);
    expect(part?.position).toEqual([1, 2, 3]);
    expect(part?.scale).toEqual([2, 3, 4]);
    expect(boneWorldPositions(next).get("thigh.l1")?.[1]).toBe(30);
  });

  it("holds a value outside the range to the range", () => {
    const next = applyProportions(
      unit(),
      BIPED,
      { legLength: 500 },
      ids(),
    ).project;

    expect(next.skeleton?.proportions.legLength).toBe(40);
  });

  it("keeps the feet on the ground for every plan and proportion", () => {
    const cases: [typeof BIPED, Record<string, number>][] = [
      [BIPED, { legLength: 33, stance: 12, bodyHeight: 20 }],
      [QUADRUPED, { legLength: 7, bodyLength: 60 }],
      [WHEELED, { wheelHeight: 9, axleSpacing: 40 }],
      [TRACKED, { trackHeight: 14, trackLength: 30 }],
    ];
    for (const [plan, values] of cases) {
      const next = applyProportions(unit(plan), plan, values, ids()).project;
      const world = boneWorldPositions(next);
      const ground =
        plan.id === "wheeled" || plan.id === "tracked" ? "base" : "foot.l1";
      expect(world.get(ground)?.[1]).toBe(0);
      if (plan.id === "biped" || plan.id === "quadruped") {
        expect(world.get("foot.r1")?.[1]).toBe(0);
      }
    }
  });

  it("adds the bones a larger count needs, twinned, with the rest untouched", () => {
    const next = applyProportions(
      unit(WHEELED),
      WHEELED,
      { axles: 3 },
      ids(),
    ).project;

    expect(next.pieces.filter((p) => p.role === "wheel")).toHaveLength(6);
    const l3 = byBone(next, "wheel.l3");
    const r3 = byBone(next, "wheel.r3");
    expect(l3.twin).toBe(r3.id);
    expect(r3.twin).toBe(l3.id);
    expect(l3.parentId).toBe(byBone(next, "body").id);
    expect(new Set(next.pieces.map((p) => p.name)).size).toBe(
      next.pieces.length,
    );
  });

  it("removes the bones a smaller count drops and frees their twin links", () => {
    const next = applyProportions(
      unit(WHEELED, { axles: 4 }),
      WHEELED,
      { axles: 2 },
      ids(),
    ).project;

    expect(next.pieces.filter((p) => p.role === "wheel")).toHaveLength(4);
    expect(next.pieces.find((p) => p.bone === "wheel.l4")).toBeUndefined();
    const present = new Set(next.pieces.map((p) => p.id));
    expect(next.pieces.every((p) => !p.twin || present.has(p.twin))).toBe(true);
  });

  it("moves a piece hung on a removed bone up to the bone's parent, where it was", () => {
    const hung = hang(unit(WHEELED, { axles: 3 }), "wheel.l3");

    const next = applyProportions(hung, WHEELED, { axles: 2 }, ids()).project;
    const part = next.pieces.find((p) => p.id === "hung-wheel.l3");

    expect(part?.parentId).toBe(byBone(next, "body").id);
    // The bone sat at its z, so the piece keeps its place in the unit.
    const lost = byBone(hung, "wheel.l3").position;
    expect(part?.position).toEqual([lost[0] + 1, lost[1] + 2, lost[2] + 3]);
  });

  it("keeps a piece hung on a turned removed bone where and which way it was, under a turned parent", () => {
    const base = hang(unit(WHEELED, { axles: 3 }), "wheel.l3");
    const turned: LegoProject = {
      ...base,
      pieces: base.pieces.map((p) => {
        if (p.bone === "body") return { ...p, rotation: [0.3, 0.9, -0.2] };
        if (p.bone === "wheel.l3") {
          return { ...p, rotation: [0.5, -1.1, 0.4], scale: [1.5, 1.5, 1.5] };
        }
        return p;
      }),
    };

    const next = applyProportions(turned, WHEELED, { axles: 2 }, ids()).project;

    const part = next.pieces.find((p) => p.id === "hung-wheel.l3");
    expect(part?.parentId).toBe(byBone(next, "body").id);
    expect(
      framesAgree(
        worldMatrix(turned, "hung-wheel.l3"),
        worldMatrix(next, "hung-wheel.l3"),
      ),
    ).toBe(true);
  });

  it("does nothing to a unit without a skeleton or for another plan", () => {
    const plain = { ...unit(), skeleton: undefined };
    expect(applyProportions(plain, BIPED, { stance: 40 }, ids()).project).toBe(
      plain,
    );
    expect(
      applyProportions(unit(), QUADRUPED, { stance: 40 }, ids()).project,
    ).toEqual(unit());
  });

  it("reports the bones with parts that a smaller count would delete", () => {
    const hung = hang(unit(WHEELED, { axles: 3 }), "wheel.l3");

    const lost = bonesLostWithParts(hung, WHEELED, { axles: 2 });

    expect(lost.map((p) => p.bone)).toEqual(["wheel.l3"]);
  });
});

describe("clampProportion", () => {
  it("holds a value to the range and says whether it did", () => {
    const stance = BIPED.proportions.find((p) => p.id === "stance");
    if (!stance) throw new Error("no stance");
    expect(clampProportion(stance, 5)).toEqual({ value: 10, held: true });
    expect(clampProportion(stance, 70)).toEqual({ value: 60, held: true });
    expect(clampProportion(stance, 30)).toEqual({ value: 30, held: false });
  });

  it("rounds a count before it holds it", () => {
    const axles = WHEELED.proportions.find((p) => p.id === "axles");
    if (!axles) throw new Error("no axles");
    expect(clampProportion(axles, 3.4)).toEqual({ value: 3, held: false });
    expect(clampProportion(axles, 9)).toEqual({ value: 5, held: true });
  });
});

describe("proportionHandles", () => {
  it("puts a handle at a joint with the gain the joint moves by", () => {
    const handles = proportionHandles(unit(), BIPED);
    const stance = handles.find((h) => h.id === "stance");

    expect(stance).toMatchObject({ axis: 0, gain: 0.5, value: 29.8 });
    expect(stance?.at[0]).toBeCloseTo(14.9);
    expect(handles.find((h) => h.id === "legLength")).toMatchObject({
      axis: 1,
      gain: 1,
    });
  });

  it("has a handle for every length of every plan and none for a count", () => {
    for (const plan of [
      BIPED,
      QUADRUPED,
      WHEELED,
      TRACKED,
      TURRET_BUILDING,
      BUILDING,
    ]) {
      const handles = proportionHandles(unit(plan), plan);
      const lengths = plan.proportions.filter((p) => p.unit === "elmo");
      expect(handles.map((h) => h.id).sort()).toEqual(
        lengths.map((p) => p.id).sort(),
      );
    }
  });

  it("follows the pointer: moving the handle by d changes the value by d / gain", () => {
    const project = unit(WHEELED, { axles: 3 });
    const handle = proportionHandles(project, WHEELED).find(
      (h) => h.id === "axleSpacing",
    );
    if (!handle) throw new Error("no handle");

    const next = applyProportions(
      project,
      WHEELED,
      { axleSpacing: handle.value + 4 / handle.gain },
      ids(),
    ).project;

    const moved = proportionHandles(next, WHEELED).find(
      (h) => h.id === "axleSpacing",
    );
    expect((moved?.at[2] ?? 0) - handle.at[2]).toBeCloseTo(4);
  });

  it("is empty for a unit without a skeleton", () => {
    expect(
      proportionHandles({ ...unit(), skeleton: undefined }, BIPED),
    ).toEqual([]);
  });

  it("finds a plan by id", () => {
    expect(bodyPlanById("biped")).toBe(BIPED);
  });
});
