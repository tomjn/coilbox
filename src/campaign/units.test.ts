import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./bindings", () => ({
  campaignUnitSave: vi.fn(),
  campaignUnitList: vi.fn(),
  campaignUnitDelete: vi.fn(),
}));
vi.mock("../lego/mutator", () => ({
  prepareUnit: vi.fn(),
  writePreparedMutator: vi.fn(),
}));
vi.mock("../lego/bindings", () => ({
  legoScratchRemove: vi.fn(),
}));
vi.mock("../workshop/config", () => ({
  loadUnitDefs: vi.fn(),
}));

import { type ExportTextures, legoScratchRemove } from "../lego/bindings";
import { type LegoProject, newProject } from "../lego/model";
import {
  type PreparedUnit,
  prepareUnit,
  writePreparedMutator,
} from "../lego/mutator";
import type { LoadedPack } from "../lego/pack";
import { renderUnitDef } from "../lego/unitDef";
import type { PlayTarget } from "../play/config";
import { loadUnitDefs } from "../workshop/config";
import {
  campaignUnitDelete,
  campaignUnitList,
  campaignUnitSave,
} from "./bindings";
import type { Campaign, CampaignUnit } from "./model";
import {
  attachRefusal,
  attachUnit,
  type CampaignUnitCopy,
  composeUnits,
  libraryChanged,
  removeUnitsGame,
  updateUnit,
  withoutUnit,
  withUnit,
} from "./units";

const target = {
  enginePath: "/engine",
  dataDir: "/data",
  executable: "/engine/spring",
} as PlayTarget;

const pack = {} as LoadedPack;

function project(
  unitName: string,
  extra: Partial<LegoProject> = {},
): LegoProject {
  return {
    ...newProject({
      id: `p-${unitName}`,
      rootPieceId: "root",
      name: `The ${unitName}`,
      packId: "lego",
      packVersion: "1",
      now: "2026-10-01T00:00:00Z",
    }),
    unitName,
    ...extra,
  };
}

function prepared(
  unitName: string,
  textures: ExportTextures | null,
): PreparedUnit {
  return {
    payload: {
      unitName,
      textures,
      overwriteTexture: false,
      script: "-- script",
      scriptWritten: null,
      pieceCollision: "",
      unitDef: `-- ${unitName}`,
      unitDefFields: null,
      text: null,
      model: {} as PreparedUnit["payload"]["model"],
    },
    textures: JSON.stringify(textures),
    textureFiles: [],
    weaponsLeftOut: [],
  };
}

const baseAtlas: ExportTextures = {
  atlas: { name: "atlas.png", pack: null, writeAs: "coilbox_atlas.png" },
  stored: [],
};
const packAtlas: ExportTextures = {
  atlas: { name: "camo.png", pack: "camo-pack", writeAs: "coilbox_camo.png" },
  stored: [],
};

function campaign(units?: CampaignUnit[]): Campaign {
  return {
    schemaVersion: 1,
    id: "c1",
    type: "ta",
    title: "A Campaign",
    description: "",
    missions: [],
    ...(units ? { units } : {}),
    createdAt: "",
    updatedAt: "",
  };
}

function entry(unitName: string, extra: Partial<CampaignUnit> = {}) {
  return {
    unitName,
    projectId: `p-${unitName}`,
    name: `The ${unitName}`,
    builtBy: [],
    copiedAt: "2026-10-02T00:00:00Z",
    ...extra,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(campaignUnitSave).mockResolvedValue({ dir: "/copies/x" });
  vi.mocked(campaignUnitDelete).mockResolvedValue({ deleted: true });
});

describe("attaching a unit", () => {
  it("builds the unit with no game in it and stores the copy", async () => {
    vi.mocked(prepareUnit).mockResolvedValue(prepared("tank", baseAtlas));
    const tank = project("tank", { builtBy: ["armlab"] });

    const unit = await attachUnit(
      campaign(),
      { project: tank, pack, raw: null, workshopProjects: [] },
      "2026-10-03T00:00:00Z",
    );

    expect(prepareUnit).toHaveBeenCalledWith(
      {
        baseGame: "",
        workshopProjects: [],
        gameWeapons: null,
        gameMovement: null,
      },
      { project: tank, pack, raw: null },
    );
    expect(unit).toEqual({
      unitName: "tank",
      projectId: "p-tank",
      name: "The tank",
      builtBy: ["armlab"],
      copiedAt: "2026-10-03T00:00:00Z",
    });
    const saved = vi.mocked(campaignUnitSave).mock.calls[0][0];
    expect(saved).toMatchObject({ campaignId: "c1", unitName: "tank" });
    const copy = JSON.parse(saved.json) as CampaignUnitCopy;
    expect(copy.source).toEqual(tank);
    expect(copy.built.payload.unitDef).toBe("-- tank");
    expect(copy.built.payload.script).toBe("-- script");
  });

  it("leaves the bundled atlas behind", async () => {
    vi.mocked(prepareUnit).mockResolvedValue(prepared("tank", baseAtlas));
    await attachUnit(campaign(), {
      project: project("tank"),
      pack,
      raw: null,
      workshopProjects: [],
    });
    const saved = vi.mocked(campaignUnitSave).mock.calls[0][0];
    expect(saved.atlas).toBeNull();
    expect(saved.stored).toEqual([]);
    expect((JSON.parse(saved.json) as CampaignUnitCopy).carriesTextures).toBe(
      false,
    );
  });

  it("carries an atlas pack's atlas and an imported unit's textures", async () => {
    vi.mocked(prepareUnit).mockResolvedValueOnce(prepared("tank", packAtlas));
    await attachUnit(campaign(), {
      project: project("tank"),
      pack,
      raw: null,
      workshopProjects: [],
    });
    expect(vi.mocked(campaignUnitSave).mock.calls[0][0].atlas).toEqual({
      pack: "camo-pack",
      name: "camo.png",
    });

    vi.mocked(prepareUnit).mockResolvedValueOnce(
      prepared("jeep", {
        atlas: null,
        stored: [{ key: "abc.png", writeAs: "jeep.png" }],
      }),
    );
    await attachUnit(campaign(), {
      project: project("jeep"),
      pack,
      raw: null,
      workshopProjects: [],
    });
    const saved = vi.mocked(campaignUnitSave).mock.calls[1][0];
    expect(saved.stored).toEqual(["abc.png"]);
    expect((JSON.parse(saved.json) as CampaignUnitCopy).carriesTextures).toBe(
      true,
    );
  });

  it("refuses a second document using a unit name already attached", async () => {
    const other = project("tank", { id: "p-other", name: "Other tank" });
    expect(attachRefusal(campaign([entry("tank")]), other)).toBe(
      "The tank is already attached as tank. Rename one of them in the unit builder.",
    );
    await expect(
      attachUnit(campaign([entry("tank")]), {
        project: other,
        pack,
        raw: null,
        workshopProjects: [],
      }),
    ).rejects.toThrow("already attached");
    expect(campaignUnitSave).not.toHaveBeenCalled();
  });

  it("refuses a unit with no name a game can load", () => {
    expect(attachRefusal(campaign(), project(""))).toContain(
      "has no unit name",
    );
  });
});

describe("updating a unit from the library", () => {
  it("is the only thing that changes a copy: a library edit only marks it", () => {
    const unit = entry("tank");
    expect(
      libraryChanged(
        unit,
        project("tank", { updatedAt: "2026-10-05T00:00:00Z" }),
      ),
    ).toBe(true);
    expect(
      libraryChanged(
        unit,
        project("tank", { updatedAt: "2026-10-01T00:00:00Z" }),
      ),
    ).toBe(false);
    expect(libraryChanged(unit, undefined)).toBe(false);
  });

  it("takes a fresh copy and keeps the unit's place in the list", async () => {
    vi.mocked(prepareUnit).mockResolvedValue(prepared("tank", baseAtlas));
    const before = campaign([entry("jeep"), entry("tank"), entry("ship")]);

    const { unit, replaces } = await updateUnit(
      before,
      {
        project: project("tank", { builtBy: ["armvp"] }),
        pack,
        raw: null,
        workshopProjects: [],
      },
      "2026-10-06T00:00:00Z",
    );

    expect(replaces).toBeNull();
    expect(campaignUnitSave).toHaveBeenCalledTimes(1);
    const after = withUnit(before, unit);
    expect(after.units?.map((u) => u.unitName)).toEqual([
      "jeep",
      "tank",
      "ship",
    ]);
    expect(after.units?.[1]).toMatchObject({
      builtBy: ["armvp"],
      copiedAt: "2026-10-06T00:00:00Z",
    });
  });

  it("names the old copy to remove when the unit was renamed", async () => {
    vi.mocked(prepareUnit).mockResolvedValue(prepared("tank2", baseAtlas));
    const { unit, replaces } = await updateUnit(campaign([entry("tank")]), {
      project: project("tank2", { id: "p-tank" }),
      pack,
      raw: null,
      workshopProjects: [],
    });
    expect(replaces).toBe("tank");
    expect(unit.unitName).toBe("tank2");
    // Removed by the caller once the document naming the new copy is saved.
    expect(campaignUnitDelete).not.toHaveBeenCalled();
  });

  it("refuses a unit that is not attached", async () => {
    await expect(
      updateUnit(campaign(), {
        project: project("tank"),
        pack,
        raw: null,
        workshopProjects: [],
      }),
    ).rejects.toThrow("is not attached");
  });

  it("drops the field when the last unit is removed", () => {
    expect(
      withoutUnit(campaign([entry("tank")]), "tank").units,
    ).toBeUndefined();
  });
});

function stored(
  unitName: string,
  carriesTextures: boolean,
  textures = baseAtlas,
  files: string[] = [],
) {
  const copy: CampaignUnitCopy = {
    formatVersion: 1,
    unitName,
    projectId: `p-${unitName}`,
    copiedAt: "",
    source: project(unitName),
    built: prepared(unitName, textures),
    carriesTextures,
  };
  return {
    unitName,
    json: JSON.stringify(copy),
    dir: `/app/campaign/units/c1/${unitName}`,
    files,
  };
}

/** The unit-defs read of a base game with these movement classes. */
function gameDefs(classes: string[]) {
  const units: Record<string, Record<string, unknown>> = { armlab: {} };
  for (const name of classes) {
    units[`unit_${name.toLowerCase()}`] = {
      canmove: true,
      movementclass: name,
      speed: 72,
      turnrate: 500,
    };
  }
  return {
    units,
    moveDefs: classes.map((name) => ({ name, footprintx: 3 })),
    weaponDefs: {},
    armorDefs: {},
    unitErrors: [],
    errors: [],
  } as never;
}

/** A stored copy of a unit built as a building, with parts that say how it should move. */
function building(
  unitName: string,
  role: string,
  extra: Partial<LegoProject> = {},
) {
  const source = project(unitName, extra);
  source.pieces = [
    ...source.pieces,
    { ...source.pieces[0], id: "mover", parentId: source.rootPieceId, role },
  ];
  const def = {
    unitname: unitName,
    footprintx: 3,
    footprintz: 3,
    canmove: false,
    maxslope: 15,
  };
  const built = prepared(unitName, baseAtlas);
  built.payload.unitDef = renderUnitDef(unitName, def);
  built.def = def;
  const copy: CampaignUnitCopy = {
    formatVersion: 1,
    unitName,
    projectId: `p-${unitName}`,
    copiedAt: "",
    source,
    built,
    carriesTextures: false,
  };
  return {
    unitName,
    json: JSON.stringify(copy),
    dir: `/app/campaign/units/c1/${unitName}`,
    files: [] as string[],
  };
}

describe("a unit built to move", () => {
  beforeEach(() => {
    vi.mocked(writePreparedMutator).mockResolvedValue({
      dir: "/data/games/coilbox-lego-campaign-c1.sdd",
      name: "Coilbox campaign c1",
      skipped: false,
      units: [],
      buildListLeftOut: [],
    });
  });

  const base = { name: "Splinter Faction", archive: "sf.sdz" };

  it("takes the base game's walker class for legs and its wheeled class for wheels", async () => {
    vi.mocked(loadUnitDefs).mockResolvedValue(gameDefs(["KBOT3", "TANK2"]));
    vi.mocked(campaignUnitList).mockResolvedValue({
      units: [building("walker", "leg.l1.thigh"), building("rover", "wheel")],
    });

    const result = await composeUnits(
      campaign([entry("walker"), entry("rover")]),
      target,
      base,
    );

    const [walker, rover] =
      vi.mocked(writePreparedMutator).mock.calls[0][0].prepared;
    expect(walker.payload.unitDef).toContain('movementclass = "KBOT3"');
    expect(walker.payload.unitDef).toContain("canmove = true");
    expect(walker.payload.unitDef).not.toContain("canmove = false");
    expect(walker.payload.unitDef).not.toContain("maxslope");
    expect(rover.payload.unitDef).toContain('movementclass = "TANK2"');
    expect(result?.leftOut).toEqual([]);
  });

  it("names the unit in the left out lines when the base game has no class for it", async () => {
    vi.mocked(loadUnitDefs).mockResolvedValue(gameDefs(["SHIP3"]));
    vi.mocked(campaignUnitList).mockResolvedValue({
      units: [building("walker", "leg.l1.thigh")],
    });

    const result = await composeUnits(
      campaign([entry("walker")]),
      target,
      base,
    );

    const [walker] = vi.mocked(writePreparedMutator).mock.calls[0][0].prepared;
    expect(walker.payload.unitDef).toContain("canmove = false");
    expect(result?.leftOut).toHaveLength(1);
    expect(result?.leftOut[0]).toContain("The walker");
    expect(result?.leftOut[0]).toContain("Splinter Faction");
  });

  it("names the unit when the base game's classes could not be read", async () => {
    vi.mocked(loadUnitDefs).mockRejectedValue(new Error("no"));
    vi.mocked(campaignUnitList).mockResolvedValue({
      units: [building("rover", "wheel")],
    });

    const result = await composeUnits(campaign([entry("rover")]), target, base);

    expect(result?.leftOut).toHaveLength(1);
    expect(result?.leftOut[0]).toContain("The rover");
  });

  it("leaves a unit with nothing that moves, and one with its own class, as it was", async () => {
    vi.mocked(loadUnitDefs).mockResolvedValue(gameDefs(["KBOT3"]));
    vi.mocked(campaignUnitList).mockResolvedValue({
      units: [
        building("turret", "turret"),
        building("picked", "leg.l1.thigh", {
          movement: { moveClass: "KBOT3", speed: 10 },
        }),
      ],
    });

    const result = await composeUnits(
      campaign([entry("turret"), entry("picked")]),
      target,
      base,
    );

    const [turret, picked] =
      vi.mocked(writePreparedMutator).mock.calls[0][0].prepared;
    expect(turret.payload.unitDef).toContain("canmove = false");
    // Its own class is already in the copy's definition, not added again here.
    expect(picked.payload.unitDef).toContain("canmove = false");
    expect(result?.leftOut).toEqual([]);
  });
});

describe("composing a mission's mutator", () => {
  beforeEach(() => {
    vi.mocked(writePreparedMutator).mockResolvedValue({
      dir: "/data/games/coilbox-lego-campaign-c1.sdd",
      name: "Coilbox campaign c1",
      skipped: false,
      units: [],
      buildListLeftOut: [
        "Beyond All Reason loads its units without reading a build list",
      ],
    });
    vi.mocked(loadUnitDefs).mockResolvedValue(gameDefs(["KBOT3"]));
  });

  it("writes nothing for a campaign with no units", async () => {
    expect(
      await composeUnits(campaign(), target, {
        name: "BA",
        archive: "ba.sdz",
      }),
    ).toBeNull();
    expect(writePreparedMutator).not.toHaveBeenCalled();
  });

  it("writes the stored copies against the base game the gate resolved", async () => {
    vi.mocked(campaignUnitList).mockResolvedValue({
      units: [
        stored("tank", false),
        stored("jeep", true, packAtlas, ["camo.png"]),
      ],
    });

    const result = await composeUnits(
      campaign([entry("tank", { builtBy: ["armlab"] }), entry("jeep")]),
      target,
      { name: "Splinter Faction v0.1.86", archive: "sf.sdz" },
    );

    expect(result).toEqual({
      name: "Coilbox campaign c1",
      leftOut: [
        "Beyond All Reason loads its units without reading a build list",
      ],
    });
    const args = vi.mocked(writePreparedMutator).mock.calls[0][0];
    expect(args.folder).toBe("coilbox-lego-campaign-c1.sdd");
    expect(args.baseGame).toBe("Splinter Faction v0.1.86");
    expect(args.baseArchive).toBe("sf.sdz");
    expect(args.builtBy).toEqual([
      { unitName: "tank", builtBy: ["armlab"] },
      { unitName: "jeep", builtBy: [] },
    ]);
    // Builders are checked against the base game's own units.
    expect(Object.keys(args.gameMovement?.units ?? {})).toContain("armlab");
    // A copy on the bundled atlas reads it from the pack as it always did.
    expect(args.prepared[0].payload.textures).toEqual(baseAtlas);
    // A copy that carries its atlas has it read out of its own folder.
    expect(args.prepared[1].payload.textures).toEqual({
      atlas: { name: "camo.png", pack: null, writeAs: "coilbox_camo.png" },
      stored: [],
      sourceDir: "/app/campaign/units/c1/jeep",
    });
  });

  it("refuses when a unit's copy is missing", async () => {
    vi.mocked(campaignUnitList).mockResolvedValue({ units: [] });
    await expect(
      composeUnits(campaign([entry("tank")]), target, {
        name: "BA",
        archive: "ba.sdz",
      }),
    ).rejects.toThrow(
      "This campaign's copy of The tank is missing. Attach it again from the unit builder.",
    );
    expect(writePreparedMutator).not.toHaveBeenCalled();
  });

  it("leaves builders unchecked when the game's units will not read", async () => {
    vi.mocked(campaignUnitList).mockResolvedValue({
      units: [stored("tank", false)],
    });
    vi.mocked(loadUnitDefs).mockRejectedValue(new Error("no"));
    await composeUnits(campaign([entry("tank")]), target, {
      name: "BA",
      archive: "ba.sdz",
    });
    expect(vi.mocked(writePreparedMutator).mock.calls[0][0].gameMovement).toBe(
      null,
    );
  });
});

describe("deleting a campaign's units game", () => {
  beforeEach(() => {
    vi.mocked(legoScratchRemove).mockResolvedValue({ removed: true });
  });

  it("removes that campaign's folder from the content root", async () => {
    await removeUnitsGame("c1", "/data");
    expect(legoScratchRemove).toHaveBeenCalledTimes(1);
    expect(legoScratchRemove).toHaveBeenCalledWith({
      dataDir: "/data",
      folder: "coilbox-lego-campaign-c1.sdd",
    });
  });

  it("asks the guard about no other campaign's folder", async () => {
    await removeUnitsGame("c2", "/data");
    expect(legoScratchRemove).toHaveBeenCalledWith({
      dataDir: "/data",
      folder: "coilbox-lego-campaign-c2.sdd",
    });
  });

  it("does nothing for an id that cannot name a folder, so none was ever written", async () => {
    await removeUnitsGame("not/a/folder", "/data");
    expect(legoScratchRemove).not.toHaveBeenCalled();
  });

  it("lets a refusal through, so the campaign is not deleted over a folder that stayed", async () => {
    vi.mocked(legoScratchRemove).mockRejectedValue(new Error("refused"));
    await expect(removeUnitsGame("c1", "/data")).rejects.toThrow("refused");
  });
});
