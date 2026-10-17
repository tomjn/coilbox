import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
  type BodyPlan,
  bodyPlanById,
  planProportions,
  projectFromPlan,
} from "./bodyPlans";
import { BUILDING, TURRET_BUILDING } from "./buildingPlans";
import { checkFootprint, footprintProblems } from "./footprint";
import { missingPieces } from "./luaPieces";
import { buildLuaScript } from "./luaScript";
import type { LegoPiece, LegoProject } from "./model";
import { type LegoPackManifest, type LoadedPack, mergePacks } from "./pack";
import { pieceWorldRest, sitOnGround, unitBounds } from "./s3oBuild";
import { legoUnitDef } from "./unitDef";
import { scriptWeapons } from "./weaponModule";

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

let counter = 0;
function newId(): string {
  counter += 1;
  return `id${counter}`;
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

function pieceForBone(project: LegoProject, bone: string): LegoPiece {
  const piece = project.pieces.find((p) => p.bone === bone);
  if (!piece) throw new Error(`no piece for ${bone}`);
  return piece;
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

/**
 * Runs a unit script under luajit with the engine calls stubbed. Calls
 * `Create`, then aims and fires weapon 1 the way the engine does, and runs
 * every thread started to its end. Returns each `Turn` and `Move` as
 * `call piece:axis`, sorted, and what `AimFromWeapon1` and `QueryWeapon1`
 * answer.
 */
function aimAndFire(lua: string): {
  calls: string[];
  aimFrom: string;
  query: string;
  aimed: string;
  weapon2: boolean;
} {
  const harness = `
local calls = {}
x_axis, y_axis, z_axis = 1, 2, 3
local axes = { "x", "y", "z" }
local threads = {}
function piece(...) return ... end
function Turn(p, axis) calls["Turn " .. p .. ":" .. axes[axis]] = true end
function Move(p, axis) calls["Move " .. p .. ":" .. axes[axis]] = true end
function Spin(p, axis) calls["Spin " .. p .. ":" .. axes[axis]] = true end
function StopSpin() end
function Signal() end
function SetSignalMask() end
function Explode() end
function WaitForTurn() end
function WaitForMove() end
function Sleep() coroutine.yield() end
function StartThread(f, ...) threads[#threads + 1] = coroutine.create(f) end
function SetUnitValue() end
COB = { INBUILDSTANCE = 1 }
SFX = { SHATTER = 1 }
script = {}
local chunk = assert(loadstring(io.read("*a")))
chunk()
script.Create()
local aimed = script.AimWeapon1(0.5, 0.2)
script.Shot1()
for _ = 1, 50 do
  for _, thread in ipairs(threads) do coroutine.resume(thread) end
end
local out = {}
for key in pairs(calls) do out[#out + 1] = key end
table.sort(out)
io.write(table.concat(out, ","), "\\n")
io.write(tostring((script.AimFromWeapon1())), "\\n")
io.write(tostring((script.QueryWeapon1())), "\\n")
io.write(tostring(aimed), "\\n")
io.write(tostring(script.AimWeapon2 ~= nil), "\\n")
`;
  const result = spawnSync("luajit", ["-e", harness], { input: lua });
  if (result.status !== 0) {
    throw new Error(`luajit failed: ${result.stderr.toString()}`);
  }
  const [calls = "", aimFrom = "", query = "", aimed = "", weapon2 = ""] =
    result.stdout.toString().split("\n");
  return {
    calls: calls.split(",").filter(Boolean),
    aimFrom,
    query,
    aimed,
    weapon2: weapon2 === "true",
  };
}

describe.each([TURRET_BUILDING, BUILDING])("the $id plan", (plan) => {
  it("is in the registry", () => {
    expect(bodyPlanById(plan.id)).toBe(plan);
  });

  it("puts its root on the ground and gives it the body role", () => {
    const project = fromPlan(plan);
    const root = pieceForBone(project, "base");
    expect(root.id).toBe(project.rootPieceId);
    expect(root.position).toEqual([0, 0, 0]);
    expect(root.role).toBe("base");
    // Nothing to measure, so sitting it on the ground leaves it alone.
    expect(sitOnGround(project, bundledPack(), null)).toBe(project);
  });

  it("does not move: export writes a static unit", () => {
    const project = fromPlan(plan);
    expect(project.movement).toBeUndefined();
    const bounds = unitBounds(project, bundledPack(), null);
    const def = legoUnitDef(project, bounds, "def", null);
    expect(def.canmove).toBe(false);
    expect(def.movementclass).toBeUndefined();
  });

  it("passes the footprint check at its defaults, with a 1 by 1 footprint", () => {
    const project = fromPlan(plan);
    const pack = bundledPack();
    const result = checkFootprint(project, pack, null, true);
    // Bones have no geometry, so there is nothing to stick out of a footprint.
    expect(result.status).toBe("notApplicable");
    expect(footprintProblems(result)).toEqual([]);
    const def = legoUnitDef(
      project,
      unitBounds(project, pack, null),
      "def",
      null,
    );
    expect([def.footprintx, def.footprintz]).toEqual([1, 1]);
  });

  it("puts the rotation of every bone at its joint", () => {
    for (const piece of fromPlan(plan).pieces) {
      expect(piece.pivot).toBeUndefined();
      expect(piece.rotation).toEqual([0, 0, 0]);
    }
  });
});

describe("the turret building plan", () => {
  it("has a turret, a barrel and a flare, one of each, and no aim point", () => {
    const roles = fromPlan(TURRET_BUILDING).pieces.map((p) => p.role);
    expect(roles).toEqual(["base", "turret", "barrel", "flare"]);
  });

  it("applies turret sweep and recoil at their defaults", () => {
    expect(TURRET_BUILDING.presets).toEqual([
      { presetId: "turret.track", params: {} },
      { presetId: "recoil", params: {} },
    ]);
  });

  it("defaults to Splinter Faction's static defences", () => {
    // The medians of 13 defences, measured from their models.
    expect(planProportions(TURRET_BUILDING)).toEqual({
      baseHeight: 41,
      turretHeight: 13.7,
      barrelLength: 41.1,
    });
  });

  it("hangs the barrel off the turret and the flare off the barrel", () => {
    const project = fromPlan(TURRET_BUILDING);
    const turret = pieceForBone(project, "turret");
    const barrel = pieceForBone(project, "barrel");
    expect(turret.parentId).toBe(project.rootPieceId);
    expect(barrel.parentId).toBe(turret.id);
    expect(pieceForBone(project, "flare").parentId).toBe(barrel.id);
  });

  it.each<Record<string, number>>([
    {},
    { baseHeight: 20, turretHeight: 0, barrelLength: 5 },
    { baseHeight: 225, turretHeight: 45, barrelLength: 160 },
  ])("places the joints from the proportions at %o", (proportions) => {
    const { baseHeight, turretHeight, barrelLength } = planProportions(
      TURRET_BUILDING,
      proportions,
    ) as Record<string, number>;
    const world = boneWorld(fromPlan(TURRET_BUILDING, proportions));
    expect(world.get("base")).toEqual([0, 0, 0]);
    expect(world.get("turret")).toEqual([0, baseHeight, 0]);
    const trunnion = (baseHeight as number) + (turretHeight as number);
    expect(world.get("barrel")?.[1]).toBeCloseTo(trunnion, 9);
    // Forward is +z, where the engine points a unit and a barrel at rest.
    expect(world.get("flare")?.[1]).toBeCloseTo(trunnion, 9);
    expect(world.get("flare")?.[2]).toBe(barrelLength);
  });

  it("is one weapon, with the turret, the barrel and the flare its own", () => {
    const project = fromPlan(TURRET_BUILDING);
    const weapons = scriptWeapons(project);
    expect(weapons).toHaveLength(1);
    expect(weapons[0]?.carrier?.bone).toBe("turret");
    expect(weapons[0]?.barrel?.bone).toBe("barrel");
    expect(weapons[0]?.flare?.bone).toBe("flare");
  });

  it("aims and fires in the generated script with no parts", () => {
    const project = fromPlan(TURRET_BUILDING);
    const lua = buildLuaScript(project);
    expect(
      missingPieces(
        lua,
        project.pieces.map((p) => p.name),
      ),
    ).toEqual([]);
    expect(aimAndFire(lua)).toEqual({
      calls: ["Move barrel:z", "Turn barrel:x", "Turn turret:y"],
      aimFrom: "turret",
      query: "flare",
      aimed: "true",
      weapon2: false,
    });
  });
});

describe("the plain building plan", () => {
  it("is a base with no proportions and nothing to animate", () => {
    const project = fromPlan(BUILDING);
    expect(project.pieces.map((p) => p.bone)).toEqual(["base"]);
    expect(BUILDING.proportions).toEqual([]);
    expect(BUILDING.presets).toEqual([]);
    expect(project.animations).toBeUndefined();
    expect(project.skeleton).toEqual({ plan: "building", proportions: {} });
  });

  it("writes a script that moves nothing", () => {
    const lua = buildLuaScript(fromPlan(BUILDING));
    expect(aimAndFire(lua)).toEqual({
      calls: [],
      aimFrom: "nil",
      query: "nil",
      aimed: "true",
      weapon2: false,
    });
  });
});
