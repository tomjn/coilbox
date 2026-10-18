/**
 * Units from the unit builder carried by a conquest or a warpath run (issue
 * #4518): copies kept with each mode's own data, the mutator a battle launches
 * through, and what removing a conquest or run takes with it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./bindings", () => ({
  campaignUnitSave: vi.fn(),
  campaignUnitList: vi.fn(),
  campaignUnitDelete: vi.fn(),
  campaignUnitsDelete: vi.fn(),
}));
vi.mock("../lego/mutator", () => ({
  prepareUnit: vi.fn(),
  writePreparedMutator: vi.fn(),
}));
vi.mock("../lego/bindings", () => ({ legoScratchRemove: vi.fn() }));
vi.mock("../lego/pack", () => ({ loadPack: vi.fn() }));
vi.mock("../lego/rawGeometry", () => ({ loadRawGeometryIfAny: vi.fn() }));
vi.mock("../workshop/config", () => ({ loadUnitDefs: vi.fn() }));
vi.mock("../lib/storedSetting", () => ({ readStoredSetting: vi.fn() }));
vi.mock("../content/contentState", () => ({ loadContentState: vi.fn() }));

import { loadContentState } from "../content/contentState";
import { legoScratchRemove } from "../lego/bindings";
import { type LegoProject, newProject } from "../lego/model";
import {
  type PreparedUnit,
  prepareUnit,
  writePreparedMutator,
} from "../lego/mutator";
import { type LoadedPack, loadPack } from "../lego/pack";
import { loadRawGeometryIfAny } from "../lego/rawGeometry";
import { readStoredSetting } from "../lib/storedSetting";
import type { PlayTarget } from "../play/config";
import { loadUnitDefs } from "../workshop/config";
import {
  campaignUnitList,
  campaignUnitSave,
  campaignUnitsDelete,
} from "./bindings";
import {
  attachUnit,
  type CampaignUnitCopy,
  carryUnits,
  composeUnits,
  discardUnits,
  libraryChanged,
} from "./units";

const pack = {} as LoadedPack;
const target = {
  enginePath: "/engine",
  dataDir: "/data",
  executable: "/engine/spring",
} as PlayTarget;

function project(unitName: string, extra: Partial<LegoProject> = {}) {
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

function prepared(unitName: string): PreparedUnit {
  return {
    payload: {
      unitName,
      textures: null,
      overwriteTexture: false,
      script: "-- script",
      scriptWritten: null,
      pieceCollision: "",
      unitDef: `-- ${unitName}`,
      unitDefFields: null,
      text: null,
      model: {} as PreparedUnit["payload"]["model"],
    },
    textures: "null",
    textureFiles: [],
    weaponsLeftOut: [],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(campaignUnitSave).mockResolvedValue({ dir: "/copies/x" });
  vi.mocked(campaignUnitsDelete).mockResolvedValue({ deleted: true });
  vi.mocked(prepareUnit).mockImplementation(async (_ctx, unit) =>
    prepared(unit.project.unitName),
  );
  vi.mocked(loadPack).mockResolvedValue(pack);
  vi.mocked(loadRawGeometryIfAny).mockResolvedValue(null);
  vi.mocked(readStoredSetting).mockReturnValue([]);
  vi.mocked(legoScratchRemove).mockResolvedValue({ removed: true });
});

describe("attaching a unit to a conquest or a run", () => {
  it("stores a copy of the unit as it is now, with the conquest's data", async () => {
    const tank = project("tank", { builtBy: ["armlab"] });
    const unit = await attachUnit(
      { scope: "conquest", id: "generated-7" },
      { project: tank, pack, raw: null, workshopProjects: [] },
      "2026-10-18T00:00:00Z",
    );

    const saved = vi.mocked(campaignUnitSave).mock.calls[0][0];
    expect(saved).toMatchObject({
      campaignId: "generated-7",
      scope: "conquest",
      unitName: "tank",
    });
    // Editing the unit in the builder afterwards leaves the copy as it was,
    // and only marks it as changed.
    tank.name = "Renamed tank";
    tank.updatedAt = "2026-10-19T00:00:00Z";
    const copy = JSON.parse(saved.json) as CampaignUnitCopy;
    expect(copy.source.name).toBe("The tank");
    expect(copy.built.payload.unitDef).toBe("-- tank");
    expect(unit.name).toBe("The tank");
    expect(libraryChanged(unit, tank)).toBe(true);
  });
});

describe("carrying units into a new conquest or run", () => {
  it("clears what an earlier one left, then copies each unit in order", async () => {
    const units = await carryUnits(
      { scope: "warpath", id: "run-1" },
      [project("tank"), project("jeep", { builtBy: ["armvp"] })],
      "2026-10-18T00:00:00Z",
    );

    expect(
      vi.mocked(campaignUnitsDelete).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(campaignUnitSave).mock.invocationCallOrder[0]);
    expect(campaignUnitsDelete).toHaveBeenCalledWith({
      campaignId: "run-1",
      scope: "warpath",
    });
    expect(
      vi
        .mocked(campaignUnitSave)
        .mock.calls.map(([c]) => [c.scope, c.unitName]),
    ).toEqual([
      ["warpath", "tank"],
      ["warpath", "jeep"],
    ]);
    expect(units).toEqual([
      {
        unitName: "tank",
        projectId: "p-tank",
        name: "The tank",
        builtBy: [],
        copiedAt: "2026-10-18T00:00:00Z",
      },
      {
        unitName: "jeep",
        projectId: "p-jeep",
        name: "The jeep",
        builtBy: ["armvp"],
        copiedAt: "2026-10-18T00:00:00Z",
      },
    ]);
  });

  it("refuses two units with one unit name, and leaves no copies behind", async () => {
    await expect(
      carryUnits({ scope: "conquest", id: "g1" }, [
        project("tank"),
        project("tank", { id: "p-other", name: "Other tank" }),
      ]),
    ).rejects.toThrow("already attached as tank");
    // Once before copying, and once to take back the first copy.
    expect(campaignUnitsDelete).toHaveBeenCalledTimes(2);
  });
});

describe("composing a run's mutator", () => {
  it("writes the run's copies into a folder of its own", async () => {
    const copy: CampaignUnitCopy = {
      formatVersion: 1,
      unitName: "tank",
      projectId: "p-tank",
      copiedAt: "",
      source: project("tank"),
      built: prepared("tank"),
      carriesTextures: false,
    };
    vi.mocked(campaignUnitList).mockResolvedValue({
      units: [
        {
          unitName: "tank",
          json: JSON.stringify(copy),
          dir: "/app/runlite/units/run-1/tank",
          files: [],
        },
      ],
    });
    vi.mocked(loadUnitDefs).mockRejectedValue(new Error("not read"));
    vi.mocked(writePreparedMutator).mockResolvedValue({
      dir: "/data/games/coilbox-lego-run-run-1.sdd",
      name: "Coilbox run units",
      skipped: false,
      units: [],
      buildListLeftOut: [],
    });

    const result = await composeUnits(
      {
        scope: "warpath",
        id: "run-1",
        units: [
          {
            unitName: "tank",
            projectId: "p-tank",
            name: "The tank",
            builtBy: ["armlab"],
            copiedAt: "",
          },
        ],
      },
      target,
      { name: "Splinter Faction", archive: "sf.sdz" },
    );

    expect(campaignUnitList).toHaveBeenCalledWith({
      campaignId: "run-1",
      scope: "warpath",
    });
    const args = vi.mocked(writePreparedMutator).mock.calls[0][0];
    expect(args.folder).toBe("coilbox-lego-run-run-1.sdd");
    expect(args.baseGame).toBe("Splinter Faction");
    expect(args.builtBy).toEqual([{ unitName: "tank", builtBy: ["armlab"] }]);
    expect(result?.name).toBe("Coilbox run units");
  });

  it("names the conquest when a copy is missing", async () => {
    vi.mocked(campaignUnitList).mockResolvedValue({ units: [] });
    await expect(
      composeUnits(
        {
          scope: "conquest",
          id: "g1",
          units: [
            {
              unitName: "tank",
              projectId: "p-tank",
              name: "The tank",
              builtBy: [],
              copiedAt: "",
            },
          ],
        },
        target,
        { name: "Splinter Faction", archive: "sf.sdz" },
      ),
    ).rejects.toThrow("This conquest's copy of The tank is missing.");
  });
});

describe("removing a conquest's or run's units", () => {
  const roots = (paths: [string, boolean][]) =>
    ({
      roots: paths.map(([path, exists]) => ({ path, exists })),
    }) as never;

  it("removes its units game from every content root, then its copies", async () => {
    vi.mocked(loadContentState).mockResolvedValue(
      roots([
        ["/data", true],
        ["/gone", false],
        ["/other", true],
      ]),
    );
    await discardUnits({ scope: "warpath", id: "run-1" });
    expect(vi.mocked(legoScratchRemove).mock.calls.map(([a]) => a)).toEqual([
      { dataDir: "/data", folder: "coilbox-lego-run-run-1.sdd" },
      { dataDir: "/other", folder: "coilbox-lego-run-run-1.sdd" },
    ]);
    expect(campaignUnitsDelete).toHaveBeenCalledWith({
      campaignId: "run-1",
      scope: "warpath",
    });
  });

  it("keeps the copies when the units game could not be removed", async () => {
    vi.mocked(loadContentState).mockResolvedValue(roots([["/data", true]]));
    vi.mocked(legoScratchRemove).mockRejectedValue(new Error("refused"));
    await expect(discardUnits({ scope: "conquest", id: "g1" })).rejects.toThrow(
      "refused",
    );
    expect(campaignUnitsDelete).not.toHaveBeenCalled();
  });
});
