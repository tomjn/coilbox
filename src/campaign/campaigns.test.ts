import { beforeEach, describe, expect, it, vi } from "vitest";

const listMock = vi.fn();

// The load path reaches the plugin through bindings.ts, whose plugin-sdk import
// Vitest's node resolver cannot load from the published dist. Stubbing the
// bindings module keeps the list logic testable, the way storage.test.ts does
// for scenarios.
vi.mock("./bindings", () => ({
  campaignList: (...args: unknown[]) => listMock(...args),
  campaignProgressLoad: vi.fn(),
  campaignProgressSave: vi.fn(),
}));

// The list kicks off a media sweep it does not wait for. It reads the disk, and
// it has nothing to say about order.
vi.mock("./scenarioMedia", () => ({
  sweepOrphanedScenarioMedia: vi.fn(async () => {}),
}));

// The hook half reads the content scan, which nothing here renders.
vi.mock("../content/config", () => ({ useUnitsyncScan: vi.fn() }));
vi.mock("../play/config", () => ({ usePreferredTarget: vi.fn() }));
vi.mock("../scenario/bindings", () => ({}));

import {
  getCachedCampaign,
  type LoadedCampaign,
  loadedCampaigns,
  mergeCampaigns,
  publishGameCampaigns,
  refreshCampaigns,
} from "./campaigns";
import { parseCampaignJson } from "./model";
import { missionStates } from "./progress";
import { applyVictory } from "./results";

/** A campaign document as the plugin hands it back, in read_dir order. */
function stored(id: string, updatedAt: string, source: "local" | "bundled") {
  return {
    source,
    json: JSON.stringify({
      schemaVersion: 1,
      id,
      type: "ta",
      title: id,
      missions: [],
      updatedAt,
    }),
  };
}

beforeEach(() => {
  listMock.mockReset();
});

describe("the campaign list", () => {
  it("comes back newest edit first, whatever order the folder was read in", async () => {
    listMock.mockResolvedValue({
      items: [
        stored("older", "2026-08-01T00:00:00.000Z", "local"),
        stored("newest", "2026-09-01T00:00:00.000Z", "local"),
        stored("middle", "2026-08-20T00:00:00.000Z", "local"),
      ],
    });
    const loaded = await refreshCampaigns();
    expect(loaded.map((l) => l.campaign.id)).toEqual([
      "newest",
      "middle",
      "older",
    ]);
  });

  it("keeps the bundled ones below the author's own", async () => {
    listMock.mockResolvedValue({
      // Bundled first in the read, so this only passes if the sort moved it
      // rather than the plugin happening to read local documents first.
      items: [
        stored("bundled-today", "2026-09-01T00:00:00.000Z", "bundled"),
        stored("mine", "2026-08-01T00:00:00.000Z", "local"),
      ],
    });
    const loaded = await refreshCampaigns();
    expect(loaded.map((l) => l.campaign.id)).toEqual(["mine", "bundled-today"]);
  });

  // A document with no `updatedAt` still parses, so it still has to be placed.
  it("places a campaign the plugin handed back without a timestamp", async () => {
    listMock.mockResolvedValue({
      items: [
        {
          source: "local" as const,
          json: '{"type":"ta","id":"undated","title":"U","missions":[]}',
        },
        stored("dated", "2026-01-01T00:00:00.000Z", "local"),
      ],
    });
    const loaded = await refreshCampaigns();
    expect(loaded.map((l) => l.campaign.id)).toEqual(["dated", "undated"]);
  });
});

/** A campaign a game ships, as the games half publishes it. */
function fromGame(id: string, missions = 0): LoadedCampaign {
  const campaign = parseCampaignJson(
    JSON.stringify({
      type: "ta",
      id,
      title: id,
      missions: Array.from({ length: missions }, (_, i) => ({
        id: `${id}-${i + 1}`,
        title: `Mission ${i + 1}`,
        snapshot: { gameName: "G", mapName: "M" },
      })),
      updatedAt: "2026-12-01T00:00:00.000Z",
    }),
  );
  if (!campaign) throw new Error("fixture did not parse");
  return {
    campaign,
    source: "game",
    origin: { gameName: "G", archivePath: "/g.sd7", folder: id, loose: false },
  };
}

describe("a game's campaigns in the list (issue #2161)", () => {
  it("come after the player's own and the bundled ones, however recent", async () => {
    listMock.mockResolvedValue({
      items: [
        stored("mine", "2026-01-01T00:00:00.000Z", "local"),
        stored("bundled", "2026-01-01T00:00:00.000Z", "bundled"),
      ],
    });
    const fromDisk = await refreshCampaigns();

    const merged = mergeCampaigns(fromDisk, [fromGame("shipped")]);

    expect(merged.map((l) => [l.campaign.id, l.source])).toEqual([
      ["mine", "local"],
      ["bundled", "bundled"],
      ["shipped", "game"],
    ]);
  });

  it("drop a game's campaign the player already has a copy of", () => {
    const mine = { ...fromGame("same"), source: "local" as const };

    const merged = mergeCampaigns([mine], [fromGame("same")]);

    expect(merged).toEqual([mine]);
  });

  it("are found by id once the games half has published", async () => {
    listMock.mockResolvedValue({ items: [] });
    await refreshCampaigns();

    publishGameCampaigns([fromGame("shipped")]);

    expect(getCachedCampaign("shipped")?.source).toBe("game");
    expect((await loadedCampaigns()).map((l) => l.campaign.id)).toEqual([
      "shipped",
    ]);
    publishGameCampaigns([]);
  });

  it("track progress by id in coilbox's own progress file, in order", () => {
    const { campaign } = fromGame("shipped", 3);

    const progress = applyVictory(
      { schemaVersion: 1, campaigns: {} },
      campaign.id,
      "shipped-1",
    );
    const states = missionStates(campaign, progress.campaigns.shipped);

    expect([...states.values()]).toEqual(["complete", "available", "locked"]);
  });
});
