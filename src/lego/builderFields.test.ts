import { describe, expect, it } from "vitest";
import type { ModProject } from "@/workshop/project";
import {
  builderFieldMark,
  derivedFieldFor,
  workshopChanges,
  workshopWeaponChanges,
} from "./builderFields";
import type { LegoExport } from "./model";
import { DERIVED_FIELDS } from "./unitDef";

const SPLINTER_FACTION = "Splinter Faction 0.1.89";
const FOLDER = "/games/SplinterFaction.sdd";

const WRITTEN = {
  name: "Rover",
  maxdamage: 1000,
  speed: 90,
  customparams: { corpse: "rover_dead" },
};

function receipt(over: Partial<LegoExport> = {}): LegoExport {
  return {
    dir: FOLDER,
    at: "2026-10-16T00:00:00Z",
    unitName: "rover",
    def: WRITTEN,
    files: [{ path: `${FOLDER}/units/rover.lua`, sha256: "abc" }],
    ...over,
  };
}

describe("derivedFieldFor", () => {
  it("finds a field of DERIVED_FIELDS whatever the case of its key", () => {
    expect(derivedFieldFor("maxDamage")).toBe("maxdamage");
    expect(derivedFieldFor("customParams.corpse")).toBe("customparams.corpse");
    expect(DERIVED_FIELDS).toContain(derivedFieldFor("rspeed"));
  });

  it("finds nothing for a field the builder does not write", () => {
    expect(derivedFieldFor("sightDistance")).toBeUndefined();
  });
});

describe("builderFieldMark", () => {
  it("is set while the file holds what the last export wrote", () => {
    expect(builderFieldMark("maxdamage", WRITTEN, receipt())).toBe("set");
    expect(builderFieldMark("customParams.corpse", WRITTEN, receipt())).toBe(
      "set",
    );
  });

  it("is kept once the file holds something else", () => {
    expect(
      builderFieldMark("maxdamage", { ...WRITTEN, maxdamage: 1400 }, receipt()),
    ).toBe("kept");
  });

  it("is kept when the file lost a field the last export wrote", () => {
    const { speed: _speed, ...file } = WRITTEN;
    expect(builderFieldMark("speed", file, receipt())).toBe("kept");
  });

  it("is null for a field the builder does not write", () => {
    expect(
      builderFieldMark(
        "sightdistance",
        { ...WRITTEN, sightdistance: 400 },
        receipt(),
      ),
    ).toBeNull();
  });

  it("is null when nothing records the builder writing the file", () => {
    expect(
      builderFieldMark("maxdamage", WRITTEN, receipt({ files: [] })),
    ).toBeNull();
  });

  it("is null without the file or the receipt", () => {
    expect(builderFieldMark("maxdamage", undefined, receipt())).toBeNull();
    expect(builderFieldMark("maxdamage", WRITTEN, undefined)).toBeNull();
  });
});

describe("workshopChanges", () => {
  function tweaks(
    overrides: Record<string, unknown>,
    over: Partial<ModProject> = {},
  ): ModProject {
    return {
      id: "tune-1",
      name: "Tuning pass",
      gameName: SPLINTER_FACTION,
      edits: { overrides: { rover: overrides } },
      ...over,
    } as ModProject;
  }

  const changes = (projects: ModProject[], paths = ["maxdamage"]) =>
    workshopChanges(projects, SPLINTER_FACTION, "rover", WRITTEN, paths);

  it("lists a change the file does not hold, with its project and value", () => {
    expect(changes([tweaks({ maxdamage: 1400 })])).toEqual([
      {
        projectId: "tune-1",
        projectName: "Tuning pass",
        path: "maxdamage",
        value: 1400,
        mutatorOnly: false,
      },
    ]);
  });

  it("leaves out a change the file already holds", () => {
    expect(changes([tweaks({ maxdamage: 1000 })])).toEqual([]);
  });

  it("flags a change sent through the mutator", () => {
    const [change] = changes([
      tweaks({ maxdamage: 1400 }, { mutatorOnly: { rover: ["maxdamage"] } }),
    ]);
    expect(change.mutatorOnly).toBe(true);
  });

  it("lists every project that changes the field", () => {
    expect(
      changes([
        tweaks({ maxdamage: 1400 }),
        tweaks({ maxdamage: 1800 }, { id: "tune-2", name: "Bulk" }),
      ]).map((change) => change.projectName),
    ).toEqual(["Tuning pass", "Bulk"]);
  });

  it("matches field paths in any key case and skips other fields", () => {
    expect(
      changes([tweaks({ maxDamage: 1400, speed: 150 })], ["MAXDAMAGE"]),
    ).toHaveLength(1);
  });

  it("skips projects for another game and other units", () => {
    expect(
      changes([
        tweaks({ maxdamage: 1400 }, { gameName: "Balanced Annihilation" }),
      ]),
    ).toEqual([]);
    expect(
      workshopChanges(
        [tweaks({ maxdamage: 1400 })],
        SPLINTER_FACTION,
        "other",
        WRITTEN,
        ["maxdamage"],
      ),
    ).toEqual([]);
  });

  it("says nothing before the unit's file is read", () => {
    expect(
      workshopChanges(
        [tweaks({ maxdamage: 1400 })],
        SPLINTER_FACTION,
        "rover",
        undefined,
        ["maxdamage"],
      ),
    ).toEqual([]);
  });
});

describe("workshopWeaponChanges", () => {
  // Two weapons the unit carries itself: a gun (range 400, 10 damage every
  // second, so 10 per second) and a long rocket (range 700, 60 damage every
  // 3 seconds, so 20 per second).
  const FILE = {
    name: "Rover",
    weapons: [{ name: "rover_gun" }, { name: "rover_rocket" }],
    weapondefs: {
      gun: { range: 400, reloadtime: 1, damage: { default: 10 } },
      rocket: { range: 700, reloadtime: 3, damage: { default: 60 } },
    },
  };

  function project(
    overrides: Record<string, unknown>,
    over: Partial<ModProject> = {},
  ): ModProject {
    return {
      id: "tune-1",
      name: "Tuning pass",
      gameName: SPLINTER_FACTION,
      edits: { overrides: { rover: overrides } },
      ...over,
    } as ModProject;
  }

  const changes = (projects: ModProject[], stat: "range" | "dps") =>
    workshopWeaponChanges(projects, SPLINTER_FACTION, "rover", FILE, {}, stat);

  it("marks the range a project's weapon edit gives, linked to that field", () => {
    expect(
      changes([project({ "weapondefs.rocket.range": 900 })], "range"),
    ).toEqual([
      {
        projectId: "tune-1",
        projectName: "Tuning pass",
        path: "weapondefs.rocket.range",
        value: "900",
        mutatorOnly: false,
      },
    ]);
  });

  it("marks the damage per second a project's weapon edit gives", () => {
    expect(
      changes([project({ "weapondefs.gun.damage.default": 40 })], "dps"),
    ).toEqual([
      {
        projectId: "tune-1",
        projectName: "Tuning pass",
        path: "weapondefs.gun.damage.default",
        value: "60",
        mutatorOnly: false,
      },
    ]);
  });

  it("reads the fields in any key case", () => {
    const [change] = changes(
      [project({ "weaponDefs.Rocket.Range": 900 })],
      "range",
    );
    expect(change.value).toBe("900");
  });

  it("marks only the stat the edit reaches", () => {
    const edits = [project({ "weapondefs.rocket.range": 900 })];
    expect(changes(edits, "dps")).toEqual([]);
    expect(
      changes([project({ "weapondefs.gun.reloadtime": 0.5 })], "range"),
    ).toEqual([]);
  });

  it("leaves out an edit that does not move the longest range", () => {
    expect(
      changes([project({ "weapondefs.gun.range": 500 })], "range"),
    ).toEqual([]);
  });

  it("leaves out an edit to a field neither stat reads", () => {
    const edits = [project({ "weapondefs.gun.areaofeffect": 64 })];
    expect(changes(edits, "range")).toEqual([]);
    expect(changes(edits, "dps")).toEqual([]);
  });

  it("leaves out an edit the file already holds", () => {
    expect(
      changes([project({ "weapondefs.rocket.range": 700 })], "range"),
    ).toEqual([]);
  });

  it("marks a slot that is slaved, which stops its damage counting", () => {
    const [change] = changes([project({ "weapons.1.slaveto": 1 })], "dps");
    expect(change).toMatchObject({ path: "weapons.1.slaveto", value: "10" });
  });

  it("gives one change per project and links the weapon that moved furthest", () => {
    const [change] = changes(
      [
        project({
          "weapondefs.gun.damage.default": 11,
          "weapondefs.rocket.damage.default": 120,
        }),
      ],
      "dps",
    );
    expect(change).toMatchObject({
      path: "weapondefs.rocket.damage.default",
      value: "51",
    });
  });

  it("lists each project that changes a different weapon", () => {
    expect(
      changes(
        [
          project({ "weapondefs.rocket.range": 900 }),
          project(
            { "weapondefs.gun.range": 1000 },
            { id: "tune-2", name: "Bulk" },
          ),
        ],
        "range",
      ).map((change) => [change.projectName, change.path, change.value]),
    ).toEqual([
      ["Tuning pass", "weapondefs.rocket.range", "900"],
      ["Bulk", "weapondefs.gun.range", "1,000"],
    ]);
  });

  it("flags a change sent through the mutator", () => {
    const [change] = changes(
      [
        project(
          { "weapondefs.rocket.range": 900 },
          { mutatorOnly: { rover: ["weapondefs.rocket.range"] } },
        ),
      ],
      "range",
    );
    expect(change.mutatorOnly).toBe(true);
  });

  it("marks a library weapon equipped into a slot", () => {
    const [change] = changes(
      [
        project(
          {},
          {
            edits: {
              ...project({}).edits,
              weapons: {
                long: {
                  key: "long",
                  source: "x",
                  def: { range: 1200, reloadtime: 1, damage: { default: 5 } },
                },
              },
              equipped: { rover: { "0": "long" } },
            },
          },
        ),
      ],
      "range",
    );
    expect(change).toMatchObject({ path: "weapons.0.name", value: "1,200" });
  });

  it("skips projects for another game", () => {
    expect(
      changes(
        [
          project(
            { "weapondefs.rocket.range": 900 },
            { gameName: "Balanced Annihilation" },
          ),
        ],
        "range",
      ),
    ).toEqual([]);
  });

  it("says nothing before the unit's file or the game's weapons are read", () => {
    const edits = [project({ "weapondefs.rocket.range": 900 })];
    const read = (
      file: Record<string, unknown> | undefined,
      weaponDefs: Record<string, Record<string, unknown>> | undefined,
    ) =>
      workshopWeaponChanges(
        edits,
        SPLINTER_FACTION,
        "rover",
        file,
        weaponDefs,
        "range",
      );
    expect(read(undefined, {})).toEqual([]);
    expect(read(FILE, undefined)).toEqual([]);
  });
});
