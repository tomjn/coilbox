import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { presetById } from "./animPresets";
import { checkBalance } from "./balance";
import {
  BODY_PLANS,
  type BodyPlan,
  bodyPlanById,
  bonesLostWithParts,
  planProportions,
  projectFromPlan,
  releaseSkeleton,
} from "./bodyPlans";
import { missingPieces } from "./luaPieces";
import { buildLuaScript } from "./luaScript";
import { type LegoPiece, type LegoProject, pieceById } from "./model";
import { type LegoPackManifest, type LoadedPack, mergePacks } from "./pack";
import { pieceWorldRest, sitOnGround } from "./s3oBuild";
import { TRACKED, WHEELED } from "./vehiclePlans";

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

/** The starter Wheel module's part: 2 across and turning about x. */
const WHEEL_PART = "2c9119b8312f";
/** The starter chassis hull's part. */
const HULL_PART = "d2c111537495";

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

function wheels(project: LegoProject): LegoPiece[] {
  return project.pieces.filter((p) => p.role === "wheel");
}

/**
 * Runs a unit script under luajit with the engine calls stubbed, calls
 * `Create` and then `StartMoving`, and returns each `piece:axis` that `Spin`
 * was called on.
 */
function spunOnStartMoving(lua: string): string[] {
  const harness = `
local spun = {}
x_axis, y_axis, z_axis = 1, 2, 3
local axes = { "x", "y", "z" }
local moving = false
function piece(...) return ... end
function Spin(p, axis) if moving then spun[p .. ":" .. axes[axis]] = true end end
function StopSpin() end
function Turn() end
function Move() end
function Signal() end
function SetSignalMask() end
function Explode() end
function WaitForTurn() end
function WaitForMove() end
function Sleep() end
function StartThread() end
SFX = { SHATTER = 1 }
script = {}
local chunk = assert(loadstring(io.read("*a")))
chunk()
if script.Create then script.Create() end
moving = true
script.StartMoving()
local out = {}
for key in pairs(spun) do out[#out + 1] = key end
table.sort(out)
io.write(table.concat(out, "\\n"))
`;
  const result = spawnSync("luajit", ["-e", harness], { input: lua });
  if (result.status !== 0) {
    throw new Error(`luajit failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString().split("\n").filter(Boolean);
}

/**
 * The plan's unit with a wheel part on every wheel bone, scaled so it is as
 * high as the bone, and a hull on the body. Nothing is moved.
 */
function withParts(project: LegoProject): LegoProject {
  const world = boneWorld(project);
  return {
    ...project,
    pieces: project.pieces.map((p) => {
      if (p.role === "wheel") {
        const radius = world.get(p.bone as string)?.[1] ?? 0;
        return { ...p, partId: WHEEL_PART, scale: [radius, radius, radius] };
      }
      return p.role === "base" ? { ...p, partId: HULL_PART } : p;
    }),
  };
}

describe.each([
  { plan: WHEELED, count: (v: Record<string, number>) => 2 * v.axles },
  { plan: TRACKED, count: (v: Record<string, number>) => 2 * v.roadWheels },
])("the $plan.id plan", ({ plan, count }) => {
  it("is in the registry", () => {
    expect(BODY_PLANS).toContain(plan);
    expect(bodyPlanById(plan.id)).toBe(plan);
  });

  it("applies Wheels turning at its defaults", () => {
    expect(plan.presets).toEqual([{ presetId: "wheels.roll", params: {} }]);
  });

  it("has one body, and a wheel bone for each wheel", () => {
    const project = fromPlan(plan);
    expect(project.pieces.filter((p) => p.role === "base")).toHaveLength(1);
    expect(wheels(project)).toHaveLength(count(planProportions(plan)));
  });

  it("turns every wheel about x with no parts", () => {
    const project = fromPlan(plan);
    const lua = buildLuaScript(project);
    expect(
      missingPieces(
        lua,
        project.pieces.map((p) => p.name),
      ),
    ).toEqual([]);
    expect(spunOnStartMoving(lua)).toEqual(
      wheels(project)
        .map((p) => `${p.name}:x`)
        .sort(),
    );
    // The preview's own motion for a wheel, which the generated Lua is held
    // to by presetParity.test.ts.
    const preset = presetById("wheels.roll");
    expect(preset?.track(0.25, {}, "wheel")?.rotation?.[0]).toBeGreaterThan(0);
  });

  it("sits every wheel on its axle, unturned, so it turns about its centre", () => {
    for (const piece of fromPlan(plan).pieces) {
      expect(piece.pivot).toBeUndefined();
      expect(piece.rotation).toEqual([0, 0, 0]);
      expect(piece.scale).toEqual([1, 1, 1]);
    }
  });

  it("mirrors every right bone exactly onto its left twin", () => {
    const project = fromPlan(plan, { trackWidth: 17 });
    const world = boneWorld(project);
    const lefts = project.pieces.filter((p) => /\.l\d*$/.test(p.bone ?? ""));
    expect(lefts.length).toBeGreaterThan(0);
    for (const left of lefts) {
      const right = project.pieces.find((p) => p.id === left.twin);
      expect(right?.twin).toBe(left.id);
      const l = world.get(left.bone as string);
      const r = world.get(right?.bone as string);
      expect(r).toEqual([-(l?.[0] ?? Number.NaN), l?.[1], l?.[2]]);
      expect(l?.[0]).toBeGreaterThan(0);
    }
  });

  it.each<"min" | "max" | "fallback">([
    "min",
    "max",
    "fallback",
  ])("stands on the ground and balances at every %s", (end) => {
    const proportions = Object.fromEntries(
      plan.proportions.map((p) => [p.id, p[end]]),
    );
    const pack = bundledPack();
    const project = withParts(fromPlan(plan, proportions));
    // Already resting on y = 0, so there is nothing to drop.
    expect(sitOnGround(project, pack, null)).toBe(project);
    const result = checkBalance(project, pack, null);
    expect(result.status).toBe("inside");
    if (result.status === "inside") {
      expect([...result.resting].sort()).toEqual(
        project.pieces
          .filter((p) => p.role === "wheel" || p.role === "track")
          .map((p) => p.id)
          .sort(),
      );
    }
  });
});

describe("the wheeled plan", () => {
  it("defaults to the median two axle Splinter Faction vehicle", () => {
    expect(planProportions(WHEELED)).toEqual({
      axles: 2,
      axleSpacing: 19.6,
      trackWidth: 28,
      wheelHeight: 4.7,
    });
  });

  it("places each axle's pair from the proportions, front first", () => {
    const world = boneWorld(
      fromPlan(WHEELED, {
        axles: 3,
        axleSpacing: 10,
        trackWidth: 20,
        wheelHeight: 4,
      }),
    );
    expect(world.get("wheel.l1")).toEqual([10, 4, 10]);
    expect(world.get("wheel.r1")).toEqual([-10, 4, 10]);
    expect(world.get("wheel.l2")).toEqual([10, 4, 0]);
    expect(world.get("wheel.l3")).toEqual([10, 4, -10]);
    expect(world.get("body")).toEqual([0, 4, 0]);
    expect(world.get("base")).toEqual([0, 0, 0]);
  });

  it("adds or removes a pair of wheel bones for each axle", () => {
    for (const axles of [2, 3, 5]) {
      const project = fromPlan(WHEELED, { axles });
      expect(wheels(project)).toHaveLength(2 * axles);
      expect(project.pieces).toHaveLength(2 + 2 * axles);
      expect(pieceForBone(project, `wheel.r${axles}`).name).toBe(
        `rwheel${axles}`,
      );
    }
  });

  it("holds the axle count to a whole number in range", () => {
    expect(planProportions(WHEELED, { axles: 2.6 }).axles).toBe(3);
    expect(planProportions(WHEELED, { axles: 9 }).axles).toBe(5);
    expect(planProportions(WHEELED, { axles: 0 }).axles).toBe(2);
  });
});

describe("the tracked plan", () => {
  it("defaults to the median Spring 1944 tank", () => {
    expect(planProportions(TRACKED)).toEqual({
      trackLength: 47.4,
      trackWidth: 18.3,
      trackHeight: 8.8,
      roadWheels: 6,
    });
  });

  it("hangs each side's road wheels off a track bone with the track role", () => {
    const project = fromPlan(TRACKED);
    for (const side of ["l", "r"]) {
      const track = pieceForBone(project, `track.${side}`);
      expect(track.role).toBe("track");
      expect(track.twin).toBe(
        pieceForBone(project, `track.${side === "l" ? "r" : "l"}`).id,
      );
      expect(track.name).toBe(`${side}track`);
      const run = wheels(project).filter((p) => p.parentId === track.id);
      expect(run).toHaveLength(6);
    }
  });

  it("spreads the road wheels evenly along the track at the measured height", () => {
    const world = boneWorld(
      fromPlan(TRACKED, {
        trackLength: 40,
        trackWidth: 20,
        trackHeight: 10,
        roadWheels: 3,
      }),
    );
    expect(world.get("track.l")).toEqual([10, 5, 0]);
    const span = 40 * 0.65;
    const zs = [1, 2, 3].map(
      (i) => world.get(`wheel.l${i}`)?.[2] ?? Number.NaN,
    );
    expect(zs[0]).toBeCloseTo(span / 2, 9);
    expect(zs[1]).toBeCloseTo(0, 9);
    expect(zs[2]).toBeCloseTo(-span / 2, 9);
    expect(world.get("wheel.l2")?.[1]).toBeCloseTo(10 * 0.34, 9);
    expect(world.get("wheel.l2")?.[0]).toBe(10);
  });

  it("holds the road wheel count to a whole number in range", () => {
    expect(planProportions(TRACKED, { roadWheels: 4.4 }).roadWheels).toBe(4);
    expect(planProportions(TRACKED, { roadWheels: 20 }).roadWheels).toBe(11);
  });
});

describe("bonesLostWithParts", () => {
  it("names a wheel that carries a part when its axle goes, and not a bare one", () => {
    const project = fromPlan(WHEELED, { axles: 3 });
    const left = pieceForBone(project, "wheel.l3");
    const dressed: LegoProject = {
      ...project,
      pieces: project.pieces.map((p) =>
        p.id === left.id ? { ...p, partId: WHEEL_PART } : p,
      ),
    };
    expect(
      bonesLostWithParts(dressed, WHEELED, { axles: 2 }).map((p) => p.bone),
    ).toEqual(["wheel.l3"]);
    expect(bonesLostWithParts(dressed, WHEELED, { axles: 3 })).toEqual([]);
  });

  it("names a bone that has a piece hung on it", () => {
    const project = fromPlan(WHEELED, { axles: 3 });
    const right = pieceForBone(project, "wheel.r3");
    const hub: LegoPiece = {
      id: "hub",
      name: "hub",
      parentId: right.id,
      partId: null,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    };
    const hung = { ...project, pieces: [...project.pieces, hub] };
    const lost = bonesLostWithParts(hung, WHEELED, { axles: 2 });
    expect(lost.map((p) => p.bone)).toEqual(["wheel.r3"]);
    expect(pieceById(hung, "hub")).toBeDefined();
  });

  it("names nothing once the skeleton is let go", () => {
    const project = fromPlan(WHEELED, { axles: 3 });
    const released = releaseSkeleton({
      ...project,
      pieces: project.pieces.map((p) => ({ ...p, partId: WHEEL_PART })),
    });
    expect(bonesLostWithParts(released, WHEELED, { axles: 2 })).toEqual([]);
  });
});
