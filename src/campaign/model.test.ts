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

describe("parseCampaignJson — media playback", () => {
  it("leaves playback undefined on legacy campaigns", () => {
    const m = parseCampaignJson(campaignJson())!.missions[0];
    expect(m.panoramaPlayback).toBeUndefined();
    expect(m.sideGraphicPlayback).toBeUndefined();
    expect(m.voiceoverPlayback).toBeUndefined();
    expect(m.cutscenePlayback).toBeUndefined();
  });

  it("keeps only known boolean keys, omitting others", () => {
    const m = parseCampaignJson(
      campaignJson({
        panoramaPlayback: { scroll: false, junk: 1, muted: "no" },
        cutscenePlayback: { autoplay: true, loop: false, muted: true },
      }),
    )!.missions[0];
    // `junk` dropped, `muted: "no"` (non-boolean) dropped — no explicit undefined.
    expect(m.panoramaPlayback).toEqual({ scroll: false });
    expect(m.cutscenePlayback).toEqual({
      autoplay: true,
      loop: false,
      muted: true,
    });
  });

  it("drops an all-invalid / empty playback object", () => {
    const m = parseCampaignJson(
      campaignJson({ panoramaPlayback: { muted: "yes" } }),
    )!.missions[0];
    expect(m.panoramaPlayback).toBeUndefined();
  });

  it("parses a campaign-level background playback", () => {
    const c = parseCampaignJson(
      JSON.stringify({
        type: "ta",
        id: "c1",
        title: "T",
        backgroundPlayback: { autoplay: false, loop: true },
        missions: [{ id: "m1", title: "M", snapshot: {} }],
      }),
    );
    expect(c!.backgroundPlayback).toEqual({ autoplay: false, loop: true });
  });
});

describe("parseCampaignJson - attached scenario", () => {
  const scenarioJson = {
    schemaVersion: 1,
    id: "s1",
    name: "Ambush",
    runtimeVersion: 1,
    setup: { participants: [], gameName: "BAR", mapName: "Comet Catcher" },
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("leaves a campaign written before scenarios existed unchanged", () => {
    const c = parseCampaignJson(campaignJson());
    expect(c).not.toBeNull();
    const m = c!.missions[0];
    expect(m.scenario).toBeUndefined();
    expect("scenario" in JSON.parse(JSON.stringify(m))).toBe(false);
  });

  it("parses an attached scenario into the mission", () => {
    const m = parseCampaignJson(
      campaignJson({ scenario: scenarioJson }),
    )!.missions[0];
    expect(m.scenario?.id).toBe("s1");
    expect(m.scenario?.name).toBe("Ambush");
    expect(m.scenario?.updatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("rejects the campaign when a present scenario will not parse", () => {
    expect(parseCampaignJson(campaignJson({ scenario: { name: "no id" } }))).toBeNull();
    expect(parseCampaignJson(campaignJson({ scenario: "nonsense" }))).toBeNull();
  });
});
