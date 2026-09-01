/**
 * What a copy of a campaign carries, and what it must not carry (issue #2189).
 *
 * The trap this file exists for: every stored image and every stored audio or
 * video file is named by a bare file name under a folder keyed by the *campaign's
 * own id* (`images/<id>/`, `media/<id>/`), and `campaign_delete` removes both
 * folders. A copy that kept its source's file names would look right in the
 * editor and lose every picture and every clip the day somebody deleted the
 * campaign it was copied from. So the assertions here are about ids: nothing in
 * the copy may name the source's.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { campaignImageImportData, campaignMediaImportData } = vi.hoisted(() => ({
  campaignImageImportData: vi.fn(async (_args: { campaignId: string }) => ({
    file: "new-image.jpg",
  })),
  campaignMediaImportData: vi.fn(async (_args: { campaignId: string }) => ({
    file: "new-clip.ogg",
  })),
}));
vi.mock("./bindings", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("./bindings")),
  campaignImageImportData,
  campaignMediaImportData,
}));

// Reading a stored image back off disk is the plugin's job, and the round trip
// through it is what re-ids the image. What it hands back does not matter here.
const { resolveImageDataUri } = vi.hoisted(() => ({
  resolveImageDataUri: vi.fn(async () => "data:image/png;base64,aaa"),
}));
vi.mock("./panorama", () => ({ resolveImageDataUri }));

// A stored clip is read back over the `coilbox://` protocol, not through a
// plugin command, so this is the read the copy makes.
const { fetchAsDataUrl } = vi.hoisted(() => ({
  fetchAsDataUrl: vi.fn(
    async (_url: string) => "data:audio/ogg;base64,bbb" as string | undefined,
  ),
}));
vi.mock("../lib/dataUrl", () => ({ fetchAsDataUrl }));

const { ensureCampaignScenarioMedia } = vi.hoisted(() => ({
  ensureCampaignScenarioMedia: vi.fn(async () => {}),
}));
vi.mock("./scenarioMedia", () => ({ ensureCampaignScenarioMedia }));

import { copyTitle, duplicateCampaign } from "./duplicate";
import type { Campaign, CampaignMission } from "./model";

function missionNamed(
  id: string,
  extra: Partial<CampaignMission> = {},
): CampaignMission {
  return {
    id,
    title: "Beach landing",
    briefing: "",
    objectives: ["Hold the ridge"],
    snapshot: {
      gameName: "BAR",
      mapName: "Comet Catcher",
    } as CampaignMission["snapshot"],
    disabledUnits: ["armcom"],
    skippable: false,
    ...extra,
  };
}

function campaignNamed(extra: Partial<Campaign> = {}): Campaign {
  return {
    schemaVersion: 1,
    id: "source-id",
    type: "ta",
    title: "Beachhead",
    description: "Hold the landing zone.",
    missions: [missionNamed("m1")],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the title a copy gets", () => {
  it("is Copy of the original", () => {
    expect(copyTitle("Beachhead", [])).toBe("Copy of Beachhead");
  });

  // Two rows reading "Copy of Beachhead" cannot be told apart in a list that
  // shows the title, and comparing two variants is a reason to duplicate at all.
  it("counts up when that name is already on the list", () => {
    const taken = ["Beachhead", "Copy of Beachhead"];
    expect(copyTitle("Beachhead", taken)).toBe("Copy of Beachhead (2)");
    expect(copyTitle("Beachhead", [...taken, "Copy of Beachhead (2)"])).toBe(
      "Copy of Beachhead (3)",
    );
  });
});

describe("a copy of a campaign", () => {
  it("takes a new id and the title it was given, and keeps the rest", async () => {
    const source = campaignNamed();

    const { campaign } = await duplicateCampaign(
      source,
      "Copy of Beachhead",
      "2026-03-01T00:00:00.000Z",
    );

    expect(campaign.id).not.toBe("source-id");
    expect(campaign.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(campaign.title).toBe("Copy of Beachhead");
    expect(campaign.description).toBe("Hold the landing zone.");
    expect(campaign.createdAt).toBe("2026-03-01T00:00:00.000Z");
    expect(campaign.updatedAt).toBe("2026-03-01T00:00:00.000Z");
    expect(campaign.missions[0].objectives).toEqual(["Hold the ridge"]);
    expect(campaign.missions[0].disabledUnits).toEqual(["armcom"]);
    expect(campaign.missions[0].snapshot).toEqual(source.missions[0].snapshot);
  });

  // The mission id is a stable node id, and the scenario id is also the
  // `missions/<id>/` folder a compiled mission is written into and the value of
  // the `coilbox_mission` modoption. Import keeps both for the same reason.
  it("keeps its mission and scenario ids", async () => {
    const scenario = { id: "scenario-7" } as CampaignMission["scenario"];
    const source = campaignNamed({
      missions: [missionNamed("m1", { scenario })],
    });

    const { campaign } = await duplicateCampaign(source, "Copy");

    expect(campaign.missions[0].id).toBe("m1");
    expect(campaign.missions[0].scenario?.id).toBe("scenario-7");
  });

  it("writes every stored image under its own id, not the original's", async () => {
    const source = campaignNamed({
      icon: { kind: "file", file: "old-icon.png" },
      missions: [
        missionNamed("m1", { panorama: { kind: "file", file: "old-pan.jpg" } }),
      ],
    });

    const { campaign, droppedMedia } = await duplicateCampaign(source, "Copy");

    expect(campaignImageImportData).toHaveBeenCalledTimes(2);
    for (const [args] of campaignImageImportData.mock.calls) {
      expect(args.campaignId).toBe(campaign.id);
    }
    expect(campaign.icon).toEqual({ kind: "file", file: "new-image.jpg" });
    expect(campaign.missions[0].panorama).toEqual({
      kind: "file",
      file: "new-image.jpg",
    });
    expect(droppedMedia).toBe(0);
  });

  // The one the image round trip does not cover. Both passes in `images.ts` let
  // an audio/video `file` through untouched, so without a pass of its own the
  // copy would keep a name under `media/<source id>/`.
  it("copies a stored clip out of the original's folder into its own", async () => {
    const source = campaignNamed({
      missions: [
        missionNamed("m1", {
          voiceover: { kind: "file", file: "briefing.ogg" },
          cutscene: { kind: "file", file: "intro.mp4" },
        }),
      ],
    });

    const { campaign, droppedMedia } = await duplicateCampaign(source, "Copy");

    // Read from the source campaign's media URL, because that is where the
    // bytes are.
    expect(fetchAsDataUrl.mock.calls.map(([url]) => url)).toEqual([
      expect.stringContaining("campaign/source-id/briefing.ogg"),
      expect.stringContaining("campaign/source-id/intro.mp4"),
    ]);
    // Written under the copy's id, with the extension the file had, because the
    // protocol picks a content type from it.
    expect(campaignMediaImportData).toHaveBeenCalledWith({
      campaignId: campaign.id,
      dataUri: "data:audio/ogg;base64,bbb",
      ext: "ogg",
    });
    expect(campaignMediaImportData).toHaveBeenCalledWith({
      campaignId: campaign.id,
      dataUri: "data:audio/ogg;base64,bbb",
      ext: "mp4",
    });
    expect(campaign.missions[0].voiceover).toEqual({
      kind: "file",
      file: "new-clip.ogg",
    });
    expect(droppedMedia).toBe(0);
  });

  // A distribution's own art lives in the portable `.coilbox` folder, which the
  // copy reaches by exactly the same path. Copying the bytes would be a second
  // set of them for nothing.
  it("leaves a bundled campaign's own art where it is", async () => {
    const source = campaignNamed({
      icon: { kind: "local", path: "campaigns/art/emblem.png" },
      missions: [
        missionNamed("m1", {
          cutscene: { kind: "local", path: "campaigns/art/intro.mp4" },
        }),
      ],
    });

    const { campaign, droppedMedia } = await duplicateCampaign(source, "Copy");

    expect(campaign.icon).toEqual({
      kind: "local",
      path: "campaigns/art/emblem.png",
    });
    expect(campaign.missions[0].cutscene).toEqual({
      kind: "local",
      path: "campaigns/art/intro.mp4",
    });
    expect(campaignImageImportData).not.toHaveBeenCalled();
    expect(campaignMediaImportData).not.toHaveBeenCalled();
    expect(droppedMedia).toBe(0);
  });

  // One unreadable file is a gap in the copy, not a failed copy. The count is
  // what lets the caller say so instead of handing back a campaign that quietly
  // lost a briefing's voice.
  it("drops a clip it cannot read, and counts it", async () => {
    fetchAsDataUrl.mockResolvedValueOnce(undefined);
    const source = campaignNamed({
      missions: [
        missionNamed("m1", { voiceover: { kind: "file", file: "gone.ogg" } }),
      ],
    });

    const { campaign, droppedMedia } = await duplicateCampaign(source, "Copy");

    expect(campaign.missions[0].voiceover).toBeUndefined();
    expect(campaignMediaImportData).not.toHaveBeenCalled();
    expect(droppedMedia).toBe(1);
  });

  it("counts an image the plugin refused to write", async () => {
    campaignImageImportData.mockRejectedValueOnce(new Error("disk full"));
    const source = campaignNamed({
      icon: { kind: "file", file: "icon.png" },
      background: { kind: "file", file: "bg.png" },
    });

    const { campaign, droppedMedia } = await duplicateCampaign(source, "Copy");

    expect(droppedMedia).toBe(1);
    expect([campaign.icon, campaign.background].filter(Boolean)).toHaveLength(
      1,
    );
  });

  // A bundled campaign's dialogue clips are only put in the media store on the
  // launch path, and that path looks the campaign up by id among the *bundled*
  // ones. The copy is local, so it would never find them.
  it("puts the original's dialogue clips in the store before copying", async () => {
    await duplicateCampaign(campaignNamed(), "Copy");

    expect(ensureCampaignScenarioMedia).toHaveBeenCalledWith("source-id");
  });
});
