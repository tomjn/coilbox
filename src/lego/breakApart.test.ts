import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { BREAK_APART, PRESETS } from "./animPresets";
import { breakGroups } from "./breakApart";
import { buildLuaScript } from "./luaScript";
import {
  type LegoConnection,
  type LegoPiece,
  type LegoProject,
  newProject,
} from "./model";

/** The flag values `LuaConstCOB.cpp` gives `SFX`, as the engine reads them. */
const SFX = {
  SHATTER: 1,
  EXPLODE_ON_HIT: 2,
  SMOKE: 8,
  FIRE: 16,
  NONE: 32,
  RECURSIVE: 16384,
};

const JOIN: LegoConnection = { connector: "a", to: "b" };

interface Spec {
  name: string;
  parent?: string;
  joined?: boolean;
}

/** A unit whose root is `base`, with pieces in the order given. */
function unit(
  pieces: Spec[],
  params: Record<string, number> = {},
  extra: LegoProject["animations"] = [],
): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "Breaker",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-18T00:00:00Z",
  });
  const made: LegoPiece[] = pieces.map((spec) => ({
    id: spec.name,
    name: spec.name,
    parentId: spec.parent ?? "root",
    partId: "x",
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...(spec.joined === false ? {} : { connection: JOIN }),
  }));
  return {
    ...base,
    pieces: [...base.pieces, ...made],
    animations: [...(extra ?? []), { presetId: BREAK_APART.id, params }],
  };
}

/** A turret with a dish and a barrel on it, an arm with a hand, an antenna and
 *  a light, all joined. The dish is not joined, so it travels with the turret. */
const ROBOT: Spec[] = [
  { name: "turret" },
  { name: "dish", parent: "turret", joined: false },
  { name: "barrel", parent: "turret" },
  { name: "arm" },
  { name: "hand", parent: "arm" },
  { name: "antenna" },
  { name: "lamp" },
];

/** Two branches only, so a light hit throws one whole. */
const TWO_BRANCHES: Spec[] = [
  { name: "arm" },
  { name: "hand", parent: "arm" },
  { name: "turret" },
  { name: "barrel", parent: "turret" },
];

/** Nothing joined: the piece tree is all there is. */
const TREE: Spec[] = [
  { name: "a", joined: false },
  { name: "b", parent: "a", joined: false },
  { name: "c", joined: false },
];

interface Death {
  /** Every call, in order, as `Explode name flags` or `Hide name`. */
  calls: string[];
  returned: number;
}

/**
 * Runs the unit's `Killed` under luajit with the engine calls recorded, as
 * the engine calls it: with the damage taken and the unit's health.
 */
function die(project: LegoProject, recentDamage: number): Death {
  const harness = `
x_axis, y_axis, z_axis = 1, 2, 3
SFX = ${luaTable(SFX)}
COB = {}
local calls = {}
function piece(name) return name end
function Explode(p, flags) calls[#calls + 1] = "Explode " .. p .. " " .. flags end
function Hide(p) calls[#calls + 1] = "Hide " .. p end
function Move() end
function Turn() end
function GetUnitValue() return 0 end
script = {}
local chunk = assert(loadstring(io.read("*a")))
chunk()
local returned = script.Killed(${recentDamage}, 100)
for _, line in ipairs(calls) do io.write(line .. "\\n") end
io.write("return " .. tostring(returned) .. "\\n")
`;
  const result = spawnSync("luajit", ["-e", harness], {
    input: buildLuaScript(project),
  });
  if (result.status !== 0) {
    throw new Error(`luajit failed: ${result.stderr.toString()}`);
  }
  const lines = result.stdout.toString().split("\n").filter(Boolean);
  const last = lines.pop() ?? "";
  return { calls: lines, returned: Number(last.replace("return ", "")) };
}

function luaTable(values: Record<string, number>): string {
  return `{ ${Object.entries(values)
    .map(([key, value]) => `${key} = ${value}`)
    .join(", ")} }`;
}

const explode = (name: string, flags: number) => `Explode ${name} ${flags}`;
const hide = (name: string) => `Hide ${name}`;

const SMOKE = SFX.SMOKE;
const SMOKE_FIRE = SFX.SMOKE + SFX.FIRE;
const ALL = SFX.SMOKE + SFX.FIRE + SFX.EXPLODE_ON_HIT;

describe("breakGroups", () => {
  it("cuts a joined unit where its branches leave the body, smallest first", () => {
    const groups = breakGroups(unit(ROBOT), 1);

    expect(groups).toEqual([
      { pieces: ["antenna"], whole: true },
      { pieces: ["lamp"], whole: true },
      { pieces: ["arm", "hand"], whole: true },
      { pieces: ["turret", "dish", "barrel"], whole: true },
    ]);
  });

  it("splits a branch at the joins inside it as the depth grows", () => {
    const groups = breakGroups(unit(ROBOT), 2);

    expect(groups).toEqual([
      { pieces: ["barrel"], whole: true },
      // The hand has left the arm, so the arm is not a whole branch either.
      { pieces: ["arm"], whole: false },
      { pieces: ["hand"], whole: true },
      { pieces: ["antenna"], whole: true },
      { pieces: ["lamp"], whole: true },
      // The dish has no join of its own, so it stays on the turret, and the
      // turret is no longer a whole branch because the barrel has left it.
      { pieces: ["turret", "dish"], whole: false },
    ]);
  });

  it("falls back to the piece tree for a unit with no joins", () => {
    expect(breakGroups(unit(TREE), 1)).toEqual([
      { pieces: ["c"], whole: true },
      { pieces: ["a", "b"], whole: true },
    ]);
    expect(breakGroups(unit(TREE), Number.POSITIVE_INFINITY)).toEqual([
      { pieces: ["a"], whole: false },
      { pieces: ["b"], whole: true },
      { pieces: ["c"], whole: true },
    ]);
  });

  it("has nothing to break in a unit that is only a root", () => {
    expect(breakGroups(unit([]), Number.POSITIVE_INFINITY)).toEqual([]);
  });
});

describe("Killed with Break apart", () => {
  it("throws the weakest few whole, with smoke, on a light hit", () => {
    expect(die(unit(ROBOT), 20)).toEqual({
      calls: [
        explode("antenna", SMOKE),
        hide("antenna"),
        explode("lamp", SMOKE),
        hide("lamp"),
        explode("base", SFX.NONE),
      ],
      returned: 1,
    });
  });

  it("throws one whole branch with SFX.RECURSIVE when that is the weakest", () => {
    expect(die(unit(TWO_BRANCHES), 20)).toEqual({
      calls: [
        explode("arm", SFX.RECURSIVE + SMOKE),
        hide("arm"),
        hide("hand"),
        explode("base", SFX.NONE),
      ],
      returned: 1,
    });
  });

  it("cuts finer and adds fire on a medium hit", () => {
    expect(die(unit(ROBOT), 40)).toEqual({
      calls: [
        explode("barrel", SMOKE_FIRE),
        hide("barrel"),
        explode("arm", SMOKE_FIRE),
        hide("arm"),
        explode("hand", SMOKE_FIRE),
        hide("hand"),
        explode("antenna", SMOKE_FIRE),
        hide("antenna"),
        explode("base", SFX.NONE),
      ],
      // The export writes one wreck and no heap, so a higher level would
      // leave none.
      returned: 1,
    });
  });

  it("throws every piece and shatters the root on a heavy hit", () => {
    expect(die(unit(ROBOT), 150)).toEqual({
      calls: [
        explode("barrel", ALL),
        hide("barrel"),
        explode("arm", ALL),
        hide("arm"),
        explode("hand", ALL),
        hide("hand"),
        explode("antenna", ALL),
        hide("antenna"),
        explode("lamp", ALL),
        hide("lamp"),
        explode("turret", ALL),
        explode("dish", ALL),
        hide("turret"),
        hide("dish"),
        explode("base", SFX.SHATTER),
      ],
      returned: 1,
    });
  });

  it("reads the thresholds as percentages of health, inclusive", () => {
    const light = die(unit(ROBOT), 25).calls;
    const medium = die(unit(ROBOT), 50).calls;
    const heavy = die(unit(ROBOT), 51).calls;

    expect(light.at(-1)).toBe(explode("base", SFX.NONE));
    expect(light[0]).toBe(explode("antenna", SMOKE));
    expect(medium[0]).toBe(explode("barrel", SMOKE_FIRE));
    expect(heavy.at(-1)).toBe(explode("base", SFX.SHATTER));
  });

  it("lets the game maker move the thresholds", () => {
    const moved = unit(ROBOT, { light: 60, medium: 80 });

    expect(die(moved, 55).calls[0]).toBe(explode("antenna", SMOKE));
    expect(die(moved, 75).calls[0]).toBe(explode("barrel", SMOKE_FIRE));
    expect(die(moved, 85).calls.at(-1)).toBe(explode("base", SFX.SHATTER));
  });

  it("throws less of the unit when the amount is lowered", () => {
    const heavy = (amount: number) =>
      die(unit(ROBOT, { amount }), 150).calls.filter((call) =>
        call.startsWith("Explode"),
      ).length;

    // Six groups, and the root. Half the amount throws half of the groups.
    expect(heavy(100)).toBe(7 + 1);
    expect(heavy(50)).toBe(3 + 1);
    // Some of it always breaks off.
    expect(heavy(10)).toBeGreaterThan(1);
  });

  it("breaks a unit with no joins along its piece tree", () => {
    expect(die(unit(TREE), 20)).toEqual({
      calls: [explode("c", SMOKE), hide("c"), explode("base", SFX.NONE)],
      returned: 1,
    });
  });

  it("only shatters the root of a unit that is nothing but a root", () => {
    expect(die(unit([]), 150)).toEqual({
      calls: [explode("base", SFX.SHATTER)],
      returned: 1,
    });
  });

  it("poses the wreck first when Wreck pose is applied too", () => {
    const body: Spec[] = [{ name: "hull" }];
    const lua = buildLuaScript({
      ...unit(body, {}, [{ presetId: "wreck.pose", params: {} }]),
      pieces: unit(body).pieces.map((piece) =>
        piece.name === "hull" ? { ...piece, role: "base" } : piece,
      ),
    });

    const killed = lua.slice(lua.indexOf("function script.Killed"));
    expect(killed.indexOf("Turn(hull")).toBeLessThan(
      killed.indexOf("local severity"),
    );
    // One explode of the root per grade and no second one after them.
    expect(killed.match(/return /g)).toHaveLength(3);
    expect(killed.trimEnd().endsWith("end")).toBe(true);
  });
});

describe("Killed without Break apart", () => {
  const without = (): LegoProject => ({
    ...unit(ROBOT),
    animations: [],
  });

  it("is the one explode and the one return it always was", () => {
    const lua = buildLuaScript(without());

    expect(lua).toContain(
      "function script.Killed(recentDamage, maxHealth)\n  Explode(base, SFX.SHATTER)\n  return 1\nend\n",
    );
    expect(lua).not.toContain("severity");
    expect(lua).not.toContain("Hide(");
  });

  it("does not declare the pieces it does not throw", () => {
    expect(buildLuaScript(without())).not.toContain('piece("turret")');
  });

  it("is applied from the preset list, not on by default", () => {
    expect(PRESETS).toContain(BREAK_APART);
    expect(BREAK_APART.requires).toEqual([]);
  });
});
