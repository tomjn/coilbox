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
vi.mock("../content/config", () => ({
  loadUnitsyncUnitDataset: vi.fn(),
}));

import { loadUnitsyncUnitDataset } from "../content/config";
import type { ExportTextures } from "../lego/bindings";
import { type LegoProject, newProject } from "../lego/model";
import {
  type PreparedUnit,
  prepareUnit,
  writePreparedMutator,
} from "../lego/mutator";
import type { LoadedPack } from "../lego/pack";
import type { PlayTarget } from "../play/config";
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
  composeCampaignUnits,
  libraryChanged,
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
  };
}

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
    vi.mocked(loadUnitsyncUnitDataset).mockResolvedValue({
      units: [{ name: "ARMLAB" }],
    } as never);
  });

  it("writes nothing for a campaign with no units", async () => {
    expect(
      await composeCampaignUnits(campaign(), target, {
        name: "BA",
        archive: "ba.sdz",
      }),
    ).toBeNull();
    expect(writePreparedMutator).not.toHaveBeenCalled();
  });

  it("writes the stored copies against the base game the gate resolved", async () => {
    vi.mocked(campaignUnitList).mockResolvedValue({
      units: [stored("tank", false), stored("jeep", true, packAtlas)],
    });

    const result = await composeCampaignUnits(
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
    expect(args.gameMovement?.units).toEqual({ armlab: {} });
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
      composeCampaignUnits(campaign([entry("tank")]), target, {
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
    vi.mocked(loadUnitsyncUnitDataset).mockRejectedValue(new Error("no"));
    await composeCampaignUnits(campaign([entry("tank")]), target, {
      name: "BA",
      archive: "ba.sdz",
    });
    expect(vi.mocked(writePreparedMutator).mock.calls[0][0].gameMovement).toBe(
      null,
    );
  });
});
