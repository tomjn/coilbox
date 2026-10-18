import { describe, expect, it } from "vitest";
import { addToBuildMenu } from "@/workshop/buildMenus";
import { EMPTY_EDITS, type ModProject } from "@/workshop/project";
import {
  buildersOf,
  projectForGame,
  variantsOf,
  withVariantsAdded,
  withVariantsRemoved,
} from "./buildMenuVariants";
import { type LegoExport, type LegoProject, newProject } from "./model";

const FOLDER = "/games/SF.sdd";

function receipt(unitName: string, dir = FOLDER): LegoExport {
  return { dir, at: "", unitName, def: {}, files: [] } as LegoExport;
}

/** Loadouts a, b, c in the list order a, c, b, with c upgrading from a and b
 *  from c, so the chain order is a, c, b. b has no export. */
function chassis(): LegoProject {
  return {
    ...newProject({
      id: "p",
      rootPieceId: "root",
      name: "Tank",
      packId: "lego",
      packVersion: "1",
      now: "2026-10-18T00:00:00Z",
    }),
    loadouts: [
      { id: "a", name: "Basic", exported: receipt("Tank_Basic") },
      { id: "b", name: "Heavy", upgradesFrom: "c" },
      {
        id: "c",
        name: "Medium",
        upgradesFrom: "a",
        exported: receipt("tank_medium"),
      },
    ],
  };
}

const INHERITED = ["armpw"];

describe("variantsOf", () => {
  it("lists the loadouts in upgrade chain order", () => {
    expect(variantsOf(chassis(), FOLDER).map((v) => v.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("gives the lowercased unit name of an exported loadout", () => {
    expect(variantsOf(chassis(), FOLDER)[0].unit).toBe("tank_basic");
  });

  it("gives no unit for a loadout that has not been exported into the game", () => {
    const [, , heavy] = variantsOf(chassis(), FOLDER);
    expect(heavy.unit).toBeNull();
    expect(
      variantsOf(chassis(), "/games/other.sdd").map((v) => v.unit),
    ).toEqual([null, null, null]);
  });
});

describe("withVariantsAdded", () => {
  it("adds all the variants as add operations in chain order", () => {
    const units = variantsOf(chassis(), FOLDER).flatMap((v) =>
      v.unit ? [v.unit] : [],
    );
    const edits = withVariantsAdded(EMPTY_EDITS, "armlab", units, INHERITED);
    expect(edits.menus.armlab).toEqual([
      { op: "add", unit: "tank_basic" },
      { op: "add", unit: "tank_medium" },
    ]);
  });

  it("adds only some of them", () => {
    const edits = withVariantsAdded(
      EMPTY_EDITS,
      "armlab",
      ["tank_medium"],
      INHERITED,
    );
    expect(edits.menus.armlab).toEqual([{ op: "add", unit: "tank_medium" }]);
  });

  it("records what the workshop editor records for one add at a time", () => {
    const viaEditor = addToBuildMenu(
      addToBuildMenu({}, "armlab", "tank_basic", INHERITED),
      "armlab",
      "tank_medium",
      INHERITED,
    );
    const edits = withVariantsAdded(
      EMPTY_EDITS,
      "armlab",
      ["tank_basic", "tank_medium"],
      INHERITED,
    );
    expect(edits.menus).toEqual(viaEditor);
  });

  it("changes nothing for a unit already on the menu", () => {
    expect(withVariantsAdded(EMPTY_EDITS, "armlab", ["armpw"], INHERITED)).toBe(
      EMPTY_EDITS,
    );
  });

  it("keeps the project's other build menus", () => {
    const first = withVariantsAdded(EMPTY_EDITS, "armlab", ["a"], INHERITED);
    const both = withVariantsAdded(first, "armvp", ["b"], []);
    expect(Object.keys(both.menus).sort()).toEqual(["armlab", "armvp"]);
  });
});

describe("withVariantsRemoved", () => {
  it("takes added variants back off, leaving no operations", () => {
    const added = withVariantsAdded(
      EMPTY_EDITS,
      "armlab",
      ["tank_basic", "tank_medium"],
      INHERITED,
    );
    const removed = withVariantsRemoved(
      added,
      "armlab",
      ["tank_basic", "tank_medium"],
      INHERITED,
    );
    expect(removed.menus).toEqual({});
  });

  it("removes one and keeps the other", () => {
    const added = withVariantsAdded(
      EMPTY_EDITS,
      "armlab",
      ["tank_basic", "tank_medium"],
      INHERITED,
    );
    expect(
      withVariantsRemoved(added, "armlab", ["tank_basic"], INHERITED).menus
        .armlab,
    ).toEqual([{ op: "add", unit: "tank_medium" }]);
  });
});

describe("buildersOf", () => {
  it("lists units with a build list or the builder flag, by name", () => {
    expect(
      buildersOf({
        armlab: { name: "Kbot Lab", buildoptions: [] },
        armck: { builder: true },
        armpw: { name: "Peewee" },
      }),
    ).toEqual([
      { key: "armck", name: "armck" },
      { key: "armlab", name: "Kbot Lab" },
    ]);
  });
});

describe("projectForGame", () => {
  const project = (id: string, gameName: string, updatedAt: string) =>
    ({
      id,
      name: id,
      gameName,
      edits: EMPTY_EDITS,
      createdAt: "",
      updatedAt,
    }) as ModProject;

  it("picks the game's most recently written project", () => {
    const projects = [
      project("old", "SF", "2026-01-01"),
      project("new", "SF", "2026-02-01"),
      project("other", "BAR", "2026-03-01"),
    ];
    expect(projectForGame(projects, "SF")?.id).toBe("new");
  });

  it("is undefined when the game has no project", () => {
    expect(projectForGame([project("x", "BAR", "")], "SF")).toBeUndefined();
  });
});
