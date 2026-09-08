import { describe, expect, it } from "vitest";
import { LEGO_SCHEMA_VERSION, type LegoProject } from "@/lego/model";
import { addClone, deriveClone, type UnitClones } from "./clones";
import { setUnitDisabled } from "./disabled";
import { exportedInto, withLegoUnits } from "./legoUnits";
import { overrideCount, setOverride, type UnitOverrides } from "./overrides";

/** A unit shaped the way Balanced Annihilation writes one: keys lowercased. */
const ARMCOM: Record<string, unknown> = {
  name: "Commander",
  health: 3000,
  movementclass: "ARMCOMKBOT",
};

const GAME = { armcom: ARMCOM, armpw: { name: "Peewee", health: 300 } };

const BA_FOLDER = "/Users/someone/.spring/games/BA.sdd";

/**
 * The definition `legoUnitDef` generates, as the export receipt stores it. Not
 * imported from the builder: this is the shape the workshop is handed, and a
 * test that derived it again would stop checking the join and start checking
 * the generator.
 */
const BUILT_DEF: Record<string, unknown> = {
  name: "Sky Fortress",
  description: "Sky Fortress, built with coilbox's unit builder.",
  objectname: "skyfort",
  script: "skyfort.lua",
  footprintx: 4,
  footprintz: 4,
  maxdamage: 1000,
  canmove: false,
};

function project(over: Partial<LegoProject> = {}): LegoProject {
  return {
    schemaVersion: LEGO_SCHEMA_VERSION,
    id: "proj-1",
    name: "Sky Fortress",
    unitName: "skyfort",
    packId: "base",
    packVersion: "1",
    createdAt: "",
    updatedAt: "",
    rootPieceId: "root",
    pieces: [],
    exported: {
      dir: BA_FOLDER,
      at: "2026-09-07T12:00:00.000Z",
      unitName: "skyfort",
      def: BUILT_DEF,
    },
    ...over,
  };
}

describe("exportedInto", () => {
  it("matches the game folder the export was written into", () => {
    expect(exportedInto(project(), BA_FOLDER)).toBe(true);
  });

  it("ignores a project that has never been exported", () => {
    expect(exportedInto(project({ exported: undefined }), BA_FOLDER)).toBe(
      false,
    );
  });

  it("does not put one game's unit into another game", () => {
    expect(exportedInto(project(), "/Users/someone/.spring/games/SF.sdd")).toBe(
      false,
    );
  });

  /**
   * The picker and the scan describe one directory and neither promises the
   * other's spelling, so a trailing separator, a Windows separator or a
   * different case must not lose the unit.
   */
  it("reads one folder written two ways as one folder", () => {
    expect(exportedInto(project(), `${BA_FOLDER}/`)).toBe(true);
    expect(
      exportedInto(
        project({
          exported: {
            dir: "C:\\games\\BA.sdd\\",
            at: "",
            unitName: "skyfort",
            def: BUILT_DEF,
          },
        }),
        "C:/Games/BA.sdd",
      ),
    ).toBe(true);
  });

  it("says nothing about a game whose archive has no path", () => {
    expect(exportedInto(project(), undefined)).toBe(false);
  });
});

describe("withLegoUnits", () => {
  const clones: UnitClones = {};

  it("attributes a unit exported into this game to the project that built it", () => {
    const { builtBy, conflicts } = withLegoUnits(
      clones,
      [project()],
      BA_FOLDER,
      GAME,
    );
    expect(builtBy).toEqual({
      skyfort: {
        kind: "lego",
        projectId: "proj-1",
        projectName: "Sky Fortress",
      },
    });
    expect(conflicts).toEqual([]);
  });

  it("keys the attribution lowercased, the way every unit key is", () => {
    const { builtBy } = withLegoUnits(
      clones,
      [
        project({
          exported: {
            dir: BA_FOLDER,
            at: "",
            unitName: "SkyFort",
            def: BUILT_DEF,
          },
        }),
      ],
      BA_FOLDER,
      GAME,
    );
    expect(Object.keys(builtBy)).toEqual(["skyfort"]);
  });

  /**
   * The case driving the app turned up. `units/<name>.lua` is a file in the
   * game, so the engine reads it like any other and the game's own table has
   * the unit already. Putting the receipt in front of that would show a
   * definition generated at export time rather than the file as it now is,
   * which the export deliberately never overwrites so it can be edited.
   */
  it("does not stand a receipt in front of the game's own definition", () => {
    const withUnit = {
      ...GAME,
      skyfort: { name: "Hand edited", health: 9000 },
    };
    const { clones: out, builtBy } = withLegoUnits(
      clones,
      [project()],
      BA_FOLDER,
      withUnit,
    );
    expect(out).toBe(clones);
    expect(Object.keys(builtBy)).toEqual(["skyfort"]);
  });

  /**
   * unitsync caches an archive, and a new file inside a `.sdd` does not always
   * invalidate it, so the unit can be on disk and missing from the read.
   */
  it("stands the receipt in when the game's read has not caught up", () => {
    const { clones: out } = withLegoUnits(clones, [project()], BA_FOLDER, GAME);
    expect(Object.keys(out)).toEqual(["skyfort"]);
    expect(out.skyfort.def).toEqual(BUILT_DEF);
    expect(out.skyfort.source).toBeUndefined();
    // Nothing was replaced: the game's read has no unit of this name.
    expect(out.skyfort.replacesGameUnit).toBe(false);
  });

  it("leaves the clone set alone when nothing was exported here", () => {
    const { clones: out, builtBy } = withLegoUnits(
      clones,
      [project()],
      undefined,
      GAME,
    );
    expect(out).toBe(clones);
    expect(builtBy).toEqual({});
  });

  /**
   * The point of the whole design. Exporting the same project twice writes one
   * receipt, so there is one clone to derive, whatever the export did before.
   */
  it("gives a project re-exported under a new name one unit, not two", () => {
    const renamed = project({
      unitName: "skyfort2",
      exported: {
        dir: BA_FOLDER,
        at: "2026-09-08T12:00:00.000Z",
        unitName: "skyfort2",
        def: { ...BUILT_DEF, objectname: "skyfort2" },
      },
    });
    const { clones: out } = withLegoUnits(clones, [renamed], BA_FOLDER, GAME);
    expect(Object.keys(out)).toEqual(["skyfort2"]);
  });

  it("keeps two different projects apart", () => {
    const other = project({
      id: "proj-2",
      name: "Gun Tower",
      unitName: "guntower",
      exported: {
        dir: BA_FOLDER,
        at: "",
        unitName: "guntower",
        def: BUILT_DEF,
      },
    });
    const { clones: out } = withLegoUnits(
      clones,
      [project(), other],
      BA_FOLDER,
      GAME,
    );
    expect(Object.keys(out).sort()).toEqual(["guntower", "skyfort"]);
  });

  /**
   * A unit copied on the page is live work, and an export is a file that will
   * still be there tomorrow, so the copy keeps the name and the built unit is
   * named rather than dropped.
   */
  it("reports a built unit whose name a copied unit already holds", () => {
    const mine = addClone(
      {},
      deriveClone({
        key: "skyfort",
        source: "armcom",
        sourceDef: ARMCOM,
        displayName: "My Fort",
        replacesGameUnit: false,
      }),
    );
    const { clones: out, conflicts } = withLegoUnits(
      mine,
      [project()],
      BA_FOLDER,
      GAME,
    );
    expect(out.skyfort.source).toBe("armcom");
    expect(conflicts).toEqual(["Sky Fortress"]);
  });

  it("reports the second of two projects exported under one name", () => {
    const twin = project({ id: "proj-2", name: "Twin" });
    const { conflicts } = withLegoUnits(
      clones,
      [project(), twin],
      BA_FOLDER,
      GAME,
    );
    expect(conflicts).toEqual(["Twin"]);
  });
});

/**
 * The half of issue #2651 that is about where things are kept. A unit built in
 * the lego builder is a whole definition, so it is a clone and nothing else:
 * putting it anywhere near the override set would break the sparseness the
 * whole workshop rests on, and putting a mark against it would be a second
 * store saying the same thing.
 */
describe("an exported unit lands in the clone set and nowhere else", () => {
  it("writes no override, and leaves the other stores untouched", () => {
    let overrides: UnitOverrides = {};
    const disabled = setUnitDisabled([], "armpw", true);

    const { clones } = withLegoUnits({}, [project()], BA_FOLDER, GAME);

    expect(clones.skyfort.def).toEqual(BUILT_DEF);
    expect(overrides).toEqual({});
    expect(overrideCount(overrides)).toBe(0);
    // The other stores are exactly what they were before the unit arrived.
    expect(disabled).toEqual(["armpw"]);

    // And editing it afterwards is an ordinary sparse override against the
    // clone's own definition, the same as editing any other unit.
    overrides = setOverride(
      overrides,
      "skyfort",
      "maxdamage",
      2000,
      clones.skyfort.def.maxdamage,
    );
    expect(overrides).toEqual({ skyfort: { maxdamage: 2000 } });
  });
});
