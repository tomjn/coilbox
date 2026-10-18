import { describe, expect, it } from "vitest";

import {
  addLoadout,
  adoptLoadoutFile,
  deleteLoadout,
  exportTargets,
  loadoutUnit,
  loadoutUnitNames,
  recordLoadoutExport,
  renameLoadout,
  setLoadoutUnitName,
  switchLoadout,
} from "./loadouts";
import {
  type LegoPiece,
  type LegoProject,
  newProject,
  parseLegoProjectJson,
} from "./model";
import { definitionUnclaimed } from "./reexport";
import { buildUnitDef } from "./unitDef";

const DIR = "/games/sf.sdd";

function piece(id: string, parentId: string | null): LegoPiece {
  return {
    id,
    name: id,
    parentId,
    partId: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  };
}

/** A chassis called `armpw`, saved before loadouts existed. */
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

/** "Light", "Heavy" and "Sniper", in that order, with Sniper active. */
function three(): LegoProject {
  next = 0;
  const first = addLoadout(plain(), { newId, name: "Heavy" });
  const second = addLoadout(first, { newId, name: "Sniper" });
  return renameLoadout(second, second.loadouts?.[0].id as string, "Light");
}

const idOf = (project: LegoProject, name: string) =>
  project.loadouts?.find((l) => l.name === name)?.id as string;

const nameOf = (project: LegoProject, name: string) =>
  loadoutUnitNames(project).get(idOf(project, name));

const written = (name: string) => [
  { path: `${DIR}/units/${name}.lua`, sha256: `sha-${name}` },
];

function exportedAs(project: LegoProject, name: string, at = "t1") {
  return recordLoadoutExport(
    project,
    idOf(project, name),
    {
      dir: DIR,
      at,
      unitName: nameOf(project, name) as string,
      def: { health: 1 },
    },
    written(nameOf(project, name) as string),
  );
}

describe("export names", () => {
  it("joins the unit name and the loadout name as a Spring unit name", () => {
    const project = three();
    expect([...loadoutUnitNames(project).values()]).toEqual([
      "armpw_light",
      "armpw_heavy",
      "armpw_sniper",
    ]);
  });

  it("cleans spaces, case and symbols", () => {
    const project = renameLoadout(
      three(),
      idOf(three(), "Heavy"),
      "Heavy Rocket (v2)!",
    );
    expect(nameOf(project, "Heavy Rocket (v2)!")).toBe("armpw_heavy_rocket_v2");
  });

  it("numbers a name another loadout already has", () => {
    const project = renameLoadout(three(), idOf(three(), "Heavy"), "LIGHT");
    const names = [...loadoutUnitNames(project).values()];
    expect(new Set(names).size).toBe(3);
    expect(names).toEqual(["armpw_light", "armpw_light2", "armpw_sniper"]);
  });

  it("uses a chosen name, cleaned, and keeps it unique", () => {
    let project = three();
    project = setLoadoutUnitName(project, idOf(project, "Heavy"), "Big Gun");
    project = setLoadoutUnitName(project, idOf(project, "Sniper"), "big_gun");
    expect(nameOf(project, "Heavy")).toBe("big_gun");
    expect(nameOf(project, "Sniper")).toBe("big_gun2");
  });

  it("lets a chosen name win over a joined one that matches it", () => {
    let project = three();
    project = setLoadoutUnitName(
      project,
      idOf(project, "Sniper"),
      "armpw_light",
    );
    expect(nameOf(project, "Sniper")).toBe("armpw_light");
    expect(nameOf(project, "Light")).toBe("armpw_light2");
  });

  it("goes back to the joined name when the chosen one is emptied", () => {
    let project = three();
    project = setLoadoutUnitName(project, idOf(project, "Heavy"), "big");
    project = setLoadoutUnitName(project, idOf(project, "Heavy"), " ");
    expect(nameOf(project, "Heavy")).toBe("armpw_heavy");
  });

  it("has none for a unit without loadouts", () => {
    expect(loadoutUnitNames(plain()).size).toBe(0);
  });
});

describe("a loadout as a unit to export", () => {
  it("has its own pieces, name and in game name", () => {
    const project = three();
    const heavy = idOf(project, "Heavy");
    const withGun = {
      ...switchLoadout(project, heavy),
      pieces: [
        ...switchLoadout(project, heavy).pieces,
        { ...piece("gun", "hull"), inLoadout: true as const },
      ],
    };
    const unit = loadoutUnit(withGun, heavy);
    expect(unit?.unitName).toBe("armpw_heavy");
    expect(unit?.name).toBe("Pawn Heavy");
    expect(unit?.pieces.map((p) => p.id)).toContain("gun");
    expect(
      loadoutUnit(withGun, idOf(project, "Light"))?.pieces.map((p) => p.id),
    ).not.toContain("gun");
  });

  it("is null for an id that is not a loadout", () => {
    expect(loadoutUnit(three(), "nope")).toBeNull();
  });

  it("exports the active loadout alone or every loadout, in order", () => {
    const project = three();
    expect(
      exportTargets(project, "active").map((t) => t.unit.unitName),
    ).toEqual(["armpw_sniper"]);
    expect(exportTargets(project, "all").map((t) => t.unit.unitName)).toEqual([
      "armpw_light",
      "armpw_heavy",
      "armpw_sniper",
    ]);
  });

  it("reads each loadout's own receipt and not the project's or another's", () => {
    let project = three();
    project = {
      ...project,
      exported: { dir: DIR, at: "old", unitName: "armpw", def: {}, files: [] },
    };
    project = exportedAs(project, "Heavy");
    const heavy = loadoutUnit(project, idOf(project, "Heavy"));
    const light = loadoutUnit(project, idOf(project, "Light"));
    expect(heavy?.exported?.unitName).toBe("armpw_heavy");
    expect(light?.exported).toBeUndefined();
  });
});

describe("a project without loadouts", () => {
  it("exports as the project itself, so the definition is byte for byte what it was", () => {
    const project = parseLegoProjectJson(
      JSON.stringify(plain()),
    ) as LegoProject;
    const targets = exportTargets(project, "all");
    expect(targets).toHaveLength(1);
    expect(targets[0].loadoutId).toBeNull();
    expect(targets[0].unit).toBe(project);
    const bounds = { mid: [0, 4, 0], sizeX: 8, sizeY: 8, sizeZ: 8 } as const;
    expect(
      buildUnitDef(
        targets[0].unit,
        { ...bounds, mid: [...bounds.mid] },
        "def",
        null,
      ),
    ).toBe(
      buildUnitDef(project, { ...bounds, mid: [...bounds.mid] }, "def", null),
    );
    expect(targets[0].unit.unitName).toBe("armpw");
  });
});

describe("receipts per loadout", () => {
  it("keeps one receipt per loadout and folder", () => {
    let project = exportedAs(three(), "Light");
    project = exportedAs(project, "Heavy");
    const light = project.loadouts?.find((l) => l.name === "Light");
    const heavy = project.loadouts?.find((l) => l.name === "Heavy");
    expect(light?.exported?.unitName).toBe("armpw_light");
    expect(light?.exported?.files).toEqual(written("armpw_light"));
    expect(heavy?.exported?.unitName).toBe("armpw_heavy");
    expect(project.exported).toBeUndefined();
  });

  it("leaves the other loadouts' receipts alone on a re-export of one", () => {
    let project = exportedAs(three(), "Light", "t1");
    project = exportedAs(project, "Heavy", "t1");
    const before = project.loadouts?.find((l) => l.name === "Light");
    project = exportedAs(project, "Heavy", "t2");
    expect(project.loadouts?.find((l) => l.name === "Light")).toBe(before);
    expect(
      project.loadouts?.find((l) => l.name === "Heavy")?.exported?.at,
    ).toBe("t2");
    expect(project.staleExports ?? []).toEqual([]);
  });

  it("keeps a receipt for a second folder beside the first", () => {
    let project = exportedAs(three(), "Light");
    project = recordLoadoutExport(
      project,
      idOf(project, "Light"),
      { dir: "/games/other.sdd", at: "t2", unitName: "armpw_light", def: {} },
      [],
    );
    const light = project.loadouts?.find((l) => l.name === "Light");
    expect(light?.exported?.dir).toBe("/games/other.sdd");
    expect(light?.exportedElsewhere?.map((r) => r.dir)).toEqual([DIR]);
  });

  it("moves a renamed loadout's old name to the leftovers when it exports again", () => {
    let project = exportedAs(three(), "Heavy");
    project = renameLoadout(project, idOf(project, "Heavy"), "Tank");
    project = exportedAs(project, "Tank", "t2");
    expect(project.staleExports?.map((s) => s.unitName)).toEqual([
      "armpw_heavy",
    ]);
    expect(
      project.loadouts?.find((l) => l.name === "Tank")?.exported?.unitName,
    ).toBe("armpw_tank");
  });

  it("survives a switch and a save", () => {
    let project = exportedAs(three(), "Light");
    project = switchLoadout(project, idOf(project, "Light"));
    project = switchLoadout(project, idOf(project, "Sniper"));
    const parsed = parseLegoProjectJson(JSON.stringify(project));
    expect(
      parsed?.loadouts?.find((l) => l.name === "Light")?.exported?.unitName,
    ).toBe("armpw_light");
    expect(
      parsed?.loadouts?.find((l) => l.name === "Light")?.exported?.files,
    ).toEqual(written("armpw_light"));
  });

  it("saves a chosen name", () => {
    let project = three();
    project = setLoadoutUnitName(project, idOf(project, "Heavy"), "big");
    const parsed = parseLegoProjectJson(JSON.stringify(project));
    expect(parsed && nameOf(parsed, "Heavy")).toBe("big");
  });
});

describe("deleting an exported loadout", () => {
  it("leaves its files listed so the drawer can offer to remove them", () => {
    let project = exportedAs(three(), "Heavy");
    project = exportedAs(project, "Light");
    project = deleteLoadout(project, idOf(project, "Heavy"));
    expect(project.loadouts?.map((l) => l.name)).toEqual(["Light", "Sniper"]);
    expect(project.staleExports?.map((s) => s.unitName)).toEqual([
      "armpw_heavy",
    ]);
    expect(project.staleExports?.[0].files).toEqual(written("armpw_heavy"));
    expect(
      project.loadouts?.find((l) => l.name === "Light")?.exported?.unitName,
    ).toBe("armpw_light");
  });

  it("lists the last loadout's files too when the unit goes back to one", () => {
    let project = renameLoadout(plain(), "x", "y");
    next = 0;
    project = addLoadout(plain(), { newId, name: "Heavy" });
    project = exportedAs(project, "Heavy");
    project = exportedAs(project, "Loadout 1");
    project = deleteLoadout(project, idOf(project, "Loadout 1"));
    expect(project.loadouts).toBeUndefined();
    expect(project.staleExports?.map((s) => s.unitName)).toEqual([
      "armpw_loadout_1",
      "armpw_heavy",
    ]);
  });
});

describe("adopting a definition per loadout", () => {
  it("claims the file for that loadout only", () => {
    let project = exportedAs(three(), "Light");
    project = exportedAs(project, "Heavy");
    // Both receipts lost their digest for the definition, as an old export's.
    project = {
      ...project,
      loadouts: project.loadouts?.map((l) =>
        l.exported ? { ...l, exported: { ...l.exported, files: [] } } : l,
      ),
    };
    const light = idOf(project, "Light");
    const heavy = idOf(project, "Heavy");
    const receiptOf = (p: LegoProject, id: string) =>
      p.loadouts?.find((l) => l.id === id)?.exported;
    expect(
      definitionUnclaimed(receiptOf(project, light), DIR, "armpw_light"),
    ).toBe(true);

    project = adoptLoadoutFile(project, light, DIR, {
      path: `${DIR}/units/armpw_light.lua`,
      sha256: "mine",
    });
    expect(
      definitionUnclaimed(receiptOf(project, light), DIR, "armpw_light"),
    ).toBe(false);
    expect(
      definitionUnclaimed(receiptOf(project, heavy), DIR, "armpw_heavy"),
    ).toBe(true);
  });
});
