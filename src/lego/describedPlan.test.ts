import { describe, expect, it } from "vitest";

import { presetById } from "./animPresets";
import { BODY_PLANS, planProportions, projectFromPlan } from "./bodyPlans";
import {
  describedPlan,
  MAX_WEAPONS,
  MOVES,
  movementPlan,
  planById,
  withGroups,
} from "./describedPlan";
import { missingPieces } from "./luaPieces";
import { buildLuaScript } from "./luaScript";
import { applyProportions } from "./skeletonEdit";
import {
  defaultTarget,
  fitProportions,
  projectFromTarget,
  skeletonSize,
} from "./skeletonSize";

let counter = 0;
const newId = () => `id${counter++}`;
const options = {
  id: "unit",
  rootPieceId: "root",
  name: "Unit",
  packId: "pack",
  packVersion: "1",
  now: "2026-01-01T00:00:00.000Z",
  newId,
};

const roles = (plan: ReturnType<typeof describedPlan>) =>
  plan.bones(planProportions(plan)).flatMap((b) => (b.role ? [b.role] : []));

describe("describedPlan", () => {
  it("offers a choice for every movement plan in the registry that moves or stands", () => {
    for (const move of MOVES) {
      expect(() => movementPlan(move.id, 0)).not.toThrow();
    }
  });

  it("returns the registry plan itself when there is nothing to add", () => {
    for (const id of [
      "biped",
      "quadruped",
      "wheeled",
      "tracked",
      "hover",
    ] as const) {
      expect(describedPlan({ move: id, weapons: 0, builds: false })).toBe(
        BODY_PLANS.find((p) => p.id === id),
      );
    }
    expect(
      describedPlan({ move: "static", weapons: 0, builds: false }).id,
    ).toBe("building");
  });

  it("makes a static unit with a weapon the turret building", () => {
    const plan = describedPlan({ move: "static", weapons: 1, builds: false });
    expect(plan.id).toBe("turret.building");
  });

  it("adds turret, barrel and flare to a walker with a weapon", () => {
    const plan = describedPlan({ move: "biped", weapons: 1, builds: false });
    expect(plan.id).toBe("biped+gun");
    expect(roles(plan)).toEqual(
      expect.arrayContaining(["turret", "barrel", "flare"]),
    );
    expect(plan.presets.map((p) => p.presetId)).toEqual([
      "walk.biped",
      "turret.track",
      "recoil",
    ]);
    const turret = plan
      .bones(planProportions(plan))
      .find((b) => b.id === "turret");
    expect(turret?.parent).toBe("torso");
  });

  it("offers hovering, and puts a hovercraft's weapon and build arm on its deck", () => {
    expect(MOVES.map((m) => m.id)).toContain("hover");
    const plan = describedPlan({ move: "hover", weapons: 1, builds: true });
    expect(plan.id).toBe("hover+gun+build");
    expect(plan.presets.map((p) => p.presetId)).toEqual([
      "hover.bob",
      "wake.moving",
      "turret.track",
      "recoil",
      "build.aim",
      "build.nano",
    ]);
    const bones = plan.bones(planProportions(plan));
    expect(bones.find((b) => b.id === "turret")?.parent).toBe("deck");
    expect(bones.find((b) => b.id === "buildarm.base")?.parent).toBe("deck");
    const project = projectFromPlan(plan, options);
    expect(
      missingPieces(
        buildLuaScript(project),
        project.pieces.map((p) => p.name),
      ),
    ).toEqual([]);
  });

  it("adds the four build arm bones and both build presets", () => {
    const plan = describedPlan({ move: "tracked", weapons: 0, builds: true });
    expect(plan.id).toBe("tracked+build");
    expect(roles(plan)).toEqual(
      expect.arrayContaining([
        "buildarm.base",
        "buildarm.arm",
        "buildarm.nozzle",
        "buildarm.nano",
      ]),
    );
    expect(plan.presets.map((p) => p.presetId)).toEqual([
      "wheels.roll",
      "build.aim",
      "build.nano",
    ]);
    for (const preset of plan.presets) {
      expect(presetById(preset.presetId)).toBeDefined();
    }
  });

  it("combines a weapon and a build arm without a clash of roles or ids", () => {
    const plan = describedPlan({ move: "wheeled", weapons: 1, builds: true });
    expect(plan.id).toBe("wheeled+gun+build");
    const bones = plan.bones(planProportions(plan));
    const ids = bones.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    const roleList = roles(plan);
    expect(roleList.filter((r) => r === "turret")).toHaveLength(1);
    expect(roleList.filter((r) => r === "buildarm.arm")).toHaveLength(1);
    for (const bone of bones) {
      if (bone.parent !== null) expect(ids).toContain(bone.parent);
    }
  });

  it("does not add a second turret to a turret building that builds", () => {
    const plan = describedPlan({ move: "static", weapons: 1, builds: true });
    expect(plan.id).toBe("turret.building+build");
    expect(roles(plan).filter((r) => r === "turret")).toHaveLength(1);
  });

  it("holds the weapon count to what a plan can describe", () => {
    expect(MAX_WEAPONS).toBe(1);
    expect(describedPlan({ move: "biped", weapons: 5, builds: false }).id).toBe(
      "biped+gun",
    );
    expect(
      describedPlan({ move: "biped", weapons: -2, builds: false }).id,
    ).toBe("biped");
  });

  it("takes the group's defaults from the plans' measured medians", () => {
    const plan = describedPlan({ move: "biped", weapons: 1, builds: true });
    const values = planProportions(plan);
    expect(values.turretHeight).toBe(13.7);
    expect(values.barrelLength).toBe(41.1);
    expect(values.nanoRise).toBe(17.1);
  });
});

describe("planById", () => {
  it("finds registry plans and every described id", () => {
    for (const plan of BODY_PLANS) expect(planById(plan.id)).toBe(plan);
    for (const move of MOVES) {
      for (const weapons of [0, 1]) {
        for (const builds of [false, true]) {
          const plan = describedPlan({ move: move.id, weapons, builds });
          expect(planById(plan.id)?.id).toBe(plan.id);
        }
      }
    }
  });

  it("finds nothing for an id no plan writes", () => {
    expect(planById("submarine")).toBeUndefined();
    expect(planById("biped+wings")).toBeUndefined();
    expect(planById("biped+build+gun")).toBeUndefined();
    expect(planById("turret.building+gun")).toBeUndefined();
  });
});

describe("a described unit", () => {
  it("keeps its groups when a proportion changes", () => {
    const plan = describedPlan({ move: "biped", weapons: 1, builds: true });
    const project = projectFromPlan(plan, options);
    const { project: edited } = applyProportions(
      project,
      plan,
      { legLength: 25 },
      newId,
    );
    const names = edited.pieces.map((p) => p.bone);
    expect(names).toEqual(
      expect.arrayContaining(["turret", "flare", "buildarm.nano"]),
    );
    expect(edited.pieces).toHaveLength(project.pieces.length);
  });

  it("is sized by the movement plan's rule", () => {
    const plan = describedPlan({ move: "quadruped", weapons: 1, builds: true });
    const base = BODY_PLANS.find((p) => p.id === "quadruped");
    if (!base) throw new Error("no quadruped");
    expect(defaultTarget(plan)).toEqual(defaultTarget(base));
    const target = { footprint: { x: 3, z: 4 }, height: 40 };
    expect(skeletonSize(plan, fitProportions(plan, {}, target))).toEqual(
      skeletonSize(base, fitProportions(base, {}, target)),
    );
  });

  it("is made fitted to the target, with the plan it names kept", () => {
    const plan = describedPlan({ move: "wheeled", weapons: 1, builds: false });
    const target = { footprint: { x: 3, z: 4 }, height: 12 };
    const project = projectFromTarget(plan, target, options);
    expect(project.skeleton?.plan).toBe("wheeled+gun");
    expect(project.skeleton?.target).toEqual(target);
    expect(project.animations?.map((a) => a.presetId)).toEqual([
      "wheels.roll",
      "turret.track",
      "recoil",
    ]);
  });

  it("writes a script with the weapon hooks and the nano query, naming only pieces it has", () => {
    const plan = describedPlan({ move: "wheeled", weapons: 1, builds: true });
    const project = projectFromPlan(plan, options);
    const lua = buildLuaScript(project);
    expect(lua).toContain("AimWeapon1");
    expect(lua).toContain("QueryWeapon1");
    expect(lua).toContain("Shot1");
    expect(lua).toContain("QueryNanoPiece");
    expect(
      missingPieces(
        lua,
        project.pieces.map((p) => p.name),
      ),
    ).toEqual([]);
  });

  it("builds pieces with the parent chain the plan describes", () => {
    const plan = withGroups(movementPlan("wheeled", 0), {
      weapon: true,
      builds: true,
    });
    const project = projectFromPlan(plan, options);
    const byBone = new Map(project.pieces.map((p) => [p.bone, p]));
    const turret = byBone.get("turret");
    expect(turret?.parentId).toBe(byBone.get("body")?.id);
    expect(byBone.get("buildarm.nano")?.parentId).toBe(
      byBone.get("buildarm.nozzle")?.id,
    );
  });
});
