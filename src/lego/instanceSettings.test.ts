import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { type AppliedPreset, presetById } from "./animPresets";
import {
  duplicatePiece,
  insertCompound,
  selectionAsCompound,
} from "./compounds";
import {
  copyInstanceSettings,
  paramFor,
  pruneInstanceSettings,
  withInstanceParam,
  withoutInstanceSettings,
} from "./instanceSettings";
import {
  buildLuaScript,
  presetInstanceIds,
  roleInstanceGroups,
} from "./luaScript";
import {
  type LegoPiece,
  type LegoProject,
  newProject,
  parseLegoProjectData,
} from "./model";
import type { LegoPartInfo, LoadedPack } from "./pack";
import { soloProject } from "./soloPreset";
import { swapModule } from "./swapModule";

const NOW = "2026-10-17T00:00:00Z";

function unit(
  pieces: Partial<LegoPiece>[],
  extra: Partial<LegoProject> = {},
): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: NOW,
  });
  return {
    ...base,
    ...extra,
    pieces: [
      ...base.pieces,
      ...pieces.map((piece, i) => ({
        id: `piece${i}`,
        name: `piece${i}`,
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

function counter(prefix: string) {
  let n = 0;
  return () => `${prefix}${n++}`;
}

function armModule(animations: AppliedPreset[]): LegoProject {
  return selectionAsCompound(
    unit(
      [
        { id: "b", name: "armbase", role: "buildarm.base" },
        { id: "a", name: "arm", parentId: "b", role: "buildarm.arm" },
        { id: "n", name: "nozzle", parentId: "a", role: "buildarm.nozzle" },
      ],
      { animations },
    ),
    ["b"],
    { id: "arm", now: NOW, newId: counter("arm-") },
  ) as LegoProject;
}

const ARM = armModule([
  { presetId: "build.aim", params: {} },
  { presetId: "buildarm", params: {} },
]);

/** A unit holding the build arm module twice, as the instance ids a
 *  deterministic counter hands out. */
function twoArms(
  extra: Partial<LegoProject> = {},
  module: LegoProject = ARM,
): LegoProject {
  const once = insertCompound(
    unit([], extra),
    module,
    "root",
    counter("a"),
    true,
  );
  return insertCompound(once.project, module, "root", counter("b"), true)
    .project;
}

function instanceIds(project: LegoProject): string[] {
  return presetInstanceIds(project, presetById("build.aim") as never);
}

function withSettings(
  project: LegoProject,
  presetId: string,
  instance: string,
  params: Record<string, number>,
): LegoProject {
  return {
    ...project,
    animations: (project.animations ?? []).map((entry) =>
      entry.presetId === presetId
        ? { ...entry, instances: { ...entry.instances, [instance]: params } }
        : entry,
    ),
  };
}

/** Every `Turn` the script makes when a build starts, as `piece:speed`. */
function buildTurns(lua: string): Record<string, number> {
  const harness = `
local out = {}
x_axis, y_axis, z_axis = 1, 2, 3
function piece(...) return ... end
function Turn(p, axis, target, speed) if speed then out[p .. ":" .. axis] = speed end end
function Move() end
function Signal() end
function SetSignalMask() end
function Sleep() end
function StartThread() end
function SetUnitValue() end
function WaitForTurn() end
function Explode() end
COB = { INBUILDSTANCE = 1 }
SFX = { SHATTER = 1 }
script = {}
assert(loadstring(io.read("*a")))()
script.StartBuilding(0.5, 0.2)
local keys = {}
for k in pairs(out) do keys[#keys + 1] = k end
table.sort(keys)
for _, k in ipairs(keys) do io.write(k, "=", string.format("%.4f", out[k]), "\\n") end
`;
  const result = spawnSync("luajit", ["-e", harness], { input: lua });
  if (result.status !== 0) {
    throw new Error(`luajit failed: ${result.stderr.toString()}`);
  }
  return Object.fromEntries(
    result.stdout
      .toString()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [key, speed] = line.split("=");
        return [key, Number(speed)];
      }),
  );
}

describe("a script with no per-instance settings", () => {
  it("is byte identical to the script written before they existed", () => {
    const expected = readFileSync(
      join(__dirname, "fixtures", "twoBuildArms.lua"),
      "utf8",
    );
    expect(buildLuaScript(twoArms())).toBe(expected);
  });

  it("is unchanged by settings for an instance the unit does not have", () => {
    const project = twoArms();
    const stray = withSettings(project, "buildarm", "gone", { period: 9 });
    expect(buildLuaScript(stray)).toBe(buildLuaScript(project));
  });
});

describe("two instances of the build arm", () => {
  it("run at the same speed until one is given settings of its own", () => {
    const turns = buildTurns(buildLuaScript(twoArms()));
    // x_axis is 1 in the harness.
    expect(turns["arm:1"]).toBeGreaterThan(0);
    expect(turns["arm2:1"]).toBe(turns["arm:1"]);
  });

  it("run at different speeds when one has its own, under luajit", () => {
    const project = twoArms();
    const [, second] = instanceIds(project);
    const set = withSettings(project, "build.aim", second, {
      liftSpeed: 10,
      turnSpeed: 20,
    });
    const turns = buildTurns(buildLuaScript(set));
    // Piece "arm" is the first instance's, "arm2" the second's. x_axis is 1.
    expect(turns["arm:1"]).not.toBe(turns["arm2:1"]);
    expect(turns["arm2:1"]).toBeCloseTo((10 * Math.PI) / 180, 3);
    // y_axis is 2.
    expect(turns["armbase2:2"]).toBeCloseTo((20 * Math.PI) / 180, 3);
    // The first instance still has the shared speed.
    const shared = buildTurns(buildLuaScript(project));
    expect(turns["arm:1"]).toBe(shared["arm:1"]);
    expect(turns["armbase:2"]).toBe(shared["armbase:2"]);
  });

  it("sweep with a period of their own", () => {
    const project = twoArms();
    const [first] = instanceIds(project);
    const script = buildLuaScript(
      withSettings(project, "buildarm", first, { period: 8 }),
    );
    expect(script).not.toBe(buildLuaScript(project));
    expect(script).toContain("local function buildArm()");
    expect(script).toContain("local function buildArm2()");
  });
});

describe("the stored shape", () => {
  it("keeps only the params that differ from the shared ones", () => {
    const entry: AppliedPreset = {
      presetId: "buildarm",
      params: { period: 6 },
    };
    const own = withInstanceParam(entry, "i1", "period", 8);
    expect(own.instances).toEqual({ i1: { period: 8 } });
    // Back to the shared value, so nothing is left to store.
    const back = withInstanceParam(own, "i1", "period", 6);
    expect(back).toEqual(entry);
    expect(back).not.toHaveProperty("instances");
  });

  it("reads an instance's own value, then the shared one, then the default", () => {
    const entry: AppliedPreset = {
      presetId: "buildarm",
      params: { period: 6 },
      instances: { i1: { swing: 30 } },
    };
    expect(paramFor(entry, "i1", "swing")).toBe(30);
    expect(paramFor(entry, "i1", "period")).toBe(6);
    expect(paramFor(entry, null, "swing")).toBe(
      presetById("buildarm")?.params.find((p) => p.id === "swing")?.fallback,
    );
  });

  it("clears one instance's settings", () => {
    const entry: AppliedPreset = {
      presetId: "buildarm",
      params: {},
      instances: { i1: { period: 8 }, i2: { period: 9 } },
    };
    expect(withoutInstanceSettings(entry, "i1").instances).toEqual({
      i2: { period: 9 },
    });
    expect(
      withoutInstanceSettings(withoutInstanceSettings(entry, "i1"), "i2"),
    ).not.toHaveProperty("instances");
  });

  it("survives a save and a load, and a unit without it loads as before", () => {
    const project = twoArms();
    const [, second] = instanceIds(project);
    const set = withSettings(project, "buildarm", second, { period: 8 });
    const parsed = parseLegoProjectData(JSON.parse(JSON.stringify(set)));
    expect(parsed?.animations).toEqual(set.animations);
    const plain = parseLegoProjectData(JSON.parse(JSON.stringify(project)));
    expect(plain?.animations?.some((a) => "instances" in a)).toBe(false);
  });

  it("drops settings that are not numbers on load", () => {
    const project = twoArms();
    const raw = JSON.parse(JSON.stringify(project));
    raw.animations[0].instances = { x: { period: "fast" }, y: {} };
    const parsed = parseLegoProjectData(raw);
    expect(parsed?.animations?.[0]).not.toHaveProperty("instances");
  });
});

describe("removing an instance", () => {
  it("drops its entry and leaves the others", () => {
    const project = twoArms();
    const [first, second] = instanceIds(project);
    const set = withSettings(
      withSettings(project, "buildarm", first, { period: 8 }),
      "buildarm",
      second,
      { period: 9 },
    );
    const removed: LegoProject = {
      ...set,
      pieces: set.pieces.filter((p) => p.module?.instance !== second),
    };
    const pruned = pruneInstanceSettings(removed);
    expect(
      pruned.animations?.find((a) => a.presetId === "buildarm")?.instances,
    ).toEqual({ [first]: { period: 8 } });
  });

  it("returns the same object when there is nothing to drop", () => {
    const project = twoArms();
    expect(pruneInstanceSettings(project)).toBe(project);
    const [first] = instanceIds(project);
    const set = withSettings(project, "buildarm", first, { period: 8 });
    expect(pruneInstanceSettings(set)).toBe(set);
  });
});

describe("dropping a module into a unit that has its preset", () => {
  const tuned = armModule([
    { presetId: "buildarm", params: { period: 9, swing: 40 } },
  ]);

  it("gives the new instance the module's settings that the unit does not already have", () => {
    const first = insertCompound(
      unit([], {
        animations: [{ presetId: "buildarm", params: { swing: 40 } }],
      }),
      tuned,
      "root",
      counter("a"),
      true,
    );
    const entry = first.project.animations?.[0];
    const added = first.project.pieces.find((p) => p.module)?.module?.instance;
    // The unit already has the preset, so its shared settings stand and the
    // module's period goes to the new instance. Its swing equals the shared.
    expect(first.presets.present).toEqual(["buildarm"]);
    expect(entry?.params).toEqual({ swing: 40 });
    expect(entry?.instances).toEqual({ [added as string]: { period: 9 } });
  });

  it("adds nothing for a module that sets no param of its own", () => {
    const unset = armModule([{ presetId: "buildarm", params: {} }]);
    const result = insertCompound(
      unit([], {
        animations: [{ presetId: "buildarm", params: { period: 3 } }],
      }),
      unset,
      "root",
      counter("a"),
      true,
    );
    expect(result.project.animations?.[0]).not.toHaveProperty("instances");
  });

  it("makes the module's copy run on its own settings in the script", () => {
    const base = unit([], {
      animations: [{ presetId: "buildarm", params: { period: 4 } }],
    });
    const once = insertCompound(base, tuned, "root", counter("a"), true);
    const twice = insertCompound(
      once.project,
      armModule([{ presetId: "buildarm", params: { period: 4 } }]),
      "root",
      counter("b"),
      true,
    ).project;
    const script = buildLuaScript(twice);
    // Two build arms, so two threads, and the first has its own period.
    const alone = buildLuaScript({
      ...twice,
      animations: [{ presetId: "buildarm", params: { period: 4 } }],
    });
    expect(script).not.toBe(alone);
  });

  it("takes the module's settings as the shared ones when the unit lacks the preset", () => {
    const result = insertCompound(unit([]), tuned, "root", counter("a"), true);
    expect(result.project.animations?.[0]).toEqual({
      presetId: "buildarm",
      params: { period: 9, swing: 40 },
    });
  });
});

describe("copying an instance", () => {
  it("starts the copy with the settings of the instance it was copied from", () => {
    const once = insertCompound(
      unit([]),
      ARM,
      "root",
      counter("a"),
      true,
    ).project;
    const [only] = instanceIds(once);
    const set = withSettings(once, "buildarm", only, { period: 8 });
    const top = set.pieces.find((p) => p.name === "armbase") as LegoPiece;
    const copy = duplicatePiece(set, top.id, { now: NOW, newId: counter("d") });
    const ids = instanceIds(copy?.project as LegoProject);
    expect(ids).toHaveLength(2);
    const entry = copy?.project.animations?.find(
      (a) => a.presetId === "buildarm",
    );
    expect(entry?.instances?.[ids[0]]).toEqual({ period: 8 });
    expect(entry?.instances?.[ids[1]]).toEqual({ period: 8 });
  });

  it("copyInstanceSettings only copies for the presets it is asked to", () => {
    const project = twoArms();
    const [first, second] = instanceIds(project);
    const set = withSettings(
      withSettings(project, "buildarm", first, { period: 8 }),
      "build.aim",
      first,
      { liftSpeed: 5 },
    );
    const out = copyInstanceSettings(
      set,
      first,
      second,
      (id) => id === "buildarm",
    );
    const get = (id: string) =>
      out.animations?.find((a) => a.presetId === id)?.instances?.[second];
    expect(get("buildarm")).toEqual({ period: 8 });
    expect(get("build.aim")).toBeUndefined();
  });
});

type Vec3 = [number, number, number];

function part(id: string, min: Vec3, max: Vec3): LegoPartInfo {
  return {
    id,
    packId: "lego",
    shapeId: id,
    name: id,
    category: "grey",
    colourway: "grey",
    shape: "block",
    material: "metal",
    tags: [],
    vFirst: 0,
    vCount: 0,
    iFirst: 0,
    iCount: 0,
    bbox: { min, max },
    uvBox: { min: [0, 0], max: [1, 1] },
    pivot: [0, 0, 0],
    sourceNames: [],
    aliasCount: 0,
  };
}

function pack(): LoadedPack {
  const parts = [
    part("hull", [-1, -0.5, -2], [1, 0.5, 2]),
    part("leg", [-0.25, -1, -0.25], [0.25, 1, 0.25]),
  ];
  return {
    manifest: {} as LoadedPack["manifest"],
    library: { packs: [], atlases: [], dir: "", problems: [] },
    parts,
    byId: new Map(parts.map((p) => [p.id, p])),
    vertices: new Float32Array(),
    indices: new Uint16Array(),
  } as LoadedPack;
}

describe("swapping or updating a module", () => {
  function replacement(animations: AppliedPreset[]): LegoProject {
    const base = unit([]);
    const pieces: LegoPiece[] = [
      {
        id: "base",
        name: "stand",
        parentId: null,
        partId: "leg",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        role: "buildarm.base",
      },
      {
        id: "arm",
        name: "arm",
        parentId: "base",
        partId: "leg",
        position: [0, 1.5, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        role: "buildarm.arm",
      },
    ];
    return {
      ...base,
      id: "other",
      name: "other",
      rootPieceId: "base",
      pieces,
      mount: { piece: "base", connector: "-y" },
      animations,
    };
  }

  function start(): { project: LegoProject; top: LegoPiece; old: string } {
    const hull: Partial<LegoPiece> = {
      id: "hull",
      name: "hull",
      partId: "hull",
    };
    const project = insertCompound(
      unit([hull]),
      ARM,
      "hull",
      counter("a"),
      true,
    ).project;
    const [old] = instanceIds(project);
    const set = withSettings(project, "buildarm", old, { period: 8 });
    const top = set.pieces.find((p) => p.name === "armbase") as LegoPiece;
    return { project: set, top, old };
  }

  it("keeps the instance's settings when the new module has the same preset", () => {
    const { project, top, old } = start();
    const out = swapModule(
      project,
      pack(),
      top.id,
      replacement([{ presetId: "buildarm", params: {} }]),
      counter("b"),
    );
    const entry = out?.project.animations?.find(
      (a) => a.presetId === "buildarm",
    );
    const [now] = presetInstanceIds(
      out?.project as LegoProject,
      presetById("buildarm") as never,
    );
    expect(now).not.toBe(old);
    expect(entry?.instances).toEqual({ [now]: { period: 8 } });
  });

  it("drops them when the new module does not have the preset", () => {
    const { project, top } = start();
    const out = swapModule(
      project,
      pack(),
      top.id,
      replacement([{ presetId: "build.aim", params: {} }]),
      counter("b"),
    );
    const entry = out?.project.animations?.find(
      (a) => a.presetId === "buildarm",
    );
    expect(entry?.instances).toBeUndefined();
    expect(JSON.stringify(out?.project.animations)).not.toContain('"period":8');
  });
});

describe("playing one instance on its own", () => {
  it("keeps every instance when none is picked", () => {
    const project = twoArms();
    const solo = soloProject(project, "buildarm");
    expect(solo.pieces).toBe(project.pieces);
    expect(buildLuaScript(solo)).toContain("buildArm2");
  });

  it("writes only the picked instance's thread", () => {
    const project = twoArms();
    const [, second] = instanceIds(project);
    const solo = soloProject(project, "buildarm", second);
    const script = buildLuaScript(solo);
    expect(script).toContain("local function buildArm()");
    expect(script).not.toContain("buildArm2");
    // The unit itself is untouched.
    expect(project.pieces.filter((p) => p.role).length).toBe(6);
    expect(roleInstanceGroups(project.pieces, ["buildarm.arm"])).toHaveLength(
      2,
    );
  });

  it("plays the picked instance with its own settings", () => {
    const project = twoArms();
    const [, second] = instanceIds(project);
    const set = withSettings(project, "buildarm", second, { period: 8 });
    const shared = buildLuaScript(soloProject(project, "buildarm", second));
    const own = buildLuaScript(soloProject(set, "buildarm", second));
    expect(own).not.toBe(shared);
  });
});
