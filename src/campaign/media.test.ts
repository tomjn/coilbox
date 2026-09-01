import { beforeEach, describe, expect, it, vi } from "vitest";

const { campaignMediaDelete } = vi.hoisted(() => ({
  campaignMediaDelete: vi.fn(
    async (_args: {
      campaignId: string;
      file: string;
    }): Promise<{ deleted: boolean; from: "images" | "media" | null }> => ({
      deleted: true,
      from: "media",
    }),
  ),
}));

// The bindings module pulls in the plugin SDK, which Vitest's node resolver
// cannot load from the published dist. Stubbing it keeps the diff testable, the
// way `scenarioMedia.test.ts` stubs its own.
vi.mock("./bindings", () => ({ campaignMediaDelete }));

import {
  campaignMediaFiles,
  deleteDroppedMedia,
  droppedMediaFiles,
  missionMedia,
} from "./media";
import type { Campaign, CampaignMission } from "./model";

function mission(over: Partial<CampaignMission> = {}): CampaignMission {
  return {
    id: "m1",
    title: "Beachhead",
    briefing: "",
    objectives: [],
    snapshot: {
      participants: [],
      gameName: "BAR 1.0",
      mapName: "Comet Catcher",
      startPosType: 0,
      modOptionValues: {},
    },
    disabledUnits: [],
    skippable: false,
    ...over,
  };
}

/** A mission that filled in all four of its media slots from disk. */
const fullyDressed = mission({
  panorama: { kind: "file", file: "shore.jpg" },
  sideGraphic: { kind: "file", file: "emblem.png" },
  voiceover: { kind: "file", file: "brief.ogg" },
  cutscene: { kind: "file", file: "intro.mp4" },
});

function campaign(missions: CampaignMission[], over: Partial<Campaign> = {}) {
  return {
    schemaVersion: 1,
    id: "c1",
    type: "ta",
    title: "Landfall",
    description: "",
    missions,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  } satisfies Campaign;
}

describe("what a mission has imported", () => {
  it("names every slot, not just the panorama", () => {
    expect(missionMedia(fullyDressed)).toEqual([
      { label: "panorama", file: "shore.jpg" },
      { label: "side graphic", file: "emblem.png" },
      { label: "briefing voiceover", file: "brief.ogg" },
      { label: "intro cutscene", file: "intro.mp4" },
    ]);
  });

  it("claims nothing for a reference the campaign does not own", () => {
    // `data` carries its bytes in the document and `local` points at something
    // the distribution shipped. Deleting either would take a file out from
    // under something else.
    expect(
      missionMedia(
        mission({
          panorama: { kind: "data", dataUri: "data:image/png;base64,AA==" },
          cutscene: { kind: "local", path: "welcome/intro.mp4" },
        }),
      ),
    ).toEqual([]);
  });

  it("counts the campaign's own icon and background too", () => {
    const c = campaign([fullyDressed], {
      icon: { kind: "file", file: "badge.png" },
      background: { kind: "file", file: "menu.webm" },
    });

    expect(campaignMediaFiles(c)).toEqual(
      new Set([
        "badge.png",
        "menu.webm",
        "shore.jpg",
        "emblem.png",
        "brief.ogg",
        "intro.mp4",
      ]),
    );
  });
});

describe("what an edit leaves behind", () => {
  it("drops all four of a removed mission's files", () => {
    const before = campaign([fullyDressed]);

    expect(droppedMediaFiles(before, campaign([]))).toEqual([
      "shore.jpg",
      "emblem.png",
      "brief.ogg",
      "intro.mp4",
    ]);
  });

  it("drops a superseded file when a slot is replaced", () => {
    const before = campaign([fullyDressed]);
    const after = campaign([
      { ...fullyDressed, voiceover: { kind: "file", file: "retake.ogg" } },
    ]);

    expect(droppedMediaFiles(before, after)).toEqual(["brief.ogg"]);
  });

  it("keeps a file another mission still plays", () => {
    // Two missions naming one file is what a copied mission leaves, and
    // deleting per-slot would take it out from under the survivor.
    const shared = { kind: "file", file: "intro.mp4" } as const;
    const before = campaign([
      mission({ id: "m1", cutscene: shared }),
      mission({ id: "m2", cutscene: shared }),
    ]);
    const after = campaign([mission({ id: "m2", cutscene: shared })]);

    expect(droppedMediaFiles(before, after)).toEqual([]);
  });

  it("drops nothing when the missions only move", () => {
    const a = mission({ id: "m1", panorama: { kind: "file", file: "a.jpg" } });
    const b = mission({ id: "m2", panorama: { kind: "file", file: "b.jpg" } });

    expect(droppedMediaFiles(campaign([a, b]), campaign([b, a]))).toEqual([]);
  });
});

describe("deleting what an edit left behind", () => {
  beforeEach(() => {
    campaignMediaDelete.mockClear();
  });

  it("asks the plugin for each file once", async () => {
    await deleteDroppedMedia("c1", campaign([fullyDressed]), campaign([]));

    expect(campaignMediaDelete.mock.calls.map((c) => c[0])).toEqual([
      { campaignId: "c1", file: "shore.jpg" },
      { campaignId: "c1", file: "emblem.png" },
      { campaignId: "c1", file: "brief.ogg" },
      { campaignId: "c1", file: "intro.mp4" },
    ]);
  });

  it("says so when the file was not there to delete", async () => {
    // The whole of issue #2210 was a delete that removed nothing and reported
    // success, so the one case that must not pass in silence is this one.
    campaignMediaDelete.mockResolvedValueOnce({ deleted: false, from: null });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await deleteDroppedMedia(
      "c1",
      campaign([mission({ cutscene: { kind: "file", file: "intro.mp4" } })]),
      campaign([]),
    );

    expect(warn).toHaveBeenCalledWith(
      "campaign media was already gone",
      "intro.mp4",
    );
  });

  it("goes on after one refuses", async () => {
    // Wasted disk space is not worth stopping an edit the author has made, so a
    // refusal is logged and the rest still go.
    campaignMediaDelete.mockRejectedValueOnce(
      new Error("unsafe media file name"),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    await deleteDroppedMedia("c1", campaign([fullyDressed]), campaign([]));

    expect(campaignMediaDelete).toHaveBeenCalledTimes(4);
  });
});
