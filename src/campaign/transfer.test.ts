import { describe, expect, it } from "vitest";
import { identify } from "../container/container";
import type { Scenario } from "../scenario/model";
import { type Campaign, parseCampaignJson } from "./model";
import {
  CAMPAIGN_KIND_VERSION,
  type CampaignScenarioMedia,
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  parseCampaignExport,
  wrapCampaignForExport,
} from "./transfer";

const PORTRAIT = "data:image/png;base64,aGk=";
const VOICE = "data:audio/ogg;base64,b2dn";

const campaign: Campaign = {
  schemaVersion: 1,
  id: "abc",
  type: "ta",
  title: "Test",
  description: "",
  missions: [],
  createdAt: "t0",
  updatedAt: "t1",
};

function scenario(): Scenario {
  return {
    schemaVersion: 1,
    id: "s1",
    name: "Ambush",
    description: "",
    runtimeVersion: 1,
    setup: {
      participants: [],
      gameName: "BAR",
      mapName: "Bismuth Valley",
      startPosType: 0,
      modOptionValues: {},
    },
    teams: {},
    zones: [],
    actors: [],
    groups: [],
    prefabs: [],
    restrictions: {},
    vars: {},
    triggers: [],
    objectives: [],
    dialogue: [
      {
        id: "d1",
        speaker: "Vega",
        text: "Hold the line.",
        portrait: "a.png",
        audio: "a.ogg",
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** A campaign whose one mission carries the scenario above. */
function withScenario(): Campaign {
  return {
    ...campaign,
    missions: [
      {
        id: "m1",
        title: "Mission 1",
        briefing: "",
        objectives: [],
        snapshot: scenario().setup,
        scenario: scenario(),
        disabledUnits: [],
        skippable: false,
      },
    ],
  };
}

const media: CampaignScenarioMedia = {
  s1: { "a.png": PORTRAIT, "a.ogg": VOICE },
};

describe("wrapCampaignForExport", () => {
  it("wraps a scenario-free campaign exactly as before, at kindVersion 1", () => {
    const file = wrapCampaignForExport(campaign);
    expect(file.format).toBe("coilbox");
    expect(file.kind).toBe("campaign");
    expect(file.kindVersion).toBe(1);
    expect(file.payload).toBe(campaign);
  });

  it("ignores media offered for a campaign with no scenarios", () => {
    expect(wrapCampaignForExport(campaign, media).payload).toBe(campaign);
  });

  it("carries the document beside its clips at kindVersion 2", () => {
    const withScenarios = withScenario();
    const file = wrapCampaignForExport(withScenarios, media);
    expect(file.kindVersion).toBe(CAMPAIGN_KIND_VERSION);
    expect(file.payload).toEqual({ campaign: withScenarios, media });
  });
});

describe("parseCampaignExport", () => {
  it("round-trips a container-wrapped campaign", () => {
    const json = JSON.stringify(wrapCampaignForExport(campaign));
    const parsed = parseCampaignExport(json);
    expect(parsed?.campaign.id).toBe("abc");
    expect(parsed?.campaign.title).toBe("Test");
  });

  it("reports a scenario-free export as carrying no media at all", () => {
    const json = JSON.stringify(wrapCampaignForExport(campaign));
    expect(parseCampaignExport(json)?.media).toBeNull();
  });

  it("round-trips a campaign's scenarios and their dialogue clips", () => {
    const json = JSON.stringify(wrapCampaignForExport(withScenario(), media));
    const parsed = parseCampaignExport(json);
    expect(parsed?.campaign.missions[0].scenario?.id).toBe("s1");
    expect(parsed?.campaign.missions[0].scenario?.dialogue[0].portrait).toBe(
      "a.png",
    );
    expect(parsed?.media).toEqual(media);
  });

  it("identifies a media-carrying export as a campaign", () => {
    const json = JSON.stringify(wrapCampaignForExport(withScenario(), media));
    expect(identify(json)).toMatchObject({
      kind: "campaign",
      version: 2,
      compatibility: "ok",
      warnings: [],
    });
  });

  it("drops a media entry that is not a data URI", () => {
    const json = JSON.stringify(
      wrapCampaignForExport(withScenario(), {
        s1: { "a.png": PORTRAIT, "a.ogg": "/etc/passwd" },
      } as CampaignScenarioMedia),
    );
    expect(parseCampaignExport(json)?.media).toEqual({
      s1: { "a.png": PORTRAIT },
    });
  });

  it("keeps the campaign when media is missing entirely", () => {
    const json = JSON.stringify({
      format: "coilbox",
      container: 1,
      kind: "campaign",
      kindVersion: 2,
      payload: { campaign: withScenario() },
    });
    expect(parseCampaignExport(json)?.media).toEqual({});
  });

  it("still reads a legacy pre-container export file", () => {
    const json = JSON.stringify({
      format: EXPORT_FORMAT,
      formatVersion: EXPORT_FORMAT_VERSION,
      campaign,
    });
    const parsed = parseCampaignExport(json);
    expect(parsed?.campaign.id).toBe("abc");
    expect(parsed?.media).toBeNull();
  });

  it("rejects non-JSON", () => {
    expect(parseCampaignExport("not json")).toBeNull();
  });

  it("rejects a container of the wrong kind", () => {
    const json = JSON.stringify({
      format: "coilbox",
      container: 1,
      kind: "preset",
      kindVersion: 1,
      payload: campaign,
    });
    expect(parseCampaignExport(json)).toBeNull();
  });

  it("rejects a container from a newer version of coilbox", () => {
    const json = JSON.stringify({
      format: "coilbox",
      container: 1,
      kind: "campaign",
      kindVersion: 99,
      payload: campaign,
    });
    expect(parseCampaignExport(json)).toBeNull();
  });

  it("rejects a legacy wrapper with a wrong format tag", () => {
    const json = JSON.stringify({
      format: "x",
      formatVersion: EXPORT_FORMAT_VERSION,
      campaign,
    });
    expect(parseCampaignExport(json)).toBeNull();
  });

  it("rejects a container whose inner campaign is invalid", () => {
    const json = JSON.stringify({
      format: "coilbox",
      container: 1,
      kind: "campaign",
      kindVersion: 1,
      payload: { type: "ta", id: "x" },
    });
    expect(parseCampaignExport(json)).toBeNull();
  });

  it("rejects a version 2 container with no campaign in it", () => {
    const json = JSON.stringify({
      format: "coilbox",
      container: 1,
      kind: "campaign",
      kindVersion: 2,
      payload: { media },
    });
    expect(parseCampaignExport(json)).toBeNull();
  });

  it("rejects a bare campaign that isn't wrapped", () => {
    expect(parseCampaignExport(JSON.stringify(campaign))).toBeNull();
  });
});

describe("parseCampaignJson with the export wrapper", () => {
  // A bundled campaign may be the exported file dropped in as-is, so the
  // general validator unwraps the envelope before validating.
  it("accepts a wrapped export file", () => {
    const json = JSON.stringify(wrapCampaignForExport(campaign));
    expect(parseCampaignJson(json)?.id).toBe("abc");
  });

  it("accepts a media-carrying export file", () => {
    const json = JSON.stringify(wrapCampaignForExport(withScenario(), media));
    expect(parseCampaignJson(json)?.missions[0].scenario?.id).toBe("s1");
  });

  it("still accepts a bare campaign document", () => {
    expect(parseCampaignJson(JSON.stringify(campaign))?.id).toBe("abc");
  });

  it("rejects a wrapper around an invalid campaign", () => {
    const json = JSON.stringify({
      format: EXPORT_FORMAT,
      formatVersion: EXPORT_FORMAT_VERSION,
      campaign: { type: "ta", id: "x" },
    });
    expect(parseCampaignJson(json)).toBeNull();
  });
});
