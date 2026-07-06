import { describe, expect, it } from "vitest";
import { parseCampaignJson } from "./model";

/** A minimal valid campaign JSON with one mission; extra mission fields spread in. */
function campaignJson(missionExtra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "ta",
    id: "c1",
    title: "Test",
    missions: [
      {
        id: "m1",
        title: "Mission 1",
        snapshot: { mapName: "Comet Catcher", gameName: "BAR" },
        ...missionExtra,
      },
    ],
  });
}

describe("parseCampaignJson — map-preview fields", () => {
  it("leaves the new fields undefined on legacy campaigns", () => {
    const c = parseCampaignJson(campaignJson());
    expect(c).not.toBeNull();
    const m = c!.missions[0];
    expect(m.panoramaMap).toBeUndefined();
    expect(m.sideGraphicMap).toBeUndefined();
    expect(m.mapDownload).toBeUndefined();
  });

  it("parses a valid map-preview config with tuning", () => {
    const c = parseCampaignJson(
      campaignJson({
        panoramaMap: { style: "textured", spinSpeed: 2, water: false },
        sideGraphicMap: { style: "heightmap" },
      }),
    );
    expect(c!.missions[0].panoramaMap).toEqual({
      style: "textured",
      spinSpeed: 2,
      water: false,
    });
    expect(c!.missions[0].sideGraphicMap).toEqual({
      style: "heightmap",
      spinSpeed: undefined,
      water: undefined,
    });
  });

  it("drops a map-preview config with an unknown style", () => {
    const c = parseCampaignJson(
      campaignJson({ panoramaMap: { style: "wireframe" } }),
    );
    expect(c!.missions[0].panoramaMap).toBeUndefined();
  });

  it("drops non-numeric spinSpeed and non-boolean water", () => {
    const c = parseCampaignJson(
      campaignJson({
        panoramaMap: { style: "textured", spinSpeed: "fast", water: "yes" },
      }),
    );
    expect(c!.missions[0].panoramaMap).toEqual({
      style: "textured",
      spinSpeed: undefined,
      water: undefined,
    });
  });

  it("parses a map download override, dropping an empty one", () => {
    const withHint = parseCampaignJson(
      campaignJson({
        mapDownload: { springName: "comet_catcher_v3", searchUrl: "https://x" },
      }),
    );
    expect(withHint!.missions[0].mapDownload).toEqual({
      springName: "comet_catcher_v3",
      searchUrl: "https://x",
    });

    const empty = parseCampaignJson(campaignJson({ mapDownload: {} }));
    expect(empty!.missions[0].mapDownload).toBeUndefined();
  });
});
