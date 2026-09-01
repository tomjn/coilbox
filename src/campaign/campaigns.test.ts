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

import { refreshCampaigns } from "./campaigns";

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
