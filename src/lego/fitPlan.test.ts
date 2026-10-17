import { describe, expect, it } from "vitest";

import { BIPED, QUADRUPED } from "./bodyPlans";
import { TURRET_BUILDING } from "./buildingPlans";
import { planById } from "./describedPlan";
import { fitPlan, planBones, suggestPicks } from "./fitPlan";
import {
  type LegoPiece,
  type LegoProject,
  newProject,
  parseLegoProjectJson,
} from "./model";
import { worldMatrix } from "./reparent";
import {
  applyProportions,
  boneWorldPositions,
  proportionHandles,
  resetToPlan,
} from "./skeletonEdit";
import { applyTarget } from "./skeletonSize";
import { TRACKED, WHEELED } from "./vehiclePlans";

function piece(
  id: string,
  parentId: string | null,
  position: [number, number, number],
  extra: Partial<LegoPiece> = {},
): LegoPiece {
  return {
    id,
    name: id,
    parentId,
    partId: null,
    position,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...extra,
  };
}

function unit(pieces: LegoPiece[], extra: Partial<LegoProject> = {}) {
  const base = newProject({
    id: "u",
    rootPieceId: "root",
    name: "Walker",
    packId: "p",
    packVersion: "1",
    now: "2026-10-17T00:00:00.000Z",
  });
  return {
    ...base,
    pieces: [base.pieces[0] as LegoPiece, ...pieces],
    ...extra,
  };
}

/** A walker from a game: a pelvis 20 above the ground, legs hung under it
 *  with their joints 8 and 12 apart, and a torso 6 above the pelvis. */
function walker(): LegoProject {
  return unit([
    piece("pelvis", "root", [0, 20, 0]),
    piece("torso", "pelvis", [0, 6, 0], { role: "turret" }),
    piece("lthigh", "pelvis", [7, 0, 0], { meshId: "m1" }),
    piece("lleg", "lthigh", [0, -8, 0], { meshId: "m2" }),
    piece("lfoot", "lleg", [0, -12, 0]),
    piece("rthigh", "pelvis", [-7, 0, 0], { meshId: "m3" }),
    piece("rleg", "rthigh", [0, -8, 0], { meshId: "m4" }),
    piece("rfoot", "rleg", [0, -12, 0]),
  ]);
}

const WALKER_PICKS = {
  base: "root",
  hip: "pelvis",
  torso: "torso",
  "thigh.l1": "lthigh",
  "shin.l1": "lleg",
  "foot.l1": "lfoot",
  "thigh.r1": "rthigh",
  "shin.r1": "rleg",
  "foot.r1": "rfoot",
};

describe("fitPlan", () => {
  it("sets each picked piece's bone and role, and moves nothing", () => {
    const before = walker();
    const { project } = fitPlan(before, BIPED, {}, WALKER_PICKS);
    const byId = new Map(project.pieces.map((p) => [p.id, p]));
    expect(byId.get("lthigh")?.bone).toBe("thigh.l1");
    expect(byId.get("lthigh")?.role).toBe("leg.l1.thigh");
    expect(byId.get("rfoot")?.role).toBe("leg.r1.foot");
    expect(byId.get("pelvis")?.role).toBe("base");
    for (const was of before.pieces) {
      const now = byId.get(was.id);
      expect(now?.position).toEqual(was.position);
      expect(now?.rotation).toEqual(was.rotation);
      expect(now?.scale).toEqual(was.scale);
      expect(now?.parentId).toBe(was.parentId);
      expect(now?.meshId).toBe(was.meshId);
    }
    expect(project.pieces).toHaveLength(before.pieces.length);
  });

  it("measures the plan's proportions off the picked joints", () => {
    const { project, unmeasured } = fitPlan(walker(), BIPED, {}, WALKER_PICKS);
    expect(project.skeleton).toEqual({
      plan: "biped",
      fitted: true,
      proportions: { legLength: 20, stance: 14, bodyHeight: 6 },
    });
    expect(unmeasured).toEqual([]);
  });

  it("measures through a turned parent, from where the joints really are", () => {
    // The whole walker turned a quarter about y: the hips now lie along z.
    const turned = walker();
    turned.pieces = turned.pieces.map((p) =>
      p.id === "root" ? { ...p, rotation: [0, Math.PI / 2, 0] } : p,
    );
    const { project } = fitPlan(turned, BIPED, {}, WALKER_PICKS);
    expect(project.skeleton?.proportions).toEqual({
      legLength: 20,
      stance: 14,
      bodyHeight: 6,
    });
  });

  it("leaves a proportion it cannot measure missing", () => {
    const picks = { "thigh.l1": "lthigh", "foot.l1": "lfoot" };
    const { project, unmeasured } = fitPlan(walker(), BIPED, {}, picks);
    expect(project.skeleton?.proportions).toEqual({ legLength: 20 });
    expect(unmeasured).toEqual(["stance", "bodyHeight"]);
  });

  it("keeps a measured value the plan's range would not allow", () => {
    // A torso below the hip measures a negative body height, which is what
    // the unit has. Nothing places a fitted unit's bones, so it is not held.
    const low = walker();
    low.pieces = low.pieces.map((p) =>
      p.id === "torso" ? { ...p, position: [0, -2, 0] } : p,
    );
    const { project } = fitPlan(low, BIPED, {}, WALKER_PICKS);
    expect(project.skeleton?.proportions.bodyHeight).toBe(-2);
  });

  it("replaces a role already on a picked piece and says so", () => {
    const { project, replaced } = fitPlan(walker(), BIPED, {}, WALKER_PICKS);
    // The torso bone has no role, so the torso keeps its own.
    expect(project.pieces.find((p) => p.id === "torso")?.role).toBe("turret");
    expect(replaced).toEqual([]);

    const tagged = walker();
    tagged.pieces = tagged.pieces.map((p) =>
      p.id === "lleg" ? { ...p, role: "leg.r1.shin" } : p,
    );
    const fit = fitPlan(tagged, BIPED, {}, WALKER_PICKS);
    expect(fit.replaced).toEqual([
      { pieceId: "lleg", from: "leg.r1.shin", to: "leg.l1.shin" },
    ]);
    expect(fit.project.pieces.find((p) => p.id === "lleg")?.role).toBe(
      "leg.l1.shin",
    );
  });

  it("adds the plan's presets when the picks meet them", () => {
    const { project, presets } = fitPlan(walker(), BIPED, {}, WALKER_PICKS);
    expect(project.animations).toEqual([
      { presetId: "walk.biped", params: {} },
    ]);
    expect(presets).toEqual({ added: ["walk.biped"], present: [], held: [] });
  });

  it("keeps the unit's own parameters for a preset it already has", () => {
    const has = unit(walker().pieces.slice(1), {
      animations: [{ presetId: "walk.biped", params: { period: 2 } }],
    });
    const { project, presets } = fitPlan(has, BIPED, {}, WALKER_PICKS);
    expect(project.animations).toEqual([
      { presetId: "walk.biped", params: { period: 2 } },
    ]);
    expect(presets.present).toEqual(["walk.biped"]);
  });

  it("holds back a preset whose roles have no piece", () => {
    const picks = { "thigh.l1": "lthigh", "shin.l1": "lleg" };
    const { project, presets } = fitPlan(walker(), BIPED, {}, picks);
    expect(project.animations).toBeUndefined();
    expect(presets.held).toEqual([
      {
        presetId: "walk.biped",
        params: {},
        missing: ["leg.r1.thigh", "leg.r1.shin"],
      },
    ]);
  });

  it("drops bones the unit had before, and a second claim on one piece", () => {
    const old = unit(
      walker()
        .pieces.slice(1)
        .map((p) => (p.id === "rfoot" ? { ...p, bone: "foot.r1" } : p)),
      { skeleton: { plan: "biped", proportions: { legLength: 10 } } },
    );
    const { project } = fitPlan(
      old,
      BIPED,
      {},
      {
        "thigh.l1": "lthigh",
        "thigh.r1": "lthigh",
      },
    );
    const bones = project.pieces.filter((p) => p.bone !== undefined);
    expect(bones.map((p) => [p.id, p.bone])).toEqual([["lthigh", "thigh.l1"]]);
  });

  it("ignores a pick naming a bone the plan lacks or a piece the unit lacks", () => {
    const { project } = fitPlan(
      walker(),
      BIPED,
      {},
      {
        "wheel.l1": "lthigh",
        "thigh.l1": "nobody",
      },
    );
    expect(project.pieces.some((p) => p.bone !== undefined)).toBe(false);
  });

  it("survives a save and a load", () => {
    const { project } = fitPlan(walker(), BIPED, {}, WALKER_PICKS);
    const loaded = parseLegoProjectJson(JSON.stringify(project));
    expect(loaded?.skeleton).toEqual(project.skeleton);
    expect(loaded?.pieces.find((p) => p.id === "lfoot")?.bone).toBe("foot.l1");
  });

  it("measures a quadruped's body length between its front and rear hips", () => {
    const quad = unit([
      piece("body", "root", [0, 15, 0]),
      piece("fl", "body", [5, 0, 10]),
      piece("fr", "body", [-5, 0, 10]),
      piece("bl", "body", [5, 0, -10]),
      piece("br", "body", [-5, 0, -10]),
      piece("flf", "fl", [0, -15, 0]),
    ]);
    const { project } = fitPlan(
      quad,
      QUADRUPED,
      {},
      {
        body: "body",
        "thigh.l1": "fl",
        "thigh.r1": "fr",
        "thigh.l2": "bl",
        "thigh.r2": "br",
        "foot.l1": "flf",
      },
    );
    expect(project.skeleton?.proportions).toEqual({
      legLength: 15,
      stance: 10,
      bodyLength: 20,
    });
  });

  it("measures a wheeled unit's axles and records the count chosen", () => {
    const car = unit([
      piece("hull", "root", [0, 5, 0]),
      piece("w1l", "hull", [12, 0, 9]),
      piece("w1r", "hull", [-12, 0, 9]),
      piece("w3l", "hull", [12, 0, -9]),
    ]);
    const { project, unmeasured } = fitPlan(
      car,
      WHEELED,
      { axles: 3 },
      {
        body: "hull",
        "wheel.l1": "w1l",
        "wheel.r1": "w1r",
        "wheel.l3": "w3l",
      },
    );
    expect(project.skeleton?.proportions).toEqual({
      axles: 3,
      axleSpacing: 9,
      trackWidth: 24,
      wheelHeight: 5,
    });
    expect(unmeasured).toEqual([]);
    expect(project.pieces.filter((p) => p.role === "wheel")).toHaveLength(3);
    expect(project.animations).toEqual([
      { presetId: "wheels.roll", params: {} },
    ]);
  });

  it("measures a tracked unit from its tracks and road wheels", () => {
    const tank = unit([
      piece("hull", "root", [0, 5, 0]),
      piece("tl", "hull", [9, 0, 0]),
      piece("tr", "hull", [-9, 0, 0]),
      // 3 road wheels a side, the first and last 26 apart.
      piece("rw1", "tl", [0, -1.6, 13]),
      piece("rw3", "tl", [0, -1.6, -13]),
    ]);
    const { project } = fitPlan(
      tank,
      TRACKED,
      { roadWheels: 3 },
      {
        "track.l": "tl",
        "track.r": "tr",
        "wheel.l1": "rw1",
        "wheel.l3": "rw3",
      },
    );
    expect(project.skeleton?.proportions).toEqual({
      roadWheels: 3,
      trackLength: 40,
      trackWidth: 18,
      trackHeight: 10,
    });
  });

  it("measures a turret building's base, turret and barrel", () => {
    const gun = unit([
      piece("turret", "root", [0, 40, 0]),
      piece("sleeve", "turret", [0, 12, 0]),
      piece("muzzle", "sleeve", [0, 0, 30]),
    ]);
    const { project } = fitPlan(
      gun,
      TURRET_BUILDING,
      {},
      {
        base: "root",
        turret: "turret",
        barrel: "sleeve",
        flare: "muzzle",
      },
    );
    expect(project.skeleton?.proportions).toEqual({
      baseHeight: 40,
      turretHeight: 12,
      barrelLength: 30,
    });
    expect(project.animations?.map((a) => a.presetId)).toEqual([
      "turret.track",
      "recoil",
    ]);
  });
});

describe("a fitted skeleton", () => {
  it("is not moved by proportions, a target or handles", () => {
    const { project } = fitPlan(walker(), BIPED, {}, WALKER_PICKS);
    expect(
      applyProportions(project, BIPED, { legLength: 30 }, () => "new").project,
    ).toBe(project);
    expect(
      applyTarget(
        project,
        BIPED,
        { footprint: { x: 4, z: 4 }, height: 60 },
        () => "new",
      ),
    ).toBe(project);
    expect(proportionHandles(project, BIPED)).toEqual([]);
  });
});

describe("planBones", () => {
  it("lists the bones for the counts given", () => {
    expect(planBones(WHEELED, { axles: 3 }).map((b) => b.id)).toContain(
      "wheel.r3",
    );
    expect(planBones(WHEELED, {}).map((b) => b.id)).not.toContain("wheel.l3");
  });
});

describe("a described plan (#3263)", () => {
  it("fits with its gun and build arm, and measures them", () => {
    const plan = planById("wheeled+gun+build");
    if (!plan) throw new Error("no plan");
    const car = unit([
      piece("hull", "root", [0, 5, 0]),
      piece("gun", "hull", [0, 3, 0]),
      piece("sleeve", "gun", [0, 4, 0]),
      piece("muzzle", "sleeve", [0, 0, 20]),
      piece("arm", "hull", [0, 0, 0]),
      piece("nozzle", "arm", [0, 7, 0]),
    ]);
    const { project, unmeasured } = fitPlan(
      car,
      plan,
      {},
      {
        body: "hull",
        turret: "gun",
        barrel: "sleeve",
        flare: "muzzle",
        "buildarm.arm": "arm",
        "buildarm.nozzle": "nozzle",
      },
    );
    expect(project.skeleton?.plan).toBe("wheeled+gun+build");
    expect(project.skeleton?.proportions).toMatchObject({
      turretHeight: 4,
      barrelLength: 20,
      nanoRise: 7,
    });
    expect(unmeasured).toEqual(
      expect.arrayContaining(["axleSpacing", "trackWidth", "wheelHeight"]),
    );
    expect(project.pieces.find((p) => p.id === "gun")?.role).toBe("turret");
    expect(project.animations?.map((a) => a.presetId)).toEqual(
      expect.arrayContaining(["turret.track", "recoil"]),
    );
  });
});

describe("suggestPicks", () => {
  it("suggests the root for the root bone and a piece named as a bone", () => {
    const gun = unit([
      piece("turret", "root", [0, 40, 0]),
      piece("BARREL", "turret", [0, 12, 0]),
    ]);
    expect(suggestPicks(gun, planBones(TURRET_BUILDING, {}))).toEqual({
      base: "root",
      turret: "turret",
      barrel: "BARREL",
    });
  });

  it("never suggests a leg from a name, only from a role already set", () => {
    const named = unit([
      piece("lthigh", "root", [5, 10, 0]),
      piece("rthigh", "root", [-5, 10, 0], { role: "leg.r1.thigh" }),
    ]);
    const picks = suggestPicks(named, planBones(BIPED, {}));
    expect(picks["thigh.l1"]).toBeUndefined();
    expect(picks["thigh.r1"]).toBe("rthigh");
  });

  it("does not suggest from a role many pieces share", () => {
    const car = unit([
      piece("a", "root", [5, 5, 0], { role: "wheel" }),
      piece("b", "root", [-5, 5, 0], { role: "wheel" }),
    ]);
    const picks = suggestPicks(car, planBones(WHEELED, {}));
    expect(Object.values(picks)).not.toContain("a");
    expect(Object.values(picks)).not.toContain("b");
  });

  it("suggests each piece for one bone at most", () => {
    const one = unit([piece("base", "root", [0, 0, 0], { role: "base" })]);
    const picks = suggestPicks(one, planBones(BIPED, {}));
    const pieces = Object.values(picks);
    expect(new Set(pieces).size).toBe(pieces.length);
  });
});

describe("resetToPlan", () => {
  const ids = () => {
    let n = 0;
    return () => `new${++n}`;
  };
  const fitted = (project: LegoProject = walker()) =>
    fitPlan(project, BIPED, {}, WALKER_PICKS).project;
  const byId = (project: LegoProject, id: string) =>
    project.pieces.find((p) => p.id === id) as LegoPiece;

  it("lists the pieces it moves and the pieces it reparents", () => {
    // The left foot hangs from the pelvis instead of the shin.
    const odd = walker();
    odd.pieces = odd.pieces.map((p) =>
      p.id === "lfoot"
        ? { ...p, parentId: "pelvis", position: [7, -20, 0] }
        : p,
    );
    const reset = resetToPlan(fitted(odd), BIPED, ids());
    expect(reset.reparented).toEqual([
      { pieceId: "lfoot", name: "lfoot", from: "pelvis", to: "lleg" },
    ]);
    const moved = reset.moved.map((p) => p.id);
    expect(moved).toContain("lfoot");
    expect(moved).toContain("lleg");
    expect(moved).not.toContain("pelvis");
    expect(reset.added).toEqual([]);
    expect(byId(reset.project, "lfoot").parentId).toBe("lleg");
    expect(byId(reset.project, "lfoot").position).toEqual(
      byId(reset.project, "rfoot").position,
    );
  });

  it("lets the plan edit proportions afterwards", () => {
    const start = fitted();
    expect(proportionHandles(start, BIPED)).toEqual([]);
    const { project } = resetToPlan(start, BIPED, ids());
    expect(project.skeleton?.fitted).toBeUndefined();
    expect(project.skeleton?.proportions).toEqual({
      legLength: 20,
      stance: 14,
      bodyHeight: 6,
    });
    expect(proportionHandles(project, BIPED).length).toBeGreaterThan(0);
    const longer = applyProportions(
      project,
      BIPED,
      { legLength: 30 },
      ids(),
    ).project;
    expect(longer).not.toBe(project);
    expect(boneWorldPositions(longer).get("hip")?.[1]).toBe(30);
    expect(boneWorldPositions(longer).get("foot.l1")?.[1]).toBeCloseTo(0);
  });

  it("adds a bone the fit left unmatched", () => {
    const noFoot = walker();
    noFoot.pieces = noFoot.pieces.filter((p) => p.id !== "rfoot");
    const picks = { ...WALKER_PICKS } as Record<string, string>;
    delete picks["foot.r1"];
    const start = fitPlan(noFoot, BIPED, {}, picks).project;
    const reset = resetToPlan(start, BIPED, ids());
    expect(reset.added).toEqual(["rfoot"]);
    const foot = reset.project.pieces.find((p) => p.bone === "foot.r1");
    expect(foot?.parentId).toBe("rleg");
    expect(foot?.twin).toBeDefined();
    expect(boneWorldPositions(reset.project).get("foot.r1")?.[1]).toBeCloseTo(
      0,
    );
  });

  it("keeps a piece hung on a bone where it was in the unit", () => {
    const hung = walker();
    hung.pieces = [
      ...hung.pieces,
      piece("plate", "lleg", [1, -3, 0.5], {
        rotation: [0.2, 0.4, 0],
        scale: [2, 1, 1],
        meshId: "m9",
      }),
    ];
    const start = fitted(hung);
    const reset = resetToPlan(start, BIPED, ids());
    expect(reset.moved.map((p) => p.id)).toContain("lleg");
    expect(byId(reset.project, "lleg").position).not.toEqual(
      byId(start, "lleg").position,
    );
    const before = worldMatrix(start, "plate").elements;
    const after = worldMatrix(reset.project, "plate").elements;
    before.forEach((n, i) => {
      expect(after[i]).toBeCloseTo(n, 6);
    });
    expect(byId(reset.project, "plate").parentId).toBe("lleg");
  });

  it("is one new project and leaves the fitted one alone", () => {
    const start = fitted();
    const frozen = JSON.stringify(start);
    const reset = resetToPlan(start, BIPED, ids());
    expect(reset.project).not.toBe(start);
    expect(JSON.stringify(start)).toBe(frozen);
    expect(resetToPlan(reset.project, BIPED, ids()).project).toBe(
      reset.project,
    );
  });
});
