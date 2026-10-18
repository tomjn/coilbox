import { describe, expect, it } from "vitest";
import { loadoutFamily } from "./loadoutFamily";
import { duplicateLoadout, renameLoadout, switchLoadout } from "./loadouts";
import { setLoadoutLocked, setModuleLocked } from "./locks";
import {
  type LegoPiece,
  type LegoProject,
  newProject,
  pieceById,
} from "./model";
import type { UnitStats } from "./unitStats";

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

const join = { connector: "base", to: "top" };

/** A hull with two mounts, a gun on the top one and nothing on the side. */
function chassis(): LegoProject {
  const project = newProject({
    id: "p",
    rootPieceId: "root",
    name: "Tank",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-18T00:00:00Z",
  });
  return {
    ...project,
    unitName: "tank",
    pieces: [
      ...project.pieces,
      piece("hull", "root", {
        mountPoints: [
          { connector: "top", name: "Turret", accepts: ["gun"] },
          { connector: "side", name: "Pod", accepts: ["pod"] },
        ],
      }),
      piece("cannon", "hull", { connection: join, inLoadout: true }),
    ],
  };
}

let next = 0;
const newId = () => `id${++next}`;

/** A copy of the active loadout, changed by `edit`, with the first loadout
 *  active again. */
function copied(
  project: LegoProject,
  edit: (p: LegoProject) => LegoProject,
): LegoProject {
  const made = duplicateLoadout(project, { newId });
  return switchLoadout(edit(made), made.loadouts?.[0].id as string);
}

function renamePiece(id: string, name: string) {
  return (p: LegoProject): LegoProject => ({
    ...p,
    pieces: p.pieces.map((x) => (x.id === id ? { ...x, name } : x)),
  });
}

function stats(over: Partial<UnitStats> = {}): UnitStats {
  return { cost: 100, health: 500, speed: 50, range: 300, dps: 20, ...over };
}

const none = () => stats();

function row(family: ReturnType<typeof loadoutFamily>, id: string) {
  return family?.rows.find((r) => r.id === id);
}

describe("loadoutFamily", () => {
  it("is null for a unit with one loadout or none", () => {
    next = 0;
    expect(loadoutFamily(chassis(), none)).toBeNull();
    const one = { ...chassis(), loadouts: [{ id: "a", name: "A" }] };
    expect(loadoutFamily({ ...one, activeLoadout: "a" }, none)).toBeNull();
  });

  it("has one column per loadout with its name and export name", () => {
    next = 0;
    const two = renameLoadout(
      copied(chassis(), (p) => p),
      "id1",
      "Cannon",
    );
    const family = loadoutFamily(two, none);
    expect(family?.columns.map((c) => c.name)).toEqual([
      "Cannon",
      "Loadout 1 copy",
    ]);
    expect(family?.columns.map((c) => c.exportName)).toEqual([
      "tank_cannon",
      "tank_loadout_1_copy",
    ]);
    expect(family?.columns.map((c) => c.active)).toEqual([true, false]);
  });

  it("marks a mount whose module differs between two loadouts", () => {
    next = 0;
    const two = copied(chassis(), renamePiece("cannon", "rocket"));
    const family = loadoutFamily(two, none);
    const turret = row(family, "hull:top");
    expect(turret?.label).toBe("Turret");
    expect(turret?.cells).toEqual(["cannon", "rocket"]);
    expect(turret?.differs).toBe(true);
    const pod = row(family, "hull:side");
    expect(pod?.cells).toEqual([null, null]);
    expect(pod?.differs).toBe(false);
  });

  it("reads three loadouts and marks a mount that differs in only one", () => {
    next = 0;
    const two = copied(chassis(), renamePiece("cannon", "rocket"));
    const three = copied(two, (p) => ({
      ...p,
      pieces: p.pieces.filter((x) => x.id !== "cannon"),
    }));
    const family = loadoutFamily(three, none);
    expect(family?.columns).toHaveLength(3);
    expect(row(family, "hull:top")?.cells).toEqual(["cannon", null, "rocket"]);
    expect(row(family, "hull:top")?.differs).toBe(true);
  });

  it("shows no difference between identical loadouts", () => {
    next = 0;
    const two = duplicateLoadout(chassis(), { newId });
    const family = loadoutFamily(two, none);
    expect(family?.rows.length).toBeGreaterThan(0);
    expect(family?.rows.some((r) => r.differs)).toBe(false);
  });

  it("marks the stats that differ, with the highest and lowest", () => {
    next = 0;
    const three = duplicateLoadout(duplicateLoadout(chassis(), { newId }), {
      newId,
    });
    const ids = three.loadouts?.map((l) => l.id) as string[];
    const by: Record<string, UnitStats> = {
      [ids[0]]: stats({ cost: 100, health: 500 }),
      [ids[1]]: stats({ cost: 150, health: 500 }),
      [ids[2]]: stats({ cost: 90, health: 500 }),
    };
    const family = loadoutFamily(three, (unit) => by[unit.activeLoadout ?? ""]);
    const cost = row(family, "cost");
    expect(cost?.cells).toEqual(["100", "150", "90"]);
    expect(cost?.differs).toBe(true);
    expect(cost?.highest).toEqual([1]);
    expect(cost?.lowest).toEqual([2]);
    const health = row(family, "health");
    expect(health?.differs).toBe(false);
    expect(health?.highest).toBeUndefined();
  });

  it("reads a stat as missing when a loadout has none", () => {
    next = 0;
    const two = duplicateLoadout(chassis(), { newId });
    const first = two.loadouts?.[0].id;
    const family = loadoutFamily(two, (unit) =>
      unit.activeLoadout === first ? stats({ range: null }) : stats(),
    );
    const range = row(family, "range");
    expect(range?.cells).toEqual([null, "300"]);
    expect(range?.differs).toBe(true);
  });

  it("has mount rows only when no stats can be read", () => {
    next = 0;
    const two = duplicateLoadout(chassis(), { newId });
    const family = loadoutFamily(two, () => null);
    expect(family?.rows.every((r) => r.kind === "mount")).toBe(true);
  });

  it("reads each loadout from its own pieces", () => {
    next = 0;
    const two = copied(chassis(), renamePiece("cannon", "rocket"));
    // The project on screen is still the first loadout's.
    expect(pieceById(two, "cannon")?.name).toBe("cannon");
    expect(row(loadoutFamily(two, none), "hull:top")?.cells[1]).toBe("rocket");
  });
});

describe("locks in the family", () => {
  it("marks a locked column with why", () => {
    const base = copied(chassis(), renamePiece("cannon", "rocket"));
    const locked = setLoadoutLocked(
      base,
      base.loadouts?.[1].id as string,
      true,
    );
    const family = loadoutFamily(
      setModuleLocked(locked, "m", true),
      () => null,
      (id) => `module ${id}`,
    );
    expect(family?.columns.map((c) => c.locked)).toEqual([undefined, "Locked"]);
  });
});
