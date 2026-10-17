import { describe, expect, it } from "vitest";
import type { ModProject } from "@/workshop/project";
import {
  builderFieldMark,
  derivedFieldFor,
  workshopChanges,
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
