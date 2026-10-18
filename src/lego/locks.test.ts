import { describe, expect, it } from "vitest";
import {
  addLoadout,
  loadoutUnit,
  loadoutUnitNames,
  recordLoadoutExport,
  renameLoadout,
  switchLoadout,
} from "./loadouts";
import {
  heldModules,
  lockedExportedUnits,
  lockedListPath,
  lockedListText,
  lockedUnitNames,
  lockReason,
  setLoadoutLocked,
  setModuleLocked,
  unitLocks,
} from "./locks";
import {
  type LegoPiece,
  type LegoProject,
  newProject,
  parseLegoProjectJson,
} from "./model";
import { buildUnitDef } from "./unitDef";

const DIR = "/games/sf.sdd";

function piece(
  id: string,
  parentId: string | null,
  extra: Partial<LegoPiece> = {},
): LegoPiece {
  return {
    id,
    name: id,
    parentId,
    partId: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...extra,
  };
}

const inModule = (id: string) => ({ id, instance: `${id}-1` });

/** A chassis called `armpw` with no loadouts and no modules. */
function plain(): LegoProject {
  const project = newProject({
    id: "p",
    rootPieceId: "base",
    name: "Pawn",
    unitName: "armpw",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-18T00:00:00Z",
  });
  return { ...project, pieces: [...project.pieces, piece("hull", "base")] };
}

let next = 0;
const newId = () => `id${++next}`;

/**
 * "Light" (a laser module), "Heavy" (a cannon module) and "Sniper" (a rifle
 * module), in that order, Sniper active. A shield module is on the chassis.
 */
function family(): LegoProject {
  next = 0;
  const base = plain();
  const withShield: LegoProject = {
    ...base,
    pieces: [
      ...base.pieces,
      piece("shield", "hull", { module: inModule("shield") }),
    ],
  };
  const first = addLoadout(withShield, { newId, name: "Heavy" });
  const second = addLoadout(first, { newId, name: "Sniper" });
  const named = renameLoadout(
    second,
    second.loadouts?.[0].id as string,
    "Light",
  );
  // Each loadout gets its own module, put in while it is on the chassis.
  let out = named;
  for (const [name, module] of [
    ["Light", "laser"],
    ["Heavy", "cannon"],
    ["Sniper", "rifle"],
  ] as const) {
    out = switchLoadout(out, idOf(out, name));
    out = {
      ...out,
      pieces: [
        ...out.pieces,
        piece(`${module}-top`, "hull", {
          module: inModule(module),
          inLoadout: true,
        }),
      ],
    };
  }
  return out;
}

const idOf = (project: LegoProject, name: string) =>
  project.loadouts?.find((l) => l.name === name)?.id as string;

const lockOf = (project: LegoProject, name: string) =>
  unitLocks(project).find((l) => l.loadoutId === idOf(project, name));

describe("locking a loadout", () => {
  it("marks it locked and unmarks it", () => {
    const project = setLoadoutLocked(family(), idOf(family(), "Heavy"), true);
    expect(lockOf(project, "Heavy")).toMatchObject({
      locked: true,
      own: true,
      modules: [],
    });
    expect(lockOf(project, "Light")?.locked).toBe(false);
    const open = setLoadoutLocked(project, idOf(project, "Heavy"), false);
    expect(lockOf(open, "Heavy")?.locked).toBe(false);
    expect(open.loadouts?.every((l) => !Object.hasOwn(l, "locked"))).toBe(true);
  });

  it("returns the same project when nothing changes", () => {
    const project = family();
    expect(setLoadoutLocked(project, idOf(project, "Heavy"), false)).toBe(
      project,
    );
    expect(setLoadoutLocked(project, "nope", true)).toBe(project);
  });

  it("survives switching loadouts", () => {
    const locked = setLoadoutLocked(family(), idOf(family(), "Heavy"), true);
    const there = switchLoadout(locked, idOf(locked, "Light"));
    expect(lockOf(there, "Heavy")?.locked).toBe(true);
  });
});

describe("locking a module", () => {
  it("locks every loadout that holds it, and says which module", () => {
    const project = setModuleLocked(family(), "cannon", true);
    expect(lockOf(project, "Heavy")).toMatchObject({
      locked: true,
      own: false,
      modules: ["cannon"],
    });
    expect(lockOf(project, "Light")?.locked).toBe(false);
    expect(lockOf(project, "Sniper")?.locked).toBe(false);
  });

  it("locks every loadout when the module is on the chassis", () => {
    const project = setModuleLocked(family(), "shield", true);
    expect(unitLocks(project).every((l) => l.locked)).toBe(true);
    expect(unitLocks(project).every((l) => l.modules[0] === "shield")).toBe(
      true,
    );
  });

  it("unlocks again, and stores nothing when none is locked", () => {
    const locked = setModuleLocked(family(), "cannon", true);
    const open = setModuleLocked(locked, "cannon", false);
    expect(open.lockedModules).toBeUndefined();
    expect(unitLocks(open).some((l) => l.locked)).toBe(false);
  });

  it("lists the modules a unit holds across every loadout", () => {
    expect(heldModules(family()).sort()).toEqual([
      "cannon",
      "laser",
      "rifle",
      "shield",
    ]);
  });

  it("locks a unit without loadouts that holds the module", () => {
    const base = plain();
    const unit: LegoProject = {
      ...base,
      pieces: [...base.pieces, piece("gun", "hull", { module: inModule("m") })],
    };
    const locked = setModuleLocked(unit, "m", true);
    expect(unitLocks(locked)).toEqual([
      {
        loadoutId: null,
        unitName: "armpw",
        locked: true,
        own: false,
        modules: ["m"],
      },
    ]);
    expect(lockedUnitNames(locked)).toEqual(["armpw"]);
  });
});

describe("saying why", () => {
  const nameOf = (id: string) => id.toUpperCase();

  it("says nothing for a free loadout", () => {
    const free = lockOf(family(), "Light");
    expect(free && lockReason(free, nameOf)).toBeNull();
  });

  it("says locked for a loadout marked locked", () => {
    const project = setLoadoutLocked(family(), idOf(family(), "Heavy"), true);
    const lock = lockOf(project, "Heavy");
    expect(lock && lockReason(lock, nameOf)).toBe("Locked");
  });

  it("names the modules that lock it", () => {
    let project = setModuleLocked(family(), "cannon", true);
    project = setModuleLocked(project, "shield", true);
    const lock = lockOf(project, "Heavy");
    expect(lock && lockReason(lock, nameOf)).toBe("Locked by SHIELD, CANNON");
  });

  it("says both when both lock it", () => {
    let project = setModuleLocked(family(), "cannon", true);
    project = setLoadoutLocked(project, idOf(project, "Heavy"), true);
    const lock = lockOf(project, "Heavy");
    expect(lock && lockReason(lock, nameOf)).toBe("Locked, and by CANNON");
  });
});

describe("the locked list", () => {
  it("names the locked loadouts as they are exported", () => {
    let project = setLoadoutLocked(family(), idOf(family(), "Heavy"), true);
    project = setModuleLocked(project, "rifle", true);
    expect(lockedUnitNames(project)).toEqual(["armpw_heavy", "armpw_sniper"]);
  });

  it("uses a name the game maker chose", () => {
    let project = family();
    project = {
      ...project,
      loadouts: project.loadouts?.map((l) =>
        l.name === "Heavy" ? { ...l, unitName: "armpw_boss" } : l,
      ),
    };
    project = setLoadoutLocked(project, idOf(project, "Heavy"), true);
    expect(lockedUnitNames(project)).toEqual(["armpw_boss"]);
    expect(loadoutUnitNames(project).get(idOf(project, "Heavy"))).toBe(
      "armpw_boss",
    );
  });

  it("is a Lua file a game can include, keyed to the chassis", () => {
    const project = setLoadoutLocked(family(), idOf(family(), "Heavy"), true);
    expect(lockedListPath(project)).toBe(
      "luarules/configs/coilbox_locked_units/armpw.lua",
    );
    const text = lockedListText(project);
    expect(text).toContain('return {\n\t"armpw_heavy",\n}');
  });

  it("is an empty list when nothing is locked", () => {
    expect(lockedListText(family())).toContain("return {\n}");
  });
});

describe("the picker's names", () => {
  function exportedAll(project: LegoProject): LegoProject {
    let out = project;
    for (const loadout of project.loadouts ?? []) {
      const unitName = loadoutUnitNames(project).get(loadout.id) as string;
      out = recordLoadoutExport(
        out,
        loadout.id,
        { dir: DIR, at: "t1", unitName, def: {} },
        [],
      );
    }
    return out;
  }

  it("offers each locked unit exported into the game, with its cause", () => {
    let project = exportedAll(family());
    project = setLoadoutLocked(project, idOf(project, "Heavy"), true);
    project = setModuleLocked(project, "rifle", true);
    expect(lockedExportedUnits([project], DIR)).toEqual([
      { name: "armpw_heavy", label: "Heavy of Pawn" },
      { name: "armpw_sniper", label: "Sniper of Pawn" },
    ]);
  });

  it("leaves out units not exported into that game and unlocked ones", () => {
    const project = setLoadoutLocked(
      exportedAll(family()),
      idOf(family(), "Heavy"),
      true,
    );
    expect(lockedExportedUnits([project], "/games/other.sdd")).toEqual([]);
    expect(lockedExportedUnits([family()], DIR)).toEqual([]);
    expect(lockedExportedUnits([project], undefined)).toEqual([]);
  });
});

describe("a lock is data and changes no unit", () => {
  const bounds = { mid: [0, 4, 0], sizeX: 8, sizeY: 8, sizeZ: 8 } as const;
  const def = (unit: LegoProject) =>
    buildUnitDef(unit, { ...bounds, mid: [...bounds.mid] }, "def", null);

  it("writes the same definition, locked or not", () => {
    const open = family();
    let locked = setLoadoutLocked(open, idOf(open, "Heavy"), true);
    locked = setModuleLocked(locked, "rifle", true);
    for (const loadout of open.loadouts ?? []) {
      const before = loadoutUnit(open, loadout.id) as LegoProject;
      const after = loadoutUnit(locked, loadout.id) as LegoProject;
      expect(def(after)).toBe(def(before));
      expect(after.pieces).toEqual(before.pieces);
    }
  });
});

describe("saved files", () => {
  it("round trips the locks", () => {
    let project = setLoadoutLocked(family(), idOf(family(), "Heavy"), true);
    project = setModuleLocked(project, "rifle", true);
    const again = parseLegoProjectJson(JSON.stringify(project)) as LegoProject;
    expect(again.lockedModules).toEqual(["rifle"]);
    expect(lockedUnitNames(again)).toEqual(lockedUnitNames(project));
  });

  it("loads a file saved before locks exactly as it was", () => {
    const old = family();
    const again = parseLegoProjectJson(JSON.stringify(old)) as LegoProject;
    expect(Object.hasOwn(again, "lockedModules")).toBe(false);
    expect(again.loadouts?.some((l) => Object.hasOwn(l, "locked"))).toBe(false);
    expect(lockedUnitNames(again)).toEqual([]);
  });

  it("drops a malformed lock list", () => {
    const raw = JSON.parse(JSON.stringify(family()));
    raw.lockedModules = ["ok", "", 4, "ok"];
    raw.loadouts[0].locked = "yes";
    const again = parseLegoProjectJson(JSON.stringify(raw)) as LegoProject;
    expect(again.lockedModules).toEqual(["ok"]);
    expect(again.loadouts?.[0].locked).toBeUndefined();
  });
});
