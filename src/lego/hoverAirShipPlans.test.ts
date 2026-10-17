import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { presetById, unmetRequirements } from "./animPresets";
import {
  BODY_PLANS,
  type BodyPlan,
  bodyPlanById,
  planProportions,
  projectFromPlan,
} from "./bodyPlans";
import { AIRCRAFT, HOVER, SHIP } from "./hoverAirShipPlans";
import { missingPieces } from "./luaPieces";
import { buildLuaScript } from "./luaScript";
import type { LegoPiece, LegoProject } from "./model";
import { type LegoPackManifest, type LoadedPack, mergePacks } from "./pack";
import { pieceWorldRest, unitBounds } from "./s3oBuild";
import { proportionHandles } from "./skeletonEdit";
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
 * `Create`, aims and fires weapon 1 when the script has one, and runs every
 * thread started for 50 sleeps. Returns each `Turn` and `Move` as
 * `call piece:axis`, sorted, and what `AimFromWeapon1` and `QueryWeapon1`
 * answer.
 */
function runScript(lua: string): {
  calls: string[];
  aimFrom: string;
  query: string;
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
if script.AimWeapon1 then
  script.AimWeapon1(0.5, 0.2)
  script.Shot1()
end
for _ = 1, 50 do
  for _, thread in ipairs(threads) do coroutine.resume(thread) end
end
local out = {}
for key in pairs(calls) do out[#out + 1] = key end
table.sort(out)
io.write(table.concat(out, ","), "\\n")
io.write(tostring(script.AimFromWeapon1 and (script.AimFromWeapon1())), "\\n")
io.write(tostring(script.QueryWeapon1 and (script.QueryWeapon1())), "\\n")
`;
  const result = spawnSync("luajit", ["-e", harness], { input: lua });
  if (result.status !== 0) {
    throw new Error(`luajit failed: ${result.stderr.toString()}`);
  }
  const [calls = "", aimFrom = "", query = ""] = result.stdout
    .toString()
    .split("\n");
  return { calls: calls.split(",").filter(Boolean), aimFrom, query };
}

describe.each([HOVER, SHIP, AIRCRAFT])("the $id plan", (plan) => {
  it("is in the registry", () => {
    expect(BODY_PLANS).toContain(plan);
    expect(bodyPlanById(plan.id)).toBe(plan);
  });

  it("puts its root at the origin", () => {
    const project = fromPlan(plan);
    const root = project.pieces.find((p) => p.id === project.rootPieceId);
    expect(root?.position).toEqual([0, 0, 0]);
  });

  it("gives exactly one bone the Body role", () => {
    const roles = fromPlan(plan).pieces.map((p) => p.role);
    expect(roles.filter((role) => role === "base")).toHaveLength(1);
  });

  it("puts the rotation of every bone at its joint", () => {
    for (const piece of fromPlan(plan).pieces) {
      expect(piece.pivot).toBeUndefined();
      expect(piece.rotation).toEqual([0, 0, 0]);
    }
  });

  it("can apply every preset it names, with no parts", () => {
    const project = fromPlan(plan);
    const counts = new Map<string, number>();
    for (const piece of project.pieces) {
      if (piece.role) counts.set(piece.role, (counts.get(piece.role) ?? 0) + 1);
    }
    for (const { presetId } of plan.presets) {
      const preset = presetById(presetId);
      expect(preset, presetId).toBeDefined();
      expect(
        unmetRequirements(preset as NonNullable<typeof preset>, counts),
      ).toEqual([]);
    }
  });

  it("has a handle on every proportion, named for it", () => {
    const handles = proportionHandles(fromPlan(plan), plan);
    expect(handles.map((h) => h.id)).toEqual(plan.proportions.map((p) => p.id));
  });

  it("sets no movement class, so export writes a static unit", () => {
    const project = fromPlan(plan);
    expect(project.movement).toBeUndefined();
    const def = legoUnitDef(
      project,
      unitBounds(project, bundledPack(), null),
      "def",
      null,
    );
    expect(def.canmove).toBe(false);
  });

  it("writes a script that names only its own pieces", () => {
    const project = fromPlan(plan);
    expect(
      missingPieces(
        buildLuaScript(project),
        project.pieces.map((p) => p.name),
      ),
    ).toEqual([]);
  });
});

describe("the hovercraft plan", () => {
  it("defaults to Beyond All Reason's hovercraft", () => {
    // The medians of 20 hovercraft, measured from their models.
    expect(planProportions(HOVER)).toEqual({
      hullLength: 40.2,
      hullWidth: 31.1,
      hullHeight: 14.9,
      gap: 0.1,
    });
  });

  it("applies Hover and bob, and gives the role to the hull alone", () => {
    expect(HOVER.presets).toEqual([{ presetId: "hover.bob", params: {} }]);
    const project = fromPlan(HOVER);
    expect(pieceForBone(project, "hull").role).toBe("base");
    expect(
      project.pieces.filter((p) => p.bone !== "hull").map((p) => p.role),
    ).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it.each<Record<string, number>>([
    {},
    { hullLength: 20, hullWidth: 15, hullHeight: 5, gap: 0 },
    { hullLength: 65, hullWidth: 60, hullHeight: 25, gap: 5 },
  ])("places the joints from the proportions at %o", (proportions) => {
    const { hullLength, hullWidth, hullHeight, gap } = planProportions(
      HOVER,
      proportions,
    ) as Record<string, number>;
    const world = boneWorld(fromPlan(HOVER, proportions));
    expect(world.get("base")).toEqual([0, 0, 0]);
    expect(world.get("hull")).toEqual([0, gap, 0]);
    expect(world.get("deck")?.[1]).toBeCloseTo(
      (gap as number) + (hullHeight as number),
      9,
    );
    expect(world.get("skirt.l")?.[0]).toBeCloseTo((hullWidth as number) / 2, 9);
    expect(world.get("skirt.r")?.[0]).toBeCloseTo(
      -(hullWidth as number) / 2,
      9,
    );
    // The stern is -z, behind the unit.
    expect(world.get("wake")?.[2]).toBeCloseTo(-(hullLength as number) / 2, 9);
  });

  it("pairs the skirts as symmetry twins", () => {
    const project = fromPlan(HOVER);
    const left = pieceForBone(project, "skirt.l");
    const right = pieceForBone(project, "skirt.r");
    expect(left.twin).toBe(right.id);
    expect(right.twin).toBe(left.id);
  });

  it("bobs and rocks the hull in the generated script, and has no weapon", () => {
    const project = fromPlan(HOVER);
    expect(runScript(buildLuaScript(project))).toEqual({
      calls: ["Move hull:y", "Turn hull:z"],
      aimFrom: "nil",
      query: "nil",
    });
  });
});

describe("the ship plan", () => {
  it("defaults to Splinter Faction's ships", () => {
    expect(planProportions(SHIP)).toEqual({
      hullLength: 89.2,
      deckHeight: 9.3,
      turretHeight: 5.8,
      barrelLength: 14.3,
    });
  });

  it("is a hull at the waterline with one gun turret, a wake and a rudder at the stern", () => {
    const project = fromPlan(SHIP);
    expect(project.pieces.map((p) => [p.bone, p.role])).toEqual([
      ["hull", "base"],
      ["turret", "turret"],
      ["barrel", "barrel"],
      ["flare", "flare"],
      ["wake", undefined],
      ["rudder", "rudder"],
    ]);
    expect(project.animations?.map((a) => a.presetId)).toContain(
      "rudder.follow",
    );
    expect(pieceForBone(project, "hull").id).toBe(project.rootPieceId);
  });

  it.each<Record<string, number>>([
    {},
    { hullLength: 45, deckHeight: 5, turretHeight: 0, barrelLength: 10 },
    { hullLength: 135, deckHeight: 15, turretHeight: 15, barrelLength: 35 },
  ])("places the joints from the proportions at %o", (proportions) => {
    const { hullLength, deckHeight, turretHeight, barrelLength } =
      planProportions(SHIP, proportions) as Record<string, number>;
    const world = boneWorld(fromPlan(SHIP, proportions));
    expect(world.get("turret")).toEqual([0, deckHeight, 0]);
    const trunnion = (deckHeight as number) + (turretHeight as number);
    expect(world.get("barrel")?.[1]).toBeCloseTo(trunnion, 9);
    expect(world.get("flare")?.[2]).toBeCloseTo(barrelLength as number, 9);
    expect(world.get("wake")).toEqual([0, 0, -(hullLength as number) / 2]);
    expect(world.get("rudder")).toEqual([0, 0, -(hullLength as number) / 2]);
  });

  it("aims and fires in the generated script with no parts, and does not rock", () => {
    const project = fromPlan(SHIP);
    expect(scriptWeapons(project)).toHaveLength(1);
    expect(runScript(buildLuaScript(project))).toEqual({
      calls: ["Move barrel:z", "Turn barrel:x", "Turn turret:y"],
      aimFrom: "turret",
      query: "flare",
    });
  });
});

describe("the aircraft plan", () => {
  it("defaults to Splinter Faction's aircraft that carry a gun", () => {
    expect(planProportions(AIRCRAFT)).toEqual({
      gunForward: 5.1,
      gunHeight: 1.9,
      barrelLength: 5.2,
    });
  });

  it("is a body with one gun, the barrel's joint on the turret's", () => {
    const project = fromPlan(AIRCRAFT);
    expect(project.pieces.map((p) => [p.bone, p.role])).toEqual([
      ["body", "base"],
      ["turret", "turret"],
      ["barrel", "barrel"],
      ["flare", "flare"],
    ]);
    expect(pieceForBone(project, "barrel").position).toEqual([0, 0, 0]);
  });

  it.each<Record<string, number>>([
    {},
    { gunForward: -20, gunHeight: -5, barrelLength: 0 },
    { gunForward: 20, gunHeight: 5, barrelLength: 10 },
  ])("places the gun from the proportions at %o", (proportions) => {
    const { gunForward, gunHeight, barrelLength } = planProportions(
      AIRCRAFT,
      proportions,
    ) as Record<string, number>;
    const world = boneWorld(fromPlan(AIRCRAFT, proportions));
    expect(world.get("turret")).toEqual([0, gunHeight, gunForward]);
    expect(world.get("barrel")).toEqual([0, gunHeight, gunForward]);
    expect(world.get("flare")?.[2]).toBeCloseTo(
      (gunForward as number) + (barrelLength as number),
      9,
    );
  });

  it("aims and fires in the generated script with no parts", () => {
    const project = fromPlan(AIRCRAFT);
    expect(runScript(buildLuaScript(project))).toEqual({
      calls: ["Move barrel:z", "Turn barrel:x", "Turn turret:y"],
      aimFrom: "turret",
      query: "flare",
    });
  });
});
