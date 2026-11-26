// @vitest-environment happy-dom
/**
 * A stored campaign with the same id as a game's campaign is the player's own,
 * so everything that reads its media has to read coilbox's folders and not the
 * game (issue #5485).
 */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameItem } from "../content/bindings";
import { newScenario } from "../scenario/create";

const mocks = vi.hoisted(() => ({
  campaignList: vi.fn(),
  campaignImageRead: vi.fn(async () => ({
    dataUrl: "data:image/png;base64,c3RvcmVk",
  })),
  campaignMediaImportData: vi.fn(async () => ({ file: "copied.ogg" })),
  scenarioGameCampaignFile: vi.fn(),
  scenarioMediaWrite: vi.fn(async () => ({})),
  fetchAsDataUrl: vi.fn(async (_url: string) => "data:audio/ogg;base64,aaa"),
}));

vi.mock("./bindings", () => ({
  campaignList: mocks.campaignList,
  campaignImageRead: mocks.campaignImageRead,
  campaignMediaImportData: mocks.campaignMediaImportData,
  campaignImageImportData: vi.fn(),
  campaignUnitsCopy: vi.fn(),
  campaignProgressLoad: vi.fn(),
  campaignProgressSave: vi.fn(),
}));
vi.mock("../scenario/bindings", () => ({
  scenarioGameCampaigns: async () => ({ campaigns: ["shared"] }),
  scenarioGameCampaignFile: mocks.scenarioGameCampaignFile,
  scenarioMediaRead: vi.fn(),
  scenarioMediaWrite: mocks.scenarioMediaWrite,
}));
vi.mock("../scenario/storage", () => ({
  listScenarios: async () => [],
  sweepScenarioMedia: async () => ({ folders: [], files: [], bytes: 0 }),
}));
vi.mock("../content/config", () => ({ useUnitsyncScan: vi.fn() }));
vi.mock("../play/config", () => ({ usePreferredTarget: vi.fn() }));
vi.mock("../lib/dataUrl", () => ({ fetchAsDataUrl: mocks.fetchAsDataUrl }));
// Export's inline pass and import's materialise pass are about images, and what
// is under test in a duplicate here is where a stored clip is read from.
vi.mock("./images", () => ({
  inlineCampaignImages: async (c: unknown) => c,
  materializeCampaignImages: async (c: unknown) => c,
}));
vi.mock("./units", () => ({ writeCarriedCopies: async () => {} }));

import { campaignPicks, scenarioPicks } from "../home/contentArt";
import { campaignImageUrl, campaignMediaUrl } from "../lib/assetUrl";
import { refreshCampaigns } from "./campaigns";
import { duplicateCampaign } from "./duplicate";
import {
  gameCampaignJson,
  gameCampaignOrigin,
  gameCampaigns,
} from "./gameCampaigns";
import type { Campaign } from "./model";
import { resolvePanoramaDataUri, useCampaignImage } from "./panorama";
import { ensureCampaignScenarioMedia } from "./scenarioMedia";
import { wrapCampaignForExport } from "./transfer";

const scenario = { ...newScenario("Landing"), id: "scn" };
scenario.setup.mapName = "Comet";

function campaignDocument(id: string): Campaign {
  return {
    schemaVersion: 1,
    id,
    type: "ta",
    title: id,
    background: { kind: "file", file: "background.png" },
    missions: [
      {
        id: "m1",
        title: "Landing",
        briefing: "",
        objectives: [],
        disabledUnits: [],
        skippable: false,
        snapshot: { gameName: "G", mapName: "Comet" },
        scenario,
        panorama: { kind: "file", file: "landing.png" },
        voiceover: { kind: "file", file: "voice.ogg" },
      },
    ],
    updatedAt: "2026-11-01T00:00:00.000Z",
  } as unknown as Campaign;
}

/** List one campaign id as the game's own, with its dialogue clip. */
async function shipInGame(id: string) {
  mocks.scenarioGameCampaignFile.mockImplementation(
    async ({ file }: { file: string }) => ({
      base64:
        file === "campaign.json"
          ? btoa(
              JSON.stringify(
                wrapCampaignForExport(campaignDocument(id), {
                  scn: { "line.ogg": "data:audio/ogg;base64,Z2FtZQ==" },
                }),
              ),
            )
          : btoa("game"),
    }),
  );
  const listed = await gameCampaigns([
    {
      name: "G",
      primaryArchive: { name: `${id}.sdz`, path: `/games/${id}.sdz` },
    } as unknown as GameItem,
  ]);
  expect(listed).toHaveLength(1);
  mocks.scenarioGameCampaignFile.mockClear();
}

/** Read the stored list holding these campaign ids. */
async function store(...ids: string[]) {
  mocks.campaignList.mockResolvedValue({
    items: ids.map((id) => ({
      source: "local",
      json: JSON.stringify(campaignDocument(id)),
    })),
  });
  await refreshCampaigns();
}

/** What the home page would draw for a campaign last played at its mission. */
function cardArt(id: string) {
  const campaigns = [{ campaign: campaignDocument(id) }];
  return {
    campaign: campaignPicks(campaigns, {
      schemaVersion: 1,
      campaigns: {
        [id]: {
          lastPlayedMissionId: "m1",
          updatedAt: "2026-11-02T00:00:00.000Z",
        },
      },
    } as unknown as Parameters<typeof campaignPicks>[1]),
    scenario: scenarioPicks([{ scenario }], campaigns),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a stored campaign sharing a game campaign's id", () => {
  it("is not treated as the game's", async () => {
    await shipInGame("same");
    await store("same");

    expect(gameCampaignOrigin("same")).toBeUndefined();
    expect(gameCampaignJson("same")).toBeUndefined();
  });

  it("reads its stored images from coilbox, even after the game's was shown", async () => {
    await store();
    await shipInGame("images");
    expect(await resolvePanoramaDataUri("images", "landing.png")).toBe(
      `data:image/png;base64,${btoa("game")}`,
    );

    await store("images");

    expect(await resolvePanoramaDataUri("images", "landing.png")).toBe(
      "data:image/png;base64,c3RvcmVk",
    );
  });

  it("shows its stored image and clip in the editor and briefing", async () => {
    await shipInGame("hooks");
    await store("hooks");

    const image = renderHook(() =>
      useCampaignImage("hooks", { kind: "file", file: "landing.png" }),
    );
    const clip = renderHook(() =>
      useCampaignImage("hooks", { kind: "file", file: "voice.ogg" }),
    );

    await waitFor(() =>
      expect(image.result.current).toBe("data:image/png;base64,c3RvcmVk"),
    );
    expect(clip.result.current).toBe(campaignMediaUrl("hooks", "voice.ogg"));
    expect(mocks.scenarioGameCampaignFile).not.toHaveBeenCalled();
  });

  it("is duplicated from coilbox's media folder", async () => {
    await shipInGame("copy");
    await store("copy");

    await duplicateCampaign(campaignDocument("copy"), "Copy");

    expect(mocks.fetchAsDataUrl).toHaveBeenCalledWith(
      campaignMediaUrl("copy", "voice.ogg"),
    );
    expect(mocks.scenarioGameCampaignFile).not.toHaveBeenCalled();
  });

  it("has its stored art on the home cards", async () => {
    await shipInGame("cards");
    await store("cards");
    const url = campaignImageUrl("cards", "landing.png");

    expect(cardArt("cards").campaign[0]).toEqual({ kind: "image", url });
    expect(cardArt("cards").scenario[0]).toEqual({ kind: "image", url });
  });

  it("does not have the game's dialogue clips written over its own", async () => {
    await shipInGame("clips");
    await store("clips");

    await ensureCampaignScenarioMedia("clips");

    expect(mocks.scenarioMediaWrite).not.toHaveBeenCalled();
  });

  it("hands back to the game's campaign once deleted, clips included", async () => {
    await shipInGame("deleted");
    await store("deleted");
    await ensureCampaignScenarioMedia("deleted");

    await store();
    await ensureCampaignScenarioMedia("deleted");

    expect(gameCampaignOrigin("deleted")?.folder).toBe("shared");
    expect(mocks.scenarioMediaWrite).toHaveBeenCalledWith({
      scenarioId: "scn",
      file: "line.ogg",
      dataUri: "data:audio/ogg;base64,Z2FtZQ==",
    });
  });
});
