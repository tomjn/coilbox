import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { type AnimPreset, presetById } from "./animPresets";
import { addBuildArm, BUILD_ARM_ID } from "./buildArm";
import {
  duplicatePiece,
  insertCompound,
  selectionAsCompound,
} from "./compounds";
import { buildLuaScript, presetCopies, roleInstances } from "./luaScript";
import {
  type LegoPiece,
  type LegoProject,
  newProject,
  parseLegoProjectData,
} from "./model";
import type { LegoPartInfo } from "./pack";
import { reparentPiece } from "./reparent";

/** Whether luajit compiles `lua`, as `luaScript.test.ts` checks it. */
function luaCompiles(lua: string): boolean {
  const result = spawnSync(
    "luajit",
    [
      "-e",
      "local src = io.read('*a'); local f, err = loadstring(src); " +
        "if not f then io.stderr:write(err); os.exit(1) end os.exit(0)",
    ],
    { input: lua },
  );
  return result.status === 0;
}

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
    now: "2026-10-17T00:00:00Z",
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

function moduleOf(source: LegoProject, pieceId: string, id: string) {
  return selectionAsCompound(source, [pieceId], {
    id,
    now: "2026-10-17T00:00:00Z",
    newId: counter(`${id}-`),
  }) as LegoProject;
}

/** The lines of one Lua function, from its header to its own `end`. */
function luaFunction(script: string, header: string): string[] {
  const lines = script.split("\n");
  const start = lines.indexOf(header);
  if (start < 0) return [];
  const end = lines.indexOf("end", start);
  return lines.slice(start, end + 1);
}

/** A hip with a pair of legs under it, walking. */
const LEGS = moduleOf(
  unit(
    [
      { id: "hip", name: "hip" },
      { id: "lt", name: "lthigh", parentId: "hip", role: "leg.l1.thigh" },
      { id: "ls", name: "lshin", parentId: "lt", role: "leg.l1.shin" },
      { id: "rt", name: "rthigh", parentId: "hip", role: "leg.r1.thigh" },
      { id: "rs", name: "rshin", parentId: "rt", role: "leg.r1.shin" },
    ],
    { animations: [{ presetId: "walk.biped", params: {} }] },
  ),
  "hip",
  "legs",
);

/** A build arm on its base, aiming while it builds and sweeping. */
const ARM = moduleOf(
  unit(
    [
      { id: "b", name: "armbase", role: "buildarm.base" },
      { id: "a", name: "arm", parentId: "b", role: "buildarm.arm" },
      { id: "n", name: "nozzle", parentId: "a", role: "buildarm.nozzle" },
    ],
    {
      animations: [
        { presetId: "build.aim", params: {} },
        { presetId: "buildarm", params: {} },
      ],
    },
  ),
  "b",
  "arm",
);

function twice(module: LegoProject): LegoProject {
  const once = insertCompound(unit([]), module, "root", counter("a"), true);
  return insertCompound(once.project, module, "root", counter("b"), true)
    .project;
}

describe("a module insert records its instance", () => {
  it("stamps every piece with the module id and one shared instance", () => {
    const result = insertCompound(unit([]), LEGS, "root", counter("n"), true);
    const added = result.project.pieces.filter((p) => p.id !== "root");
    expect(added).toHaveLength(5);
    const instances = new Set(added.map((p) => p.module?.instance));
    expect(instances.size).toBe(1);
    expect(added.every((p) => p.module?.id === "legs")).toBe(true);
  });

  it("gives a second insert of the same module an instance of its own", () => {
    const project = twice(LEGS);
    const instances = new Set(
      project.pieces.flatMap((p) => (p.module ? [p.module.instance] : [])),
    );
    expect(instances.size).toBe(2);
  });

  it("hands out the same piece ids as an insert that is not a module", () => {
    const asModule = insertCompound(unit([]), LEGS, "root", counter("n"), true);
    const asCopy = insertCompound(unit([]), LEGS, "root", counter("n"));
    expect(asModule.rootPieceIds).toEqual(asCopy.rootPieceIds);
  });

  it("leaves a piece that came from no module without one", () => {
    const result = insertCompound(unit([]), LEGS, "root", counter("n"));
    expect(result.project.pieces.some((p) => p.module)).toBe(false);
  });

  it("gives a generated build arm a fixed module id", () => {
    const parts = {
      base: part("block", "block"),
      arm: part("beam", "beam"),
      nozzle: part("block2", "block"),
    };
    const { project } = addBuildArm(unit([]), parts, {
      parentId: "root",
      factory: false,
      newId: counter("g"),
      now: "2026-10-17T00:00:00Z",
    });
    const added = project.pieces.filter((p) => p.id !== "root");
    expect(added.every((p) => p.module?.id === BUILD_ARM_ID)).toBe(true);
  });

  it("survives a save and a load", () => {
    const project = twice(LEGS);
    const parsed = parseLegoProjectData(JSON.parse(JSON.stringify(project)));
    expect(parsed?.pieces.map((p) => p.module)).toEqual(
      project.pieces.map((p) => p.module),
    );
  });

  it("drops a module that does not name both an id and an instance", () => {
    const project = unit([
      { id: "x", name: "x", module: { id: "m", instance: "" } },
    ]);
    const parsed = parseLegoProjectData(JSON.parse(JSON.stringify(project)));
    expect(parsed?.pieces.find((p) => p.id === "x")).not.toHaveProperty(
      "module",
    );
  });
});

describe("copies and moves", () => {
  const project = insertCompound(
    unit([]),
    LEGS,
    "root",
    counter("n"),
    true,
  ).project;
  const hip = project.pieces.find((p) => p.name === "hip") as LegoPiece;
  const thigh = project.pieces.find((p) => p.name === "lthigh") as LegoPiece;
  const instance = hip.module?.instance;

  it("makes a duplicated instance a second instance of the same module", () => {
    const copy = duplicatePiece(project, hip.id, {
      now: "2026-10-17T00:00:00Z",
      newId: counter("d"),
    });
    const copied = copy?.project.pieces.find((p) => p.id === copy.rootPieceId);
    expect(copied?.module?.id).toBe("legs");
    expect(copied?.module?.instance).not.toBe(instance);
  });

  it("keeps a copy inside the instance it was copied from in that instance", () => {
    const copy = duplicatePiece(project, thigh.id, {
      now: "2026-10-17T00:00:00Z",
      newId: counter("d"),
    });
    const copied = copy?.project.pieces.find((p) => p.id === copy.rootPieceId);
    expect(copied?.module?.instance).toBe(instance);
  });

  it("drops the instance from a piece moved out of it, and from what it carries", () => {
    const moved = reparentPiece(project, thigh.id, "root");
    const out = moved.pieces.filter((p) =>
      ["lthigh", "lshin"].includes(p.name),
    );
    expect(out.every((p) => !p.module)).toBe(true);
    expect(moved.pieces.find((p) => p.name === "rthigh")?.module).toEqual(
      hip.module,
    );
  });

  it("keeps the instance when its top piece moves, taking the rest along", () => {
    const withPost = unit([{ id: "post", name: "post" }]);
    const placed = insertCompound(withPost, LEGS, "root", counter("n"), true);
    const top = placed.rootPieceIds[0] as string;
    const moved = reparentPiece(placed.project, top, "post");
    expect(moved.pieces.find((p) => p.id === top)?.module?.instance).toBe(
      pieceInstance(placed.project, top),
    );
  });
});

function pieceInstance(project: LegoProject, id: string) {
  return project.pieces.find((p) => p.id === id)?.module?.instance;
}

describe("two of the same module in the script", () => {
  it("walks two leg modules as two threads, each turning only its own legs", () => {
    const project = twice(LEGS);
    const script = buildLuaScript(project);
    expect(luaCompiles(script)).toBe(true);

    const first = luaFunction(script, "local function walk()").join("\n");
    const second = luaFunction(script, "local function walk2()").join("\n");
    expect(first).toContain("SetSignalMask(SIG_WALK_BIPED)");
    expect(second).toContain("SetSignalMask(SIG_WALK_BIPED_2)");
    // The first insert keeps the module's names, the second is deduplicated.
    expect(first).toMatch(/Turn\(lthigh,/);
    expect(first).not.toMatch(/Turn\(lthigh\d/);
    expect(second).toMatch(/Turn\(lthigh\d+,/);
    expect(second).not.toMatch(/Turn\(lthigh,/);
    expect(script).toContain("local function walk2Stop()");

    expect(luaFunction(script, "function script.StartMoving()")).toEqual([
      "function script.StartMoving()",
      "  Signal(SIG_WALK_BIPED)",
      "  StartThread(walk)",
      "  Signal(SIG_WALK_BIPED_2)",
      "  StartThread(walk2)",
      "end",
    ]);
    expect(luaFunction(script, "function script.StopMoving()")).toEqual([
      "function script.StopMoving()",
      "  Signal(SIG_WALK_BIPED)",
      "  walkStop()",
      "  Signal(SIG_WALK_BIPED_2)",
      "  walk2Stop()",
      "end",
    ]);
    expect(script).toContain('local SIG_WALK_BIPED_2 = "SIG_WALK_BIPED_2"');
  });

  it("aims both build arms, setting both turning before waiting on either", () => {
    const project = twice(ARM);
    const names = project.pieces.map((p) => p.name);
    const [arm2, base2] = [
      names.find((n) => /^arm\d+$/.test(n)),
      names.find((n) => /^armbase\d+$/.test(n)),
    ];
    const script = buildLuaScript(project);
    expect(luaCompiles(script)).toBe(true);

    const start = luaFunction(
      script,
      "function script.StartBuilding(heading, pitch)",
    );
    expect(start.slice(1, 11)).toEqual([
      "  if heading then",
      "    Turn(armbase, y_axis, heading, 2.0944)",
      "    Turn(arm, x_axis, -pitch, 1.5708)",
      `    Turn(${base2}, y_axis, heading, 2.0944)`,
      `    Turn(${arm2}, x_axis, -pitch, 1.5708)`,
      "    WaitForTurn(armbase, y_axis)",
      "    WaitForTurn(arm, x_axis)",
      `    WaitForTurn(${base2}, y_axis)`,
      `    WaitForTurn(${arm2}, x_axis)`,
      "  end",
    ]);
    expect(start).toContain("  StartThread(buildArm)");
    expect(start).toContain("  StartThread(buildArm2)");
    const stop = luaFunction(script, "function script.StopBuilding()");
    expect(stop).toContain(`  Turn(${arm2}, x_axis, 0, 1.5708)`);
    expect(stop).toContain("  buildArm2Stop()");
    expect(
      luaFunction(script, "local function buildArm2()").join("\n"),
    ).toContain(`Turn(${arm2},`);
  });

  it("counts the copies for the Animation panel", () => {
    const project = twice(ARM);
    const preset = (id: string) => presetById(id) as AnimPreset;
    expect(presetCopies(project, preset("build.aim"))).toBe(2);
    expect(presetCopies(project, preset("buildarm"))).toBe(2);
    expect(presetCopies(twice(LEGS), preset("walk.biped"))).toBe(2);
    const one = insertCompound(unit([]), ARM, "root", counter("n"), true);
    expect(presetCopies(one.project, preset("build.aim"))).toBe(1);
  });

  it("orders instances by where their pieces first appear", () => {
    const project = twice(ARM);
    const groups = roleInstances(project.pieces, ["buildarm.arm"]);
    expect(groups.map((group) => group.map((p) => p.name))).toEqual([
      ["arm"],
      [project.pieces.find((p) => /^arm\d+$/.test(p.name))?.name],
    ]);
  });
});

describe("a unit with one instance or none", () => {
  const plain = unit(
    [
      { id: "lt", name: "lthigh", role: "leg.l1.thigh" },
      { id: "ls", name: "lshin", parentId: "lt", role: "leg.l1.shin" },
      { id: "rt", name: "rthigh", role: "leg.r1.thigh" },
      { id: "rs", name: "rshin", parentId: "rt", role: "leg.r1.shin" },
      { id: "b", name: "armbase", role: "buildarm.base" },
      { id: "a", name: "arm", parentId: "b", role: "buildarm.arm" },
      { id: "a2", name: "arm2", parentId: "b", role: "buildarm.arm" },
      { id: "d", name: "door", role: "door" },
    ],
    {
      animations: [
        { presetId: "walk.biped", params: {} },
        { presetId: "build.aim", params: {} },
        { presetId: "buildarm", params: {} },
        { presetId: "open.close", params: {} },
        { presetId: "idle.sway", params: {} },
      ],
    },
  );

  /** The fixture is this unit's script as main wrote it before #3302. */
  it("writes the script an old unit always had", () => {
    const before = readFileSync(
      join(__dirname, "fixtures/old-unit-script.lua"),
      "utf8",
    );
    expect(buildLuaScript(plain)).toBe(before);
  });

  it("writes the same script when every piece is in one instance", () => {
    const stamped = {
      ...plain,
      pieces: plain.pieces.map((p) =>
        p.id === "root" ? p : { ...p, module: { id: "m", instance: "i" } },
      ),
    };
    expect(buildLuaScript(stamped)).toBe(buildLuaScript(plain));
  });
});

function part(id: string, shape: string): LegoPartInfo {
  return {
    id,
    shape,
    name: id,
    packId: "lego",
    shapeId: id,
    category: "grey",
    colourway: "grey",
    material: "",
    tags: [],
    vFirst: 0,
    vCount: 0,
    iFirst: 0,
    iCount: 0,
    bbox: { min: [-0.5, -1, -0.5], max: [0.5, 1, 0.5] },
    uvBox: { min: [0, 0], max: [1, 1] },
    pivot: [0, 0, 0],
    sourceNames: [],
    aliasCount: 1,
  };
}
