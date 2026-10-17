import { describe, expect, it } from "vitest";
import type { CompiledMod } from "@/workshop/compile";
import { EMPTY_EDITS, type ModProject } from "@/workshop/project";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import type { LegoPartInfo } from "./pack";
import {
  addWeaponModule,
  arcFields,
  buildWeaponModule,
  exportWeapons,
  mountedWeapons,
  pickedWeapon,
  pickWeaponFile,
  pickWeaponParts,
  sameWeapon,
  scriptWeapons,
  slotTarget,
  weaponCarriers,
  weaponExportPlan,
  weaponFileName,
  weaponFileProject,
  weaponOptions,
  weaponSummary,
} from "./weaponModule";

function part(
  id: string,
  shape: string,
  size: [number, number, number],
): LegoPartInfo {
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
    bbox: {
      min: [-size[0] / 2, -size[1] / 2, -size[2] / 2],
      max: [size[0] / 2, size[1] / 2, size[2] / 2],
    },
    uvBox: { min: [0, 0], max: [1, 1] },
    pivot: [0, 0, 0],
    sourceNames: [],
    aliasCount: 1,
  };
}

const PARTS = [
  part("big-block", "block", [2, 2, 2]),
  part("small-block", "block", [1, 0.5, 1]),
  part("long-beam", "beam", [0.5, 6, 0.5]),
  part("mid-beam", "beam", [0.5, 2, 0.5]),
  part("short-beam", "beam", [0.5, 1, 0.5]),
];

function unit(pieces: Partial<LegoPiece>[] = []): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "Rover",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  return {
    ...base,
    unitName: "rover",
    pieces: [
      base.pieces[0],
      ...pieces.map((over, i) => ({
        ...base.pieces[0],
        id: `p${i}`,
        name: `piece${i}`,
        parentId: "root",
        ...over,
      })),
    ],
  };
}

function workshop(over: Partial<ModProject> = {}): ModProject {
  return {
    id: "w1",
    name: "Lasers",
    gameName: "Splinter Faction",
    edits: {
      ...EMPTY_EDITS,
      weapons: {
        laser_copy: {
          key: "laser_copy",
          source: "armpw_emg",
          def: { range: 300 },
        },
      },
      overrides: { armpw: { maxdamage: 5 } },
    },
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

describe("weaponCarriers and mountedWeapons", () => {
  it("lists turrets and aim points in piece order, and mounts only those that fire something", () => {
    const project = unit([
      { role: "turret", weapon: { fires: { from: "game", name: "gun" } } },
      { role: "barrel" },
      { role: "aim" },
      { role: "turret", weapon: { fires: { from: "game", name: "cannon" } } },
    ]);
    expect(weaponCarriers(project).map((p) => p.id)).toEqual([
      "p0",
      "p2",
      "p3",
    ]);
    expect(mountedWeapons(project).map((m) => m.piece.id)).toEqual([
      "p0",
      "p3",
    ]);
  });

  it("ignores a weapon left on a piece whose role is no longer a turret", () => {
    const project = unit([
      { role: "barrel", weapon: { fires: { from: "game", name: "gun" } } },
    ]);
    expect(mountedWeapons(project)).toEqual([]);
  });
});

describe("slotTarget", () => {
  it("names a game weapon as the game keys it, in both keys a game reads", () => {
    expect(slotTarget("rover", { from: "game", name: "ARMPW_EMG" })).toEqual({
      def: "armpw_emg",
      name: "armpw_emg",
    });
  });

  it("names a library weapon by its key and by the full name the game gives it", () => {
    expect(
      slotTarget("rover", { from: "library", projectId: "w1", key: "laser" }),
    ).toEqual({ def: "laser", name: "rover_laser" });
  });
});

describe("arcFields", () => {
  it("writes nothing for a full circle, the engine's default", () => {
    expect(arcFields({})).toEqual({});
    expect(arcFields({ arc: 360, heading: 90 })).toEqual({});
  });

  it("writes the width and a straight-ahead direction for a narrower arc", () => {
    expect(arcFields({ arc: 120 })).toEqual({
      maxangledif: 120,
      maindir: "0 0 1",
    });
  });

  it("turns the direction to the unit's right for a positive heading", () => {
    // `GetObjectSpaceVec` maps x onto `rightdir` (SolidObject.h:232).
    expect(arcFields({ arc: 90, heading: 90 })).toEqual({
      maxangledif: 90,
      maindir: "1 0 0",
    });
    expect(arcFields({ arc: 90, heading: 180 }).maindir).toBe("0 0 -1");
  });
});

describe("weaponExportPlan", () => {
  it("writes a slot per mounted weapon, in order, with its arc", () => {
    const project = unit([
      {
        role: "turret",
        weapon: { fires: { from: "game", name: "armpw_emg" }, arc: 180 },
      },
      {
        role: "turret",
        weapon: {
          fires: { from: "library", projectId: "w1", key: "laser_copy" },
        },
      },
    ]);
    const plan = weaponExportPlan(project, [workshop()]);
    expect(plan.slots).toEqual([
      {
        def: "armpw_emg",
        name: "armpw_emg",
        maxangledif: 180,
        maindir: "0 0 1",
      },
      { def: "laser_copy", name: "rover_laser_copy" },
    ]);
    expect(plan.files.map((f) => [f.key, f.project.id])).toEqual([
      ["laser_copy", "w1"],
    ]);
    expect(plan.missing).toEqual([]);
  });

  it("writes one file for a library weapon two turrets fire", () => {
    const fires = {
      from: "library" as const,
      projectId: "w1",
      key: "laser_copy",
    };
    const project = unit([
      { role: "turret", weapon: { fires } },
      { role: "turret", weapon: { fires } },
    ]);
    const plan = weaponExportPlan(project, [workshop()]);
    expect(plan.slots).toHaveLength(2);
    expect(plan.files).toHaveLength(1);
  });

  it("leaves out a library weapon whose project or key is gone, and says so", () => {
    const project = unit([
      {
        role: "turret",
        weapon: { fires: { from: "library", projectId: "gone", key: "x" } },
      },
      {
        role: "turret",
        weapon: {
          fires: { from: "library", projectId: "w1", key: "deleted" },
        },
      },
    ]);
    const plan = weaponExportPlan(project, [workshop()]);
    expect(plan.slots).toEqual([]);
    expect(plan.files).toEqual([]);
    expect(plan.missing).toEqual([
      "x: its workshop project is gone.",
      "deleted is no longer in Lasers.",
    ]);
  });

  it("refuses a second library weapon of the same name from another project", () => {
    const project = unit([
      {
        role: "turret",
        weapon: {
          fires: { from: "library", projectId: "w1", key: "laser_copy" },
        },
      },
      {
        role: "turret",
        weapon: {
          fires: { from: "library", projectId: "w2", key: "laser_copy" },
        },
      },
    ]);
    const plan = weaponExportPlan(project, [
      workshop(),
      workshop({ id: "w2", name: "Other lasers" }),
    ]);
    expect(plan.slots).toHaveLength(1);
    expect(plan.missing).toEqual([
      "laser_copy from Other lasers: Lasers has a weapon of the same name on this unit.",
    ]);
  });
});

describe("weaponFileProject", () => {
  it("is the workshop project with only its library and one equipped slot", () => {
    const made = weaponFileProject("rover", "laser_copy", workshop());
    expect(made.id).toBe("w1");
    expect(made.edits.weapons).toEqual(workshop().edits.weapons);
    expect(made.edits.equipped).toEqual({ rover: { "0": "laser_copy" } });
    expect(made.edits.overrides).toEqual({});
  });
});

describe("pickWeaponFile", () => {
  it("finds the compiled file under the name the workshop gives it", () => {
    const compiled: CompiledMod = {
      chunks: [],
      notes: [],
      tweakdefs: null,
      files: [
        { path: "modinfo.lua", contents: "x" },
        { path: "weapons/coilbox_rover_laser_copy.lua", contents: "return {}" },
      ],
    };
    expect(weaponFileName("rover", "laser_copy")).toBe(
      "coilbox_rover_laser_copy.lua",
    );
    expect(pickWeaponFile(compiled, "rover", "laser_copy")).toBe("return {}");
    expect(pickWeaponFile(compiled, "rover", "other")).toBeNull();
  });
});

describe("exportWeapons", () => {
  const fires = {
    from: "library" as const,
    projectId: "w1",
    key: "laser_copy",
  };
  const armed = unit([
    { role: "turret", weapon: { fires: { from: "game", name: "gun" } } },
    { role: "turret", weapon: { fires } },
  ]);

  it("compiles each library weapon into the file the slot names", async () => {
    const seen: ModProject[] = [];
    const out = await exportWeapons(armed, [workshop()], async (project) => {
      seen.push(project);
      return {
        chunks: [],
        notes: [],
        tweakdefs: null,
        files: [
          {
            path: "weapons/coilbox_rover_laser_copy.lua",
            contents: "return {}",
          },
        ],
      };
    });
    expect(seen.map((p) => p.edits.equipped)).toEqual([
      { rover: { "0": "laser_copy" } },
    ]);
    expect(out.files).toEqual([
      { name: "coilbox_rover_laser_copy.lua", contents: "return {}" },
    ]);
    expect(out.slots.map((slot) => slot.name)).toEqual([
      "gun",
      "rover_laser_copy",
    ]);
    expect(out.missing).toEqual([]);
  });

  it("drops the slot of a weapon the compile could not write, and says why", async () => {
    const out = await exportWeapons(armed, [workshop()], async () => {
      throw new Error("compiler refused");
    });
    expect(out.files).toEqual([]);
    expect(out.slots.map((slot) => slot.name)).toEqual(["gun"]);
    expect(out.missing).toEqual(["laser_copy from Lasers: compiler refused."]);
  });
});

describe("weaponOptions", () => {
  it("offers the game's own projects' library first, then the game's weapons", () => {
    const options = weaponOptions(
      "Splinter Faction",
      { zap: { range: 1 }, armpw_emg: { range: 2 } },
      [workshop(), workshop({ id: "w9", gameName: "Another game" })],
    );
    expect(options.map((o) => [o.group, o.label])).toEqual([
      ["Lasers", "laser_copy"],
      ["Splinter Faction", "armpw_emg"],
      ["Splinter Faction", "zap"],
    ]);
    expect(options[0].ref).toEqual({
      from: "library",
      projectId: "w1",
      key: "laser_copy",
    });
    expect(options[0].def).toEqual({ range: 300 });
  });
});

describe("sameWeapon", () => {
  it("matches a game weapon whatever its case, and a library one by project and key", () => {
    expect(
      sameWeapon({ from: "game", name: "Gun" }, { from: "game", name: "gun" }),
    ).toBe(true);
    const lib = { from: "library" as const, projectId: "a", key: "k" };
    expect(sameWeapon(lib, { ...lib })).toBe(true);
    expect(sameWeapon(lib, { ...lib, projectId: "b" })).toBe(false);
    expect(sameWeapon(lib, { from: "game", name: "k" })).toBe(false);
  });
});

describe("pickedWeapon", () => {
  it("finds a game weapon, and says when the game has none of that name", () => {
    const defs = { gun: { range: 5 } };
    expect(pickedWeapon({ from: "game", name: "gun" }, "SF", defs, [])).toEqual(
      { def: { range: 5 } },
    );
    expect(
      pickedWeapon({ from: "game", name: "nope" }, "SF", defs, []),
    ).toEqual({ problem: "SF has no weapon of that name." });
    expect(pickedWeapon({ from: "game", name: "gun" }, "SF", null, [])).toBe(
      null,
    );
  });

  it("finds a library weapon with its changes, and says when it is gone", () => {
    const changed = workshop();
    const weapons = changed.edits.weapons ?? {};
    weapons.laser_copy = { ...weapons.laser_copy, changes: { range: 900 } };
    const ref = {
      from: "library" as const,
      projectId: "w1",
      key: "laser_copy",
    };
    expect(pickedWeapon(ref, "SF", null, [changed])).toEqual({
      def: { range: 900 },
    });
    expect(pickedWeapon(ref, "SF", null, [])).toEqual({
      problem: "Its workshop project is gone.",
    });
    expect(
      pickedWeapon({ ...ref, key: "other" }, "SF", null, [changed]),
    ).toEqual({ problem: "No longer in Lasers." });
  });
});

describe("weaponSummary", () => {
  it("gives range, damage and reload", () => {
    expect(
      weaponSummary({
        range: 400,
        reloadtime: 1.5,
        damage: { default: 120 },
      }),
    ).toBe("Range 400, 120 damage, reloads in 1.5s");
  });

  it("says why a shield has no damage figure", () => {
    expect(weaponSummary({ weapontype: "Shield", range: 200 })).toBe(
      "Range 200, no damage (shield), reloads in 1s",
    );
  });
});

describe("pickWeaponParts and buildWeaponModule", () => {
  it("takes the smallest block for the turret and the beam nearest two long for the barrel", () => {
    expect(pickWeaponParts(PARTS)).toEqual({
      turret: PARTS[1],
      barrel: PARTS[3],
    });
    expect(pickWeaponParts(PARTS.filter((p) => p.shape !== "beam"))).toBeNull();
  });

  it("is a turret, a barrel pointing forward and a flare at its end", () => {
    const parts = pickWeaponParts(PARTS);
    if (!parts) throw new Error("fixture has no weapon parts");
    let n = 0;
    const module = buildWeaponModule(parts, () => `id${++n}`, "now");
    const at = (role: string) =>
      module.pieces.find((piece) => piece.role === role);
    const turret = at("turret");
    const barrel = at("barrel");
    const flare = at("flare");
    expect(module.rootPieceId).toBe(turret?.id);
    expect(turret?.weapon).toEqual({});
    expect(barrel?.parentId).toBe(turret?.id);
    expect(flare?.parentId).toBe(barrel?.id);
    expect(flare?.partId).toBeNull();
    // Turned a quarter about x, so the beam's length runs along +z.
    expect(barrel?.rotation[0]).toBeCloseTo(Math.PI / 2);
    // Half the turret's depth (0.5) plus half the barrel's length (1).
    expect(barrel?.position[2]).toBeCloseTo(1.5);
    // The far end of the barrel, along its own length.
    expect(flare?.position[1]).toBeCloseTo(1);
  });

  it("adds the module with the aim and recoil presets as one change", () => {
    const parts = pickWeaponParts(PARTS);
    if (!parts) throw new Error("fixture has no weapon parts");
    let n = 0;
    const before = unit();
    const { project, rootPieceIds } = addWeaponModule(before, parts, {
      parentId: "root",
      newId: () => `id${++n}`,
      now: "now",
    });
    expect(project.pieces).toHaveLength(before.pieces.length + 3);
    expect(rootPieceIds).toHaveLength(1);
    expect(project.animations?.map((a) => a.presetId)).toEqual([
      "turret.track",
      "recoil",
    ]);
    expect(weaponCarriers(project)).toHaveLength(1);
  });

  it("keeps a preset the unit already has, with its settings", () => {
    const parts = pickWeaponParts(PARTS);
    if (!parts) throw new Error("fixture has no weapon parts");
    let n = 0;
    const before = {
      ...unit(),
      animations: [{ presetId: "recoil", params: { kick: 0.5 } }],
    };
    const { project } = addWeaponModule(before, parts, {
      parentId: "root",
      newId: () => `id${++n}`,
      now: "now",
    });
    expect(project.animations).toEqual([
      { presetId: "recoil", params: { kick: 0.5 } },
      { presetId: "turret.track", params: {} },
    ]);
  });
});

describe("scriptWeapons", () => {
  /** Two modules on one unit, as two presses of the Weapon button add them. */
  function twoModules(): LegoProject {
    const parts = pickWeaponParts(PARTS);
    if (!parts) throw new Error("fixture has no weapon parts");
    let n = 0;
    const options = { parentId: "root", newId: () => `id${++n}`, now: "now" };
    const one = addWeaponModule(unit(), parts, options).project;
    return addWeaponModule(one, parts, options).project;
  }

  it("gives each inserted module its own barrel and flare", () => {
    const project = twoModules();
    const weapons = scriptWeapons(project);
    expect(weapons).toHaveLength(2);
    const [first, second] = weapons;
    expect(first.carrier?.id).not.toBe(second.carrier?.id);
    for (const weapon of weapons) {
      expect(weapon.barrel?.parentId).toBe(weapon.carrier?.id);
      expect(weapon.flare?.parentId).toBe(weapon.barrel?.id);
    }
  });

  it("numbers weapons in the same order as the weapons table", () => {
    const project = twoModules();
    const [a, b] = weaponCarriers(project);
    const picked: LegoProject = {
      ...project,
      pieces: project.pieces.map((piece) =>
        piece.id === a.id
          ? { ...piece, weapon: { fires: { from: "game", name: "laser" } } }
          : piece.id === b.id
            ? { ...piece, weapon: { fires: { from: "game", name: "cannon" } } }
            : piece,
      ),
    };
    const slots = weaponExportPlan(picked, []).slots.map((slot) => slot.name);
    const script = scriptWeapons(picked).map(
      (weapon) => weapon.carrier?.weapon?.fires,
    );
    expect(slots).toEqual(["laser", "cannon"]);
    expect(script).toEqual([
      { from: "game", name: "laser" },
      { from: "game", name: "cannon" },
    ]);
  });

  it("hands a barrel beside its turret to the turret that has none", () => {
    const weapons = scriptWeapons(
      unit([
        { id: "t", role: "turret" },
        { id: "b", role: "barrel" },
      ]),
    );
    expect(weapons.map((weapon) => weapon.barrel?.id)).toEqual(["b"]);
  });

  it("is one weapon with no carrier on a unit with no turret or aim point", () => {
    const weapons = scriptWeapons(unit([{ id: "b", role: "barrel" }]));
    expect(weapons).toEqual([
      {
        carrier: null,
        barrel: expect.objectContaining({ id: "b" }),
        flare: null,
      },
    ]);
  });
});
