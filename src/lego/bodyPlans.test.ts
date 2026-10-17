import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { isRole, presetById, unmetRequirements } from "./animPresets";
import { checkBalance, SAME_POSITION } from "./balance";
import {
  BIPED,
  BODY_PLANS,
  type BodyPlan,
  bodyPlanById,
  planProportions,
  projectFromPlan,
  QUADRUPED,
  releaseSkeleton,
} from "./bodyPlans";
import { insertCompound, subtreeAsCompound } from "./compounds";
import { missingPieces } from "./luaPieces";
import { buildLuaScript } from "./luaScript";
import {
  type LegoProject,
  normalisePieceName,
  parseLegoProjectJson,
  pieceById,
} from "./model";
import { type LegoPackManifest, type LoadedPack, mergePacks } from "./pack";
import { reparentPiece } from "./reparent";
import { pieceWorldRest, sitOnGround } from "./s3oBuild";

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

/** The bundled parts with their geometry, as `balance.test.ts` loads them. */
function bundledPack(): LoadedPack {
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
  return {
    ...merged,
    vertices,
    indices,
    library: { packs: [manifest], atlases: [], dir: "", problems: [] },
  };
}

/** Bundled parts the starter Leg module and the hull module are made of. */
const FOOT_PART = "ef440930cc49";
const HULL_PART = "d2c111537495";

/** Every leg role a walk with these pairs drives, thigh to foot. */
function legRolesFor(pairs: number[]): string[] {
  return pairs.flatMap((pair) =>
    ["l", "r"].flatMap((side) =>
      ["thigh", "shin", "foot"].map(
        (segment) => `leg.${side}${pair}.${segment}`,
      ),
    ),
  );
}

/**
 * Runs a unit script under luajit with the engine calls stubbed, calls
 * `Create` and `StartMoving`, and steps every thread started for a few laps.
 * Returns each `piece:axis` a `Turn` was called on.
 */
function turnedOnWalk(lua: string): string[] {
  const harness = `
local turned = {}
x_axis, y_axis, z_axis = 1, 2, 3
local axes = { "x", "y", "z" }
local threads = {}
function piece(...) return ... end
function Turn(p, axis, angle, speed) turned[p .. ":" .. axes[axis]] = true end
function Move() end
function Spin() end
function StopSpin() end
function Signal() end
function SetSignalMask() end
function Explode() end
function WaitForTurn() end
function WaitForMove() end
function Sleep() coroutine.yield() end
function StartThread(f, ...) threads[#threads + 1] = coroutine.create(f) end
SFX = { SHATTER = 1 }
script = {}
local chunk = assert(loadstring(io.read("*a")))
chunk()
script.Create()
script.StartMoving()
for _ = 1, 200 do
  for _, thread in ipairs(threads) do assert(coroutine.resume(thread)) end
end
local out = {}
for key in pairs(turned) do out[#out + 1] = key end
table.sort(out)
io.write(table.concat(out, "\\n"))
`;
  const result = spawnSync("luajit", ["-e", harness], { input: lua });
  if (result.status !== 0) {
    throw new Error(`luajit failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString().split("\n").filter(Boolean);
}

function fromPlan(
  plan: BodyPlan,
  proportions?: Record<string, number>,
): LegoProject {
  return projectFromPlan(plan, {
    id: "unit",
    rootPieceId: "root",
    name: plan.label,
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
    newId,
    ...(proportions ? { proportions } : {}),
  });
}

/** World rest positions of the plan's pieces, by bone id. */
function boneWorld(
  project: LegoProject,
): Map<string, [number, number, number]> {
  const byName = pieceWorldRest(project, bundledPack(), null);
  const out = new Map<string, [number, number, number]>();
  for (const piece of project.pieces) {
    const at = byName.get(piece.name);
    if (piece.bone && at) out.set(piece.bone, at);
  }
  return out;
}

describe.each([
  { plan: BIPED, pairs: [1], preset: "walk.biped" },
  { plan: QUADRUPED, pairs: [1, 2], preset: "walk.quad" },
])("the $plan.id plan", ({ plan, pairs, preset }) => {
  it("is in the registry", () => {
    expect(bodyPlanById(plan.id)).toBe(plan);
  });

  it("has each leg role of its walk once, and applies the walk at its defaults", () => {
    const roles = fromPlan(plan)
      .pieces.map((p) => p.role)
      .filter((role) => role?.startsWith("leg."));
    expect([...roles].sort()).toEqual(legRolesFor(pairs).sort());
    expect(plan.presets).toEqual([{ presetId: preset, params: {} }]);
  });

  it("gives the body role to the bone the legs hang from", () => {
    const project = fromPlan(plan);
    const body = project.pieces.filter((p) => p.role === "base");
    expect(body).toHaveLength(1);
    const thigh = project.pieces.find((p) => p.role === "leg.l1.thigh");
    expect(thigh?.parentId).toBe(body[0]?.id);
  });

  it.each<Record<string, number>>([
    {},
    { legLength: 6, stance: 40, bodyHeight: 0, bodyLength: 70 },
    { legLength: 40, stance: 10, bodyHeight: 25, bodyLength: 5 },
  ])("stands its feet on the ground at %o", (proportions) => {
    const project = fromPlan(plan, proportions);
    const values = planProportions(plan, proportions);
    const world = boneWorld(project);
    for (const role of legRolesFor(pairs).filter((r) => r.endsWith(".foot"))) {
      const bone = project.pieces.find((p) => p.role === role)?.bone as string;
      expect(Math.abs(world.get(bone)?.[1] ?? Number.NaN)).toBeLessThan(
        SAME_POSITION,
      );
    }
    const hip = project.pieces.find((p) => p.role === "leg.l1.thigh")
      ?.bone as string;
    expect(world.get(hip)?.[1]).toBeCloseTo(values.legLength as number, 9);
    // Nothing to measure, so sitting it on the ground leaves it alone.
    expect(sitOnGround(project, bundledPack(), null)).toBe(project);
  });

  it("puts the knee where the plan's fixed split says", () => {
    const world = boneWorld(fromPlan(plan, { legLength: 20 }));
    expect(world.get("shin.l1")?.[1]).toBeCloseTo(20 - 20 * 0.395, 9);
  });

  it("mirrors the right legs exactly onto the left", () => {
    const project = fromPlan(plan, { stance: 17 });
    const world = boneWorld(project);
    for (const pair of pairs) {
      for (const segment of ["thigh", "shin", "foot"]) {
        const left = world.get(`${segment}.l${pair}`);
        const right = world.get(`${segment}.r${pair}`);
        expect(right).toEqual([
          -(left?.[0] ?? Number.NaN),
          left?.[1],
          left?.[2],
        ]);
        const leftPiece = pieceForBone(project, `${segment}.l${pair}`);
        expect(leftPiece.twin).toBe(
          pieceForBone(project, `${segment}.r${pair}`).id,
        );
      }
    }
    expect(world.get("thigh.l1")?.[0]).toBe(8.5);
  });

  it("puts the rotation of every leg bone at its joint", () => {
    // A bone has no part, so its origin is the joint the engine turns it
    // about, and no pivot is set to move a part off it.
    for (const piece of fromPlan(plan).pieces) {
      expect(piece.pivot).toBeUndefined();
      expect(piece.rotation).toEqual([0, 0, 0]);
    }
  });

  it("walks in the generated script with no parts", () => {
    const project = fromPlan(plan);
    const lua = buildLuaScript(project);
    expect(
      missingPieces(
        lua,
        project.pieces.map((p) => p.name),
      ),
    ).toEqual([]);
    const legs = project.pieces.filter((p) => p.role?.startsWith("leg."));
    expect(turnedOnWalk(lua)).toEqual(legs.map((p) => `${p.name}:x`).sort());
  });

  it("is balanced once each foot bone is given a foot", () => {
    const pack = bundledPack();
    const top = pack.byId.get(FOOT_PART)?.bbox.max[1] ?? 0;
    const project = fromPlan(plan);
    const footed: LegoProject = {
      ...project,
      pieces: project.pieces.map((p) =>
        p.role?.endsWith(".foot")
          ? { ...p, partId: FOOT_PART, pivot: [0, top, 0] }
          : p.role === "base"
            ? { ...p, partId: HULL_PART }
            : p,
      ),
    };
    const result = checkBalance(sitOnGround(footed, pack, null), pack, null);
    expect(result.status).toBe("inside");
    if (result.status === "inside") {
      expect(result.resting).toHaveLength(pairs.length * 2);
    }
  });
});

describe("the legged plans' defaults", () => {
  // The medians of Splinter Faction's walkers, measured from their models.
  it("are Splinter Faction's", () => {
    expect(planProportions(BIPED)).toEqual({
      legLength: 18.8,
      stance: 29.8,
      bodyHeight: 5.4,
    });
    expect(planProportions(QUADRUPED)).toEqual({
      legLength: 18.8,
      stance: 29.8,
      bodyHeight: 5.4,
      bodyLength: 27.7,
    });
  });
});

describe("the four legged plan", () => {
  it("sets the front and rear hips apart by the body length", () => {
    const world = boneWorld(fromPlan(QUADRUPED, { bodyLength: 30 }));
    expect(world.get("thigh.l1")?.[2]).toBe(15);
    expect(world.get("thigh.l2")?.[2]).toBe(-15);
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
