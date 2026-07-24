import { describe, expect, it } from "vitest";
import { type Campaign, parseCampaignJson } from "./model";
import {
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  parseCampaignExport,
  wrapCampaignForExport,
} from "./transfer";

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

describe("wrapCampaignForExport", () => {
  it("wraps a campaign in the canonical coilbox container", () => {
    const file = wrapCampaignForExport(campaign);
    expect(file.format).toBe("coilbox");
    expect(file.kind).toBe("campaign");
    expect(file.kindVersion).toBe(1);
    expect(file.payload).toBe(campaign);
  });
});

describe("parseCampaignExport", () => {
  it("round-trips a container-wrapped campaign", () => {
    const json = JSON.stringify(wrapCampaignForExport(campaign));
    const parsed = parseCampaignExport(json);
    expect(parsed?.id).toBe("abc");
    expect(parsed?.title).toBe("Test");
  });

  it("still reads a legacy pre-container export file", () => {
    const json = JSON.stringify({
      format: EXPORT_FORMAT,
      formatVersion: EXPORT_FORMAT_VERSION,
      campaign,
    });
    const parsed = parseCampaignExport(json);
    expect(parsed?.id).toBe("abc");
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
    const json = JSON.stringify(
      wrapCampaignForExport({ type: "ta", id: "x" } as never),
    );
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
