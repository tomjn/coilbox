import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A campaign's unit copies in an export file (issue #4517). The plugin's disk is
 * replaced by a map of folders, so a copy goes out through the real export code
 * and comes back in through the real import code, and the two folders are
 * compared.
 */

const { disk, packFiles } = vi.hoisted(() => ({
  // campaign id, then unit name, then file name, then the file as a data URI
  disk: new Map<string, Map<string, Map<string, string>>>(),
  // `<pack folder>/<file>` of an installed atlas pack, then its bytes
  packFiles: new Map<string, string>(),
}));

const uri = (text: string) =>
  `data:application/octet-stream;base64,${btoa(text)}`;

vi.mock("./bindings", () => ({
  campaignImageImportData: vi.fn(),
  campaignUnitSave: vi.fn(
    async (a: {
      campaignId: string;
      unitName: string;
      json: string;
      atlas: { pack: string; name: string } | null;
    }) => {
      const files = new Map([["unit.json", uri(a.json)]]);
      if (a.atlas) {
        files.set(
          a.atlas.name,
          uri(packFiles.get(`${a.atlas.pack}/${a.atlas.name}`) ?? ""),
        );
      }
      const units = disk.get(a.campaignId) ?? new Map();
      units.set(a.unitName, files);
      disk.set(a.campaignId, units);
      return { dir: `/disk/${a.campaignId}/${a.unitName}` };
    },
  ),
  campaignUnitList: vi.fn(async (a: { campaignId: string }) => ({
    units: [...(disk.get(a.campaignId) ?? [])].map(([unitName, files]) => ({
      unitName,
      json: "",
      dir: `/disk/${a.campaignId}/${unitName}`,
      files: [...files.keys()].filter((name) => name !== "unit.json"),
    })),
  })),
  campaignUnitFileRead: vi.fn(
    async (a: { campaignId: string; unitName: string; file: string }) => {
      const dataUri = disk.get(a.campaignId)?.get(a.unitName)?.get(a.file);
      if (!dataUri) throw new Error("no such file");
      return { dataUri };
    },
  ),
  campaignUnitFileWrite: vi.fn(
    async (a: {
      campaignId: string;
      unitName: string;
      file: string;
      dataUri: string;
    }) => {
      if (a.dataUri === "refused") throw new Error("refused");
      const units = disk.get(a.campaignId) ?? new Map();
      const files = units.get(a.unitName) ?? new Map();
      files.set(a.file, a.dataUri);
      units.set(a.unitName, files);
      disk.set(a.campaignId, units);
      return { file: a.file };
    },
  ),
}));
vi.mock("./panorama", () => ({ resolveImageDataUri: vi.fn() }));
vi.mock("../lego/mutator", () => ({
  prepareUnit: vi.fn(),
  writePreparedMutator: vi.fn(),
}));
vi.mock("../lego/bindings", () => ({ legoScratchRemove: vi.fn() }));
vi.mock("../workshop/config", () => ({ loadUnitDefs: vi.fn() }));

import type { ExportTextures } from "../lego/bindings";
import { type LegoProject, newProject } from "../lego/model";
import { type PreparedUnit, prepareUnit } from "../lego/mutator";
import type { LoadedPack } from "../lego/pack";
import { campaignUnitFileRead } from "./bindings";
import { inlineCampaignImages, materializeCampaignImages } from "./images";
import { type Campaign, parseCampaignJson } from "./model";
import { parseCampaignExport, wrapCampaignForExport } from "./transfer";
import { attachUnit, withUnit } from "./units";

function project(unitName: string): LegoProject {
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

const bundled: ExportTextures = {
  atlas: { name: "atlas.png", pack: null, writeAs: "coilbox_atlas.png" },
  stored: [],
};
const fromPack: ExportTextures = {
  atlas: { name: "camo.png", pack: "camo-pack", writeAs: "coilbox_camo.png" },
  stored: [],
};

const empty: Campaign = {
  schemaVersion: 1,
  id: "c1",
  type: "ta",
  title: "A Campaign",
  description: "",
  missions: [],
  createdAt: "",
  updatedAt: "",
};

/** A campaign with a unit on the bundled atlas and a unit on a pack's atlas. */
async function campaignWithUnits(): Promise<Campaign> {
  let campaign = empty;
  for (const [name, textures] of [
    ["tank", bundled],
    ["jeep", fromPack],
  ] as const) {
    vi.mocked(prepareUnit).mockResolvedValueOnce(prepared(name, textures));
    const unit = await attachUnit(
      campaign,
      {
        project: project(name),
        pack: {} as LoadedPack,
        raw: null,
        workshopProjects: [],
      },
      "2026-10-02T00:00:00Z",
    );
    campaign = withUnit(campaign, unit);
  }
  return campaign;
}

/** What an export file does to a campaign on its way between two machines. */
async function sent(campaign: Campaign): Promise<Campaign> {
  const inlined = await inlineCampaignImages(campaign, { units: true });
  const file = JSON.stringify(wrapCampaignForExport(inlined));
  const parsed = parseCampaignExport(file);
  if (!parsed) throw new Error("the export did not parse");
  return parsed.campaign;
}

beforeEach(() => {
  disk.clear();
  packFiles.clear();
  packFiles.set("camo-pack/camo.png", "CAMO-ATLAS-BYTES");
  vi.mocked(campaignUnitFileRead).mockClear();
});

describe("a campaign's units in an export file", () => {
  it("round trips: the imported folders hold the same files as the exported ones", async () => {
    const campaign = await campaignWithUnits();

    const received = await sent(campaign);
    const imported = await materializeCampaignImages(received, "c2");

    expect(imported.units?.map((u) => u.unitName)).toEqual(["tank", "jeep"]);
    for (const unit of ["tank", "jeep"]) {
      const before = disk.get("c1")?.get(unit);
      const after = disk.get("c2")?.get(unit);
      expect(after).toBeDefined();
      expect([...(after ?? [])].sort()).toEqual([...(before ?? [])].sort());
    }
    // The campaign document keeps the entry and drops the carried files.
    expect(imported.units?.every((u) => u.files === undefined)).toBe(true);
    expect(imported.units?.[1]).toMatchObject({
      unitName: "jeep",
      projectId: "p-jeep",
    });
    expect(disk.get("c2")?.get("jeep")?.get("camo.png")).toBe(
      uri("CAMO-ATLAS-BYTES"),
    );
  });

  it("never inlines the bundled atlas, and inlines an atlas pack's", async () => {
    const received = await sent(await campaignWithUnits());

    const [tank, jeep] = received.units ?? [];
    expect(Object.keys(tank.files ?? {})).toEqual(["unit.json"]);
    expect(Object.keys(jeep.files ?? {}).sort()).toEqual([
      "camo.png",
      "unit.json",
    ]);
    expect(campaignUnitFileRead).not.toHaveBeenCalledWith(
      expect.objectContaining({ unitName: "tank", file: "atlas.png" }),
    );
  });

  it("leaves unit files alone unless asked, as a duplicate does", async () => {
    const inlined = await inlineCampaignImages(await campaignWithUnits());

    expect(inlined.units?.every((u) => u.files === undefined)).toBe(true);
    expect(campaignUnitFileRead).not.toHaveBeenCalled();
  });

  it("writes unit.json after the textures, so a stopped import is never listed", async () => {
    const received = await sent(await campaignWithUnits());
    const { campaignUnitFileWrite } = await import("./bindings");
    vi.mocked(campaignUnitFileWrite).mockClear();

    await materializeCampaignImages(received, "c2");

    const jeep = vi
      .mocked(campaignUnitFileWrite)
      .mock.calls.filter(([a]) => a.unitName === "jeep")
      .map(([a]) => a.file);
    expect(jeep).toEqual(["camo.png", "unit.json"]);
  });

  it("drops a unit whose unit.json would not write, rather than naming a copy that is not there", async () => {
    const received = await sent(await campaignWithUnits());
    const files = received.units?.[0].files;
    if (!files) throw new Error("no files");
    files["unit.json"] = { kind: "data", dataUri: "refused" };

    const imported = await materializeCampaignImages(received, "c2");

    expect(imported.units?.map((u) => u.unitName)).toEqual(["jeep"]);
  });

  it("keeps only inline files under a bare file name when reading an export", () => {
    const campaign = parseCampaignJson(
      JSON.stringify({
        ...empty,
        units: [
          {
            unitName: "tank",
            projectId: "p-tank",
            name: "Tank",
            builtBy: [],
            copiedAt: "",
            files: {
              "unit.json": { kind: "data", dataUri: uri("{}") },
              "../escape.png": { kind: "data", dataUri: uri("x") },
              "a/b.png": { kind: "data", dataUri: uri("x") },
              "ok.png": { kind: "file", file: "ok.png" },
            },
          },
        ],
      }),
    );

    expect(Object.keys(campaign?.units?.[0].files ?? {})).toEqual([
      "unit.json",
    ]);
  });
});
